import { createHmac, timingSafeEqual } from "node:crypto";

const MAX_WEBHOOK_AGE_SECONDS = 5 * 60;

function header(headers: Headers, current: string, legacy: string): string | null {
  return headers.get(current) || headers.get(legacy);
}

export function verifyRecallWebhook(
  secret: string,
  headers: Headers,
  rawPayload: string,
): void {
  if (!secret.startsWith("whsec_")) {
    throw new Error("Webhook verification is not configured");
  }

  const messageId = header(headers, "webhook-id", "svix-id");
  const timestamp = header(headers, "webhook-timestamp", "svix-timestamp");
  const signatures = header(headers, "webhook-signature", "svix-signature");
  if (!messageId || !timestamp || !signatures) {
    throw new Error("Webhook verification headers are missing");
  }

  const timestampSeconds = Number(timestamp);
  if (
    !Number.isFinite(timestampSeconds) ||
    Math.abs(Date.now() / 1_000 - timestampSeconds) > MAX_WEBHOOK_AGE_SECONDS
  ) {
    throw new Error("Webhook timestamp is outside the accepted window");
  }

  const key = Buffer.from(secret.slice("whsec_".length), "base64");
  const expected = createHmac("sha256", key)
    .update(`${messageId}.${timestamp}.${rawPayload}`)
    .digest();

  const valid = signatures.split(" ").some((candidate) => {
    const [version, encoded] = candidate.split(",");
    if (version !== "v1" || !encoded) return false;
    try {
      const received = Buffer.from(encoded, "base64");
      return received.length === expected.length && timingSafeEqual(received, expected);
    } catch {
      return false;
    }
  });

  if (!valid) throw new Error("Webhook signature does not match");
}

export interface RecallStatusWebhook {
  event: "bot.status_change";
  data: {
    bot_id: string;
    status: {
      code: string;
      created_at: string;
      sub_code: string | null;
      message: string | null;
      recording_id?: string;
    };
  };
}

export function parseRecallStatusWebhook(value: unknown): RecallStatusWebhook | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const event = value as Record<string, unknown>;
  if (event.event !== "bot.status_change" || !event.data || typeof event.data !== "object") {
    return undefined;
  }
  const data = event.data as Record<string, unknown>;
  if (typeof data.bot_id !== "string" || !data.status || typeof data.status !== "object") {
    return undefined;
  }
  const status = data.status as Record<string, unknown>;
  if (typeof status.code !== "string" || typeof status.created_at !== "string") {
    return undefined;
  }

  return {
    event: "bot.status_change",
    data: {
      bot_id: data.bot_id,
      status: {
        code: status.code,
        created_at: status.created_at,
        sub_code: typeof status.sub_code === "string" ? status.sub_code : null,
        message: typeof status.message === "string" ? status.message : null,
        recording_id:
          typeof status.recording_id === "string" ? status.recording_id : undefined,
      },
    },
  };
}
