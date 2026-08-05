import "server-only";

import {
  getLlmModel,
  type LlmModelId,
  type LlmProvider,
} from "@/lib/llm-models";

const PROVIDER_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_TOKENS = 800;

interface GenerationRequest {
  model: LlmModelId;
  instructions: string;
  input: string;
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

async function parseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function extractOpenAiText(payload: unknown): string {
  if (!isRecord(payload) || !Array.isArray(payload.output)) {
    return "";
  }

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

async function generateWithOpenAi(
  request: GenerationRequest,
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
      max_output_tokens: MAX_OUTPUT_TOKENS,
      store: false,
    }),
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  });
  const payload = await parseJson(response);

  if (!response.ok) {
    throw new ProviderError(
      "openai",
      providerErrorMessage("openai", response.status, payload),
    );
  }

  const content = extractOpenAiText(payload);
  if (!content) {
    throw new ProviderError("openai", "OpenAI returned no text output");
  }

  const usage = isRecord(payload) && isRecord(payload.usage)
    ? payload.usage
    : undefined;

  return {
    content,
    provider: "openai",
    model: request.model,
    inputTokens: integer(usage?.input_tokens),
    outputTokens: integer(usage?.output_tokens),
  };
}

function extractGeminiText(payload: unknown): string {
  if (!isRecord(payload) || !Array.isArray(payload.candidates)) {
    return "";
  }

  const candidate = payload.candidates.find(isRecord);
  if (!candidate || !isRecord(candidate.content) || !Array.isArray(candidate.content.parts)) {
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
    .join("\n")
    .trim();
}

async function generateWithGemini(
  request: GenerationRequest,
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
        system_instruction: {
          parts: [{ text: request.instructions }],
        },
        contents: [
          {
            role: "user",
            parts: [{ text: request.input }],
          },
        ],
        generationConfig: {
          maxOutputTokens: MAX_OUTPUT_TOKENS,
        },
      }),
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    },
  );
  const payload = await parseJson(response);

  if (!response.ok) {
    throw new ProviderError(
      "gemini",
      providerErrorMessage("gemini", response.status, payload),
    );
  }

  const content = extractGeminiText(payload);
  if (!content) {
    const blocked = isRecord(payload) && isRecord(payload.promptFeedback)
      ? payload.promptFeedback.blockReason
      : undefined;
    throw new ProviderError(
      "gemini",
      typeof blocked === "string"
        ? `Gemini blocked the prompt: ${blocked}`
        : "Gemini returned no text output",
    );
  }

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

export function isProviderConfigured(provider: LlmProvider): boolean {
  return provider === "openai"
    ? Boolean(process.env.OPENAI_API_KEY)
    : Boolean(process.env.GEMINI_API_KEY);
}

export async function generateLlmText(
  request: GenerationRequest,
): Promise<GenerationResult> {
  const provider = getLlmModel(request.model).provider;
  return provider === "openai"
    ? generateWithOpenAi(request)
    : generateWithGemini(request);
}
