export const LLM_MODELS = [
  {
    id: "gpt-5.6-sol",
    provider: "openai",
    label: "GPT-5.6 Sol",
    descriptionKey: "modelGptSolDescription",
  },
  {
    id: "gpt-5.6-terra",
    provider: "openai",
    label: "GPT-5.6 Terra",
    descriptionKey: "modelGptTerraDescription",
  },
  {
    id: "gemini-3.6-flash",
    provider: "gemini",
    label: "Gemini 3.6 Flash",
    descriptionKey: "modelGeminiFlashDescription",
  },
  {
    id: "gemini-3.5-flash-lite",
    provider: "gemini",
    label: "Gemini 3.5 Flash-Lite",
    descriptionKey: "modelGeminiFlashLiteDescription",
  },
] as const;

export type LlmModel = (typeof LLM_MODELS)[number];
export type LlmModelId = LlmModel["id"];
export type LlmProvider = LlmModel["provider"];

export const DEFAULT_LLM_MODEL: LlmModelId = "gpt-5.6-sol";
export const LLM_MODEL_IDS = LLM_MODELS.map((model) => model.id);

export function isLlmModelId(value: unknown): value is LlmModelId {
  return (
    typeof value === "string" &&
    LLM_MODEL_IDS.some((modelId) => modelId === value)
  );
}

export function getLlmModel(modelId: LlmModelId): LlmModel {
  return LLM_MODELS.find((model) => model.id === modelId) ?? LLM_MODELS[0];
}
