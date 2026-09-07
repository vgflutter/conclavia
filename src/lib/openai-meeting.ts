import "server-only";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const DEFAULT_MODEL = "gpt-5.4-mini";
const REQUEST_TIMEOUT_MS = 12_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function outputText(payload: unknown): string {
  if (!isRecord(payload) || !Array.isArray(payload.output)) return "";

  return payload.output
    .flatMap((item) =>
      isRecord(item) && Array.isArray(item.content) ? item.content : [],
    )
    .filter(
      (part) =>
        isRecord(part) &&
        part.type === "output_text" &&
        typeof part.text === "string",
    )
    .map((part) => (part as Record<string, unknown>).text as string)
    .join("\n")
    .trim();
}

export function isMeetingIntelligenceConfigured(): boolean {
  return (
    process.env.MEETING_AI_ENABLED === "true" &&
    Boolean(process.env.OPENAI_API_KEY?.trim())
  );
}

export async function generateMeetingIntelligence({
  instructions,
  input,
  maxOutputTokens = 220,
  promptCacheKey,
}: {
  instructions: string;
  input: string;
  maxOutputTokens?: number;
  promptCacheKey?: string;
}): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("Meeting intelligence is not configured");

  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MEETING_MODEL?.trim() || DEFAULT_MODEL,
      instructions,
      input,
      reasoning: { effort: "none" },
      text: { verbosity: "low" },
      max_output_tokens: maxOutputTokens,
      ...(promptCacheKey ? { prompt_cache_key: promptCacheKey.slice(0, 64) } : {}),
      store: false,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  const payload = (await response.json().catch(() => undefined)) as unknown;
  if (!response.ok) {
    throw new Error(`Meeting intelligence request failed with status ${response.status}`);
  }

  const content = outputText(payload);
  if (!content) throw new Error("Meeting intelligence returned no text");
  return content.slice(0, 8_000);
}

export async function generateMeetingStructured<T>({
  instructions,
  input,
  schemaName,
  schema,
  maxOutputTokens = 220,
  promptCacheKey,
}: {
  instructions: string;
  input: string;
  schemaName: string;
  schema: Record<string, unknown>;
  maxOutputTokens?: number;
  promptCacheKey?: string;
}): Promise<T> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("Meeting intelligence is not configured");

  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MEETING_MODEL?.trim() || DEFAULT_MODEL,
      instructions,
      input,
      reasoning: { effort: "none" },
      text: {
        verbosity: "low",
        format: {
          type: "json_schema",
          name: schemaName,
          strict: true,
          schema,
        },
      },
      max_output_tokens: maxOutputTokens,
      ...(promptCacheKey ? { prompt_cache_key: promptCacheKey.slice(0, 64) } : {}),
      store: false,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  const payload = (await response.json().catch(() => undefined)) as unknown;
  if (!response.ok) {
    throw new Error(`Meeting intelligence request failed with status ${response.status}`);
  }
  const content = outputText(payload);
  if (!content) throw new Error("Meeting intelligence returned no structured output");
  return JSON.parse(content) as T;
}
