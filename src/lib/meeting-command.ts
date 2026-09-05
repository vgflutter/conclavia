import type {
  MeetingCommandKind,
  MeetingContinuityBriefing,
  MeetingResponse,
} from "@/types/meeting";

const STOP_WORDS = new Set([
  "a", "al", "alla", "and", "che", "come", "con", "cosa", "da", "del", "della",
  "di", "do", "e", "è", "for", "gli", "i", "il", "in", "is", "la", "le", "lo",
  "of", "per", "qual", "quale", "the", "to", "un", "una", "what", "who",
]);

function tokens(value: string): string[] {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

export function parseMeetingVoiceCommand(
  spokenText: string,
  wakeWord: string,
): { kind: MeetingCommandKind; prompt: string } | undefined {
  const trigger = wakeWord.trim();
  if (!spokenText.trim() || !trigger) return undefined;
  const escapedTrigger = trigger.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const triggerMatch = new RegExp(`\\b${escapedTrigger}\\b`, "iu").exec(spokenText);
  if (!triggerMatch || triggerMatch.index === undefined) return undefined;
  const request = spokenText
    .slice(triggerMatch.index + triggerMatch[0].length)
    .replace(/^[\s,.:;!?–—-]+/u, "")
    .trim();
  if (!request) return undefined;

  const rules: Array<{
    kind: MeetingCommandKind;
    pattern: RegExp;
  }> = [
    { kind: "remember", pattern: /^(?:ricorda|remember)(?:\s+(?:che|that))?\s*/iu },
    {
      kind: "summary",
      pattern: /^(?:riepiloga|riassumi|fammi\s+(?:un\s+)?riepilogo|summarize|summary)\b\s*/iu,
    },
    { kind: "correct", pattern: /^(?:verifica|correggi|controlla|verify|check)\b\s*/iu },
    { kind: "ask", pattern: /^(?:rispondi|dimmi|answer)\b\s*/iu },
  ];

  for (const rule of rules) {
    if (!rule.pattern.test(request)) continue;
    const prompt = request.replace(rule.pattern, "").trim();
    if (rule.kind !== "summary" && !prompt) return undefined;
    return { kind: rule.kind, prompt };
  }

  return { kind: "ask", prompt: request };
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.trim().toLocaleLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function meetingMemoryCandidates(
  meeting: MeetingResponse,
  briefing: MeetingContinuityBriefing,
): string[] {
  return unique([
    ...meeting.summary.rememberedFacts,
    ...meeting.summary.decisions,
    ...meeting.summary.actionItems.map((item) =>
      item.owner ? `${item.description} · ${item.owner}` : item.description,
    ),
    ...meeting.summary.openQuestions,
    ...briefing.rememberedFacts,
    ...briefing.decisions,
    ...briefing.actionItems.map((item) =>
      item.owner ? `${item.description} · ${item.owner}` : item.description,
    ),
    ...briefing.openQuestions,
  ]);
}

export function findMemoryMatches(query: string, candidates: string[], limit = 3): string[] {
  const queryTokens = new Set(tokens(query));
  if (!queryTokens.size) return [];

  return candidates
    .map((candidate) => {
      const candidateTokens = new Set(tokens(candidate));
      const score = [...queryTokens].reduce(
        (total, token) => total + (candidateTokens.has(token) ? 1 : 0),
        0,
      );
      return { candidate, score };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map((item) => item.candidate);
}

export function buildLocalMeetingSummary(
  meeting: MeetingResponse,
  briefing: MeetingContinuityBriefing,
  language: "it" | "en" = "it",
): string {
  const isItalian = language === "it";
  const parts: string[] = [
    `${isItalian ? "Obiettivo" : "Objective"}: ${meeting.objective}`,
  ];
  const covered = meeting.agenda.filter((item) => item.status === "covered");
  const pendingMandatory = meeting.agenda.filter(
    (item) => item.mandatory && item.status !== "covered",
  );
  if (covered.length) parts.push(`${isItalian ? "Scaletta coperta" : "Agenda covered"}: ${covered.map((item) => item.title).join("; ")}.`);
  if (pendingMandatory.length) parts.push(`${isItalian ? "Punti obbligatori ancora aperti" : "Mandatory items still open"}: ${pendingMandatory.map((item) => item.title).join("; ")}.`);
  if (meeting.summary.rememberedFacts.length) parts.push(`${isItalian ? "Da ricordare" : "Remembered"}: ${meeting.summary.rememberedFacts.join("; ")}.`);
  if (meeting.summary.decisions.length) parts.push(`${isItalian ? "Decisioni" : "Decisions"}: ${meeting.summary.decisions.join("; ")}.`);
  const openActions = [...meeting.summary.actionItems, ...briefing.actionItems].filter((item) => !item.completed);
  if (openActions.length) parts.push(`${isItalian ? "Attività aperte" : "Open actions"}: ${openActions.map((item) => item.description).join("; ")}.`);
  if (meeting.summary.openQuestions.length) parts.push(`${isItalian ? "Questioni aperte" : "Open questions"}: ${meeting.summary.openQuestions.join("; ")}.`);
  return parts.join("\n");
}
