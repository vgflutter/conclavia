import type { AvatarViseme } from "@/lib/avatar-visemes";

export type AvatarLipSyncFrame = {
  viseme: AvatarViseme;
  duration: number;
};

function visemeFor(character: string): AvatarViseme {
  const normalized = character.toLocaleLowerCase();
  if (/\s/.test(normalized) || /[.,;:!?]/.test(normalized)) return "rest";
  if (/[mbp]/.test(normalized)) return "mbp";
  if (/[fv]/.test(normalized)) return "fv";
  if (/[aàá]/.test(normalized)) return "a";
  if (/[eèéiyìí]/.test(normalized)) return "e";
  if (/[oòó]/.test(normalized)) return "o";
  if (/[uùú]/.test(normalized)) return "u";
  return "consonant";
}

export function buildAvatarLipSync(text: string): AvatarLipSyncFrame[] {
  const frames: AvatarLipSyncFrame[] = [];
  for (const character of [...text]) {
    const viseme = visemeFor(character);
    const duration = /[.!?]/.test(character)
      ? 3
      : /[,;:]/.test(character)
        ? 2
        : /\s/.test(character)
          ? 0.65
          : 1;
    const previous = frames.at(-1);
    if (previous?.viseme === viseme) previous.duration += duration;
    else frames.push({ viseme, duration });
  }
  return frames;
}

export function avatarVisemeAt(
  frames: AvatarLipSyncFrame[],
  progress: number,
): AvatarViseme {
  const total = frames.reduce((sum, frame) => sum + frame.duration, 0);
  const position = Math.max(0, Math.min(1, progress)) * total;
  let cursor = 0;
  for (const frame of frames) {
    cursor += frame.duration;
    if (position <= cursor) return frame.viseme;
  }
  return "rest";
}

export function avatarVoiceLevelAt(samples: Float32Array, progress: number): number {
  if (!samples.length) return 0;
  const center = Math.floor(Math.max(0, Math.min(1, progress)) * samples.length);
  const from = Math.max(0, center - 384);
  const to = Math.min(samples.length, center + 384);
  let energy = 0;
  for (let index = from; index < to; index += 1) energy += samples[index] ** 2;
  const rms = Math.sqrt(energy / Math.max(1, to - from));
  return Math.min(1, rms * 5.5);
}
