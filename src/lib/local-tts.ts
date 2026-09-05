import type { AssistantVoiceStyle } from "@/types/assistant-profile";

const MODEL_BASE_PATH = "/api/avatar/voice-assets";
const MODEL_STEPS = 8;

type SupertonicModule = typeof import("@/lib/vendor/supertonic-web.js");
type VoiceEngine = {
  supertonic: SupertonicModule;
  textToSpeech: InstanceType<SupertonicModule["TextToSpeech"]>;
  backend: "webgpu" | "wasm";
};

export type LocalVoiceProgress =
  | { phase: "loading"; current: number; total: number }
  | { phase: "generating"; current: number; total: number };

export type LocalSpeechResult = {
  audio: Blob;
  samples: Float32Array;
  durationSeconds: number;
  backend: "webgpu" | "wasm";
};

let enginePromise: Promise<VoiceEngine> | undefined;
const stylePromises = new Map<AssistantVoiceStyle, Promise<InstanceType<SupertonicModule["Style"]>>>();

function styleFile(style: AssistantVoiceStyle): string {
  return style === "executive_clear" ? "M1.json" : "M3.json";
}

async function createEngine(onProgress?: (progress: LocalVoiceProgress) => void) {
  const supertonic = await import("@/lib/vendor/supertonic-web.js");
  const load = async (backend: "webgpu" | "wasm") => {
    const result = await supertonic.loadTextToSpeech(
      MODEL_BASE_PATH,
      {
        executionProviders: [backend],
        graphOptimizationLevel: "all",
        logSeverityLevel: 3,
      },
      (_modelName, current, total) =>
        onProgress?.({ phase: "loading", current, total }),
    );
    return { supertonic, textToSpeech: result.textToSpeech, backend } satisfies VoiceEngine;
  };

  try {
    return await load("webgpu");
  } catch {
    return load("wasm");
  }
}

async function getEngine(onProgress?: (progress: LocalVoiceProgress) => void) {
  enginePromise ??= createEngine(onProgress).catch((error) => {
    enginePromise = undefined;
    throw error;
  });
  return enginePromise;
}

async function getStyle(engine: VoiceEngine, style: AssistantVoiceStyle) {
  let stylePromise = stylePromises.get(style);
  if (!stylePromise) {
    stylePromise = engine.supertonic
      .loadVoiceStyle([`${MODEL_BASE_PATH}/${styleFile(style)}`])
      .catch((error) => {
        stylePromises.delete(style);
        throw error;
      });
    stylePromises.set(style, stylePromise);
  }
  return stylePromise;
}

export async function prepareLocalVoice(
  voiceStyle: AssistantVoiceStyle,
  onProgress?: (progress: LocalVoiceProgress) => void,
) {
  const engine = await getEngine(onProgress);
  await getStyle(engine, voiceStyle);
  return engine.backend;
}

export async function generateLocalSpeech({
  text,
  language,
  voiceStyle,
  speakingRate,
  onProgress,
}: {
  text: string;
  language: "it" | "en";
  voiceStyle: AssistantVoiceStyle;
  speakingRate: number;
  onProgress?: (progress: LocalVoiceProgress) => void;
}): Promise<LocalSpeechResult> {
  const engine = await getEngine(onProgress);
  const style = await getStyle(engine, voiceStyle);
  const result = await engine.textToSpeech.call(
    text.trim(),
    language,
    style,
    MODEL_STEPS,
    speakingRate,
    0.24,
    (current, total) => onProgress?.({ phase: "generating", current, total }),
  );
  const durationSeconds = result.duration[0] ?? 0;
  const sampleCount = Math.floor(engine.textToSpeech.sampleRate * durationSeconds);
  const wav = result.wav.slice(0, sampleCount);
  const buffer = engine.supertonic.writeWavFile(wav, engine.textToSpeech.sampleRate);

  return {
    audio: new Blob([buffer], { type: "audio/wav" }),
    samples: Float32Array.from(wav),
    durationSeconds,
    backend: engine.backend,
  };
}
