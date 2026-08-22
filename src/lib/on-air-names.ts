import type { Participant, TalkResponse } from "@/types/talk";

const VIRTUAL_CAST_NAMES = {
  it: [
    "Giulia Ferri",
    "Lorenzo Vitale",
    "Marta Leone",
    "Davide Serra",
    "Elena Riva",
  ],
  en: [
    "Maya Bennett",
    "Ethan Cole",
    "Nora Ellis",
    "Leo Foster",
    "Clara Reed",
  ],
} as const;

function languageKey(language: string): keyof typeof VIRTUAL_CAST_NAMES {
  return language.trim().toLowerCase().startsWith("it") ? "it" : "en";
}

export function virtualParticipantName(index: number, language: string): string {
  const names = VIRTUAL_CAST_NAMES[languageKey(language)];
  return names[index % names.length];
}

export function onAirParticipantName(
  participant: Pick<Participant, "kind" | "name">,
  index: number,
  language: string,
): string {
  if (
    participant.kind === "ai" &&
    /^AI\s*[-_ ]?\d+$/iu.test(participant.name.trim())
  ) {
    return virtualParticipantName(index, language);
  }
  return participant.name;
}

export function normalizeTalkOnAirNames(talk: TalkResponse): TalkResponse {
  const participants = talk.participants.map((participant, index) => ({
    ...participant,
    name: onAirParticipantName(participant, index, talk.language),
    role:
      participant.kind === "ai" &&
      /^(Partecipante AI|AI participant)$/iu.test(participant.role.trim())
        ? talk.language.trim().toLowerCase().startsWith("it")
          ? "Ospite virtuale"
          : "Virtual guest"
        : participant.role,
  }));
  const moderatorName = talk.moderator.name?.trim();
  const moderator =
    talk.moderator.kind === "ai" &&
    (!moderatorName || /^(Conduttore AI|AI host)$/iu.test(moderatorName))
      ? {
          ...talk.moderator,
          name: talk.language.trim().toLowerCase().startsWith("it")
            ? "Andrea Conti"
            : "Alex Morgan",
          role: talk.language.trim().toLowerCase().startsWith("it")
            ? "Conduttore"
            : "Host",
        }
      : talk.moderator;

  return { ...talk, participants, moderator };
}
