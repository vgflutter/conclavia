import "server-only";

import {
  getLlmModel,
  type LlmModelId,
  type LlmProvider,
} from "@/lib/llm-models";

const PROVIDER_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_OUTPUT_TOKENS = 900;

export interface GenerationRequest {
  model: LlmModelId;
  instructions: string;
  input: string;
  maxOutputTokens?: number;
  signal?: AbortSignal;
}

interface JsonGenerationRequest extends GenerationRequest {
  schemaName: string;
  schema: Record<string, unknown>;
}

export interface GenerationResult {
  content: string;
  provider: LlmProvider;
  model: LlmModelId;
  inputTokens?: number;
  outputTokens?: number;
}

export class ProviderError extends Error {
  constructor(
    public readonly provider: LlmProvider,
    message: string,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function integer(value: unknown): number | undefined {
  return Number.isInteger(value) && (value as number) >= 0
    ? (value as number)
    : undefined;
}

function providerErrorMessage(
  provider: LlmProvider,
  status: number,
  payload: unknown,
): string {
  const nestedError = isRecord(payload) && isRecord(payload.error)
    ? payload.error
    : undefined;
  const message = nestedError && typeof nestedError.message === "string"
    ? nestedError.message
    : undefined;

  return `${provider === "openai" ? "OpenAI" : "Gemini"} API ${status}${
    message ? `: ${message.slice(0, 300)}` : ""
  }`;
}

function providerSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(PROVIDER_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function parseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function extractOpenAiText(payload: unknown): string {
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

function extractGeminiText(payload: unknown): string {
  if (!isRecord(payload) || !Array.isArray(payload.candidates)) return "";

  const candidate = payload.candidates.find(isRecord);
  if (
    !candidate ||
    !isRecord(candidate.content) ||
    !Array.isArray(candidate.content.parts)
  ) {
    return "";
  }

  return candidate.content.parts
    .filter(
      (part) =>
        isRecord(part) &&
        part.thought !== true &&
        typeof part.text === "string",
    )
    .map((part) => (part as Record<string, unknown>).text as string)
    .join("");
}

async function* readServerSentEvents(
  response: Response,
): AsyncGenerator<unknown> {
  if (!response.body) throw new Error("Streaming response has no body");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const blocks = buffer.split(/\r?\n\r?\n/u);
    buffer = blocks.pop() ?? "";

    for (const block of blocks) {
      const data = block
        .split(/\r?\n/u)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (!data || data === "[DONE]") continue;
      try {
        yield JSON.parse(data) as unknown;
      } catch {
        // Ignore non-JSON keep-alive events emitted by a provider.
      }
    }

    if (done) break;
  }
}

async function generateOpenAiStream(
  request: GenerationRequest,
  onDelta?: (delta: string) => void | Promise<void>,
): Promise<GenerationResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new ProviderError("openai", "OPENAI_API_KEY is not configured");
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: request.model,
      instructions: request.instructions,
      input: request.input,
      reasoning: { effort: "low" },
      text: { verbosity: "low" },
      max_output_tokens:
        request.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
      store: false,
      stream: true,
    }),
    signal: providerSignal(request.signal),
  });

  if (!response.ok) {
    throw new ProviderError(
      "openai",
      providerErrorMessage("openai", response.status, await parseJson(response)),
    );
  }

  let content = "";
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;

  for await (const event of readServerSentEvents(response)) {
    if (!isRecord(event)) continue;
    if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
      content += event.delta;
      await onDelta?.(event.delta);
    }
    if (event.type === "response.completed" && isRecord(event.response)) {
      const usage = isRecord(event.response.usage) ? event.response.usage : undefined;
      inputTokens = integer(usage?.input_tokens);
      outputTokens = integer(usage?.output_tokens);
      if (!content) content = extractOpenAiText(event.response);
    }
    if (event.type === "error") {
      const message = typeof event.message === "string" ? event.message : "stream failed";
      throw new ProviderError("openai", `OpenAI API: ${message}`);
    }
  }

  content = content.trim();
  if (!content) throw new ProviderError("openai", "OpenAI returned no text output");
  return {
    content,
    provider: "openai",
    model: request.model,
    inputTokens,
    outputTokens,
  };
}

async function generateGeminiStream(
  request: GenerationRequest,
  onDelta?: (delta: string) => void | Promise<void>,
): Promise<GenerationResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new ProviderError("gemini", "GEMINI_API_KEY is not configured");
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      request.model,
    )}:streamGenerateContent?alt=sse`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: request.instructions }] },
        contents: [{ role: "user", parts: [{ text: request.input }] }],
        generationConfig: {
          maxOutputTokens:
            request.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
        },
      }),
      signal: providerSignal(request.signal),
    },
  );

  if (!response.ok) {
    throw new ProviderError(
      "gemini",
      providerErrorMessage("gemini", response.status, await parseJson(response)),
    );
  }

  let content = "";
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;

  for await (const chunk of readServerSentEvents(response)) {
    const delta = extractGeminiText(chunk);
    if (delta) {
      content += delta;
      await onDelta?.(delta);
    }
    if (isRecord(chunk) && isRecord(chunk.usageMetadata)) {
      inputTokens = integer(chunk.usageMetadata.promptTokenCount) ?? inputTokens;
      outputTokens = integer(chunk.usageMetadata.candidatesTokenCount) ?? outputTokens;
    }
  }

  content = content.trim();
  if (!content) throw new ProviderError("gemini", "Gemini returned no text output");
  return {
    content,
    provider: "gemini",
    model: request.model,
    inputTokens,
    outputTokens,
  };
}

async function generateOpenAiJson(
  request: JsonGenerationRequest,
): Promise<GenerationResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new ProviderError("openai", "OPENAI_API_KEY is not configured");
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: request.model,
      instructions: request.instructions,
      input: request.input,
      reasoning: { effort: "low" },
      text: {
        verbosity: "low",
        format: {
          type: "json_schema",
          name: request.schemaName,
          schema: request.schema,
          strict: true,
        },
      },
      max_output_tokens: request.maxOutputTokens ?? 4_000,
      store: false,
    }),
    signal: providerSignal(request.signal),
  });
  const payload = await parseJson(response);

  if (!response.ok) {
    throw new ProviderError(
      "openai",
      providerErrorMessage("openai", response.status, payload),
    );
  }

  const content = extractOpenAiText(payload);
  if (!content) throw new ProviderError("openai", "OpenAI returned no JSON output");
  const usage = isRecord(payload) && isRecord(payload.usage) ? payload.usage : undefined;
  return {
    content,
    provider: "openai",
    model: request.model,
    inputTokens: integer(usage?.input_tokens),
    outputTokens: integer(usage?.output_tokens),
  };
}

async function generateGeminiJson(
  request: JsonGenerationRequest,
): Promise<GenerationResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new ProviderError("gemini", "GEMINI_API_KEY is not configured");
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      request.model,
    )}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: request.instructions }] },
        contents: [{ role: "user", parts: [{ text: request.input }] }],
        generationConfig: {
          maxOutputTokens: request.maxOutputTokens ?? 4_000,
          responseFormat: {
            text: {
              mimeType: "application/json",
              schema: request.schema,
            },
          },
        },
      }),
      signal: providerSignal(request.signal),
    },
  );
  const payload = await parseJson(response);

  if (!response.ok) {
    throw new ProviderError(
      "gemini",
      providerErrorMessage("gemini", response.status, payload),
    );
  }

  const content = extractGeminiText(payload).trim();
  if (!content) throw new ProviderError("gemini", "Gemini returned no JSON output");
  const usage = isRecord(payload) && isRecord(payload.usageMetadata)
    ? payload.usageMetadata
    : undefined;
  return {
    content,
    provider: "gemini",
    model: request.model,
    inputTokens: integer(usage?.promptTokenCount),
    outputTokens: integer(usage?.candidatesTokenCount),
  };
}

function parseGeneratedJson<T>(content: string, provider: LlmProvider): T {
  const normalized = content
    .replace(/^```(?:json)?\s*/u, "")
    .replace(/\s*```$/u, "")
    .trim();
  try {
    return JSON.parse(normalized) as T;
  } catch {
    throw new ProviderError(provider, "The provider returned invalid structured output");
  }
}

export function isProviderConfigured(provider: LlmProvider): boolean {
  return provider === "openai"
    ? Boolean(process.env.OPENAI_API_KEY)
    : Boolean(process.env.GEMINI_API_KEY);
}

export async function generateLlmTextStream(
  request: GenerationRequest,
  onDelta?: (delta: string) => void | Promise<void>,
): Promise<GenerationResult> {
  const provider = getLlmModel(request.model).provider;
  return provider === "openai"
    ? generateOpenAiStream(request, onDelta)
    : generateGeminiStream(request, onDelta);
}

export async function generateLlmText(
  request: GenerationRequest,
): Promise<GenerationResult> {
  return generateLlmTextStream(request);
}

export async function generateLlmJson<T>(
  request: JsonGenerationRequest,
): Promise<{ data: T; generation: GenerationResult }> {
  const provider = getLlmModel(request.model).provider;
  const generation =
    provider === "openai"
      ? await generateOpenAiJson(request)
      : await generateGeminiJson(request);
  return { data: parseGeneratedJson<T>(generation.content, provider), generation };
}
