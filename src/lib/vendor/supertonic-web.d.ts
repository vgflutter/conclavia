export class Style {
  ttl: unknown;
  dp: unknown;
}

export class TextToSpeech {
  sampleRate: number;
  call(
    text: string,
    lang: string,
    style: Style,
    totalStep: number,
    speed?: number,
    silenceDuration?: number,
    progressCallback?: (step: number, total: number) => void,
  ): Promise<{ wav: number[]; duration: number[] }>;
}

export function loadVoiceStyle(paths: string[]): Promise<Style>;
export function loadTextToSpeech(
  onnxDir: string,
  sessionOptions?: Record<string, unknown>,
  progressCallback?: (modelName: string, current: number, total: number) => void,
): Promise<{ textToSpeech: TextToSpeech; cfgs: unknown }>;
export function writeWavFile(audioData: number[], sampleRate: number): ArrayBuffer;
