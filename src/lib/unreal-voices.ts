import type { ParticipantSex, VoiceDelivery } from "@/types/talk";

export const UNREAL_VOICE_CATALOG = [
  { id: "Beatrice", languageCode: "it-IT", sex: "female" },
  { id: "Bianca", languageCode: "it-IT", sex: "female" },
  { id: "Lorenzo", languageCode: "it-IT", sex: "male" },
  { id: "Danielle", languageCode: "en-US", sex: "female" },
  { id: "Joanna", languageCode: "en-US", sex: "female" },
  { id: "Ruth", languageCode: "en-US", sex: "female" },
  { id: "Salli", languageCode: "en-US", sex: "female" },
  { id: "Tiffany", languageCode: "en-US", sex: "female" },
  { id: "Matthew", languageCode: "en-US", sex: "male" },
  { id: "Stephen", languageCode: "en-US", sex: "male" },
] as const;

export type UnrealVoiceId = (typeof UNREAL_VOICE_CATALOG)[number]["id"];
export type UnrealSpeechLanguage =
  (typeof UNREAL_VOICE_CATALOG)[number]["languageCode"];

const FEMALE_VOICES: UnrealVoiceId[] = ["Beatrice", "Bianca"];
const MALE_VOICES: UnrealVoiceId[] = ["Lorenzo"];

export function getUnrealVoiceLanguage(
  voice: UnrealVoiceId,
): UnrealSpeechLanguage {
  return UNREAL_VOICE_CATALOG.find((candidate) => candidate.id === voice)
    ?.languageCode ?? "it-IT";
}

export function isUnrealVoice(value: unknown): value is UnrealVoiceId {
  return typeof value === "string"
    && UNREAL_VOICE_CATALOG.some((voice) => voice.id === value);
}

export function getUnrealVoice(
  sex: ParticipantSex,
  index: number,
): UnrealVoiceId {
  const voices = sex === "male" ? MALE_VOICES : FEMALE_VOICES;
  return voices[Math.abs(index) % voices.length];
}

export function unrealVoicePrompt(delivery: VoiceDelivery | undefined): string {
  if (delivery === "energetic") return "con ritmo vivace ed energico";
  if (delivery === "authoritative") return "con tono autorevole e ritmo deciso";
  return "con tono naturale da podcast e ritmo scorrevole";
}
