export type RecallOutputTranscript = {
  speakerName: string;
  text: string;
  language?: "it" | "en";
  startMs?: number;
  endMs?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function parseRecallOutputTranscript(
  value: unknown,
): RecallOutputTranscript | undefined {
  if (!isRecord(value)) return undefined;
  const nestedData = isRecord(value.data) && isRecord(value.data.data)
    ? value.data.data
    : undefined;
  const transcript = isRecord(value.transcript)
    ? value.transcript
    : nestedData || (isRecord(value.data) ? value.data : undefined);
  if (!transcript || !Array.isArray(transcript.words)) return undefined;

  const words = transcript.words.filter(isRecord);
  const text = words
    .map((word) => (typeof word.text === "string" ? word.text.trim() : ""))
    .filter(Boolean)
    .join(" ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();
  if (!text) return undefined;

  const participant = isRecord(transcript.participant) ? transcript.participant : undefined;
  const firstStartTimestamp = words[0]?.start_timestamp;
  const lastEndTimestamp = words.at(-1)?.end_timestamp;
  const firstStart = isRecord(firstStartTimestamp)
    ? Number(firstStartTimestamp.relative)
    : Number.NaN;
  const lastEnd = isRecord(lastEndTimestamp)
    ? Number(lastEndTimestamp.relative)
    : Number.NaN;
  const languageCode = typeof transcript.language_code === "string"
    ? transcript.language_code.toLocaleLowerCase()
    : "";

  return {
    speakerName:
      participant && typeof participant.name === "string" && participant.name.trim()
        ? participant.name.trim()
        : "Partecipante",
    text,
    language: languageCode.startsWith("en")
      ? "en"
      : languageCode.startsWith("it")
        ? "it"
        : undefined,
    startMs: Number.isFinite(firstStart) ? Math.round(firstStart * 1_000) : undefined,
    endMs: Number.isFinite(lastEnd) ? Math.round(lastEnd * 1_000) : undefined,
  };
}
