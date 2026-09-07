import { createHmac, timingSafeEqual } from "node:crypto";

export type AttendeeWebhookTrigger =
  | "bot.state_change"
  | "transcript.update"
  | "participant_events.join_leave";

export interface AttendeeWebhookEvent {
  idempotencyKey: string;
  botId: string;
  botMetadata?: Record<string, unknown>;
  trigger: AttendeeWebhookTrigger;
  data: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!isRecord(value)) return value;
  return Object.keys(value)
    .sort()
    .reduce<Record<string, unknown>>((sorted, key) => {
      sorted[key] = sortKeys(value[key]);
      return sorted;
    }, {});
}

export function signAttendeeWebhookPayload(
  secretBase64: string,
  payload: unknown,
): Buffer {
  const canonicalPayload = JSON.stringify(sortKeys(payload));
  const key = Buffer.from(secretBase64, "base64");
  if (!key.length) throw new Error("Webhook verification is not configured");
  return createHmac("sha256", key).update(canonicalPayload, "utf8").digest();
}

export function verifyAttendeeWebhook(
  secretBase64: string,
  headers: Headers,
  payload: unknown,
): void {
  const encodedSignature = headers.get("x-webhook-signature");
  if (!encodedSignature) throw new Error("Webhook signature is missing");

  const expected = signAttendeeWebhookPayload(secretBase64, payload);
  const received = Buffer.from(encodedSignature, "base64");
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    throw new Error("Webhook signature does not match");
  }
}

export function parseAttendeeWebhook(
  value: unknown,
): AttendeeWebhookEvent | undefined {
  if (!isRecord(value) || !isRecord(value.data)) return undefined;
  if (
    typeof value.idempotency_key !== "string" ||
    typeof value.bot_id !== "string" ||
    ![
      "bot.state_change",
      "transcript.update",
      "participant_events.join_leave",
    ].includes(String(value.trigger))
  ) {
    return undefined;
  }

  return {
    idempotencyKey: value.idempotency_key,
    botId: value.bot_id,
    botMetadata: isRecord(value.bot_metadata) ? value.bot_metadata : undefined,
    trigger: value.trigger as AttendeeWebhookTrigger,
    data: value.data,
  };
}

export function attendeeTranscript(
  event: AttendeeWebhookEvent,
):
  | {
      speakerName: string;
      text: string;
      startMs?: number;
      endMs?: number;
    }
  | undefined {
  if (event.trigger !== "transcript.update") return undefined;
  const transcription = event.data.transcription;
  const text = typeof transcription === "string"
    ? transcription.trim()
    : isRecord(transcription) && typeof transcription.transcript === "string"
      ? transcription.transcript.trim()
      : "";
  if (!text) return undefined;

  const timestampMs = Number(event.data.timestamp_ms);
  const durationMs = Number(event.data.duration_ms);
  const startMs = Number.isFinite(timestampMs)
    ? Math.max(0, Math.round(timestampMs))
    : undefined;
  const endMs = startMs !== undefined && Number.isFinite(durationMs)
    ? startMs + Math.max(0, Math.round(durationMs))
    : undefined;

  return {
    speakerName:
      typeof event.data.speaker_name === "string" && event.data.speaker_name.trim()
        ? event.data.speaker_name.trim().slice(0, 160)
        : "Partecipante",
    text: text.slice(0, 10_000),
    startMs,
    endMs,
  };
}
