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

function normalizedWakePhrase(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function normalizedSpeech(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const SMALL_NUMBERS: Record<string, number> = {
  zero: 0, uno: 1, one: 1, due: 2, two: 2, tre: 3, three: 3,
  quattro: 4, four: 4, cinque: 5, five: 5, sei: 6, six: 6,
  sette: 7, seven: 7, otto: 8, eight: 8, nove: 9, nine: 9,
  dieci: 10, ten: 10, undici: 11, eleven: 11, dodici: 12, twelve: 12,
};

function numberFromSpeech(value: string): number | undefined {
  if (/^\d+$/.test(value)) return Number(value);
  return SMALL_NUMBERS[normalizedSpeech(value)];
}

export function detectElementaryArithmetic(
  statement: string,
): { reason: string; response: string } | undefined {
  const match = /\b(\d+|zero|uno|one|due|two|tre|three|quattro|four|cinque|five|sei|six|sette|seven|otto|eight|nove|nine|dieci|ten)\s*(?:x|per|times)\s*(\d+|zero|uno|one|due|two|tre|three|quattro|four|cinque|five|sei|six|sette|seven|otto|eight|nove|nine|dieci|ten)\s*(?:fa|è|is|equals?)\s*(\d+|zero|uno|one|due|two|tre|three|quattro|four|cinque|five|sei|six|sette|seven|otto|eight|nove|nine|dieci|ten|undici|eleven|dodici|twelve)\b/iu.exec(statement);
  if (!match) return undefined;
  const left = numberFromSpeech(match[1]);
  const right = numberFromSpeech(match[2]);
  const claimed = numberFromSpeech(match[3]);
  if (left === undefined || right === undefined || claimed === undefined) return undefined;
  const actual = left * right;
  if (actual === claimed) return undefined;
  const isEnglish = /\b(?:times|is|equals?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/iu
    .test(statement);
  return {
    reason: "The stated arithmetic result is objectively incorrect.",
    response: isEnglish
      ? `A quick correction: ${left} times ${right} is ${actual}, not ${claimed}.`
      : `Una rapida correzione: ${left} per ${right} fa ${actual}, non ${claimed}.`,
  };
}

export function meetingPermissionDecision(
  text: string,
  wakeWord: string,
): "grant" | "decline" | undefined {
  const spoken = ` ${normalizedSpeech(text)} `;
  const trigger = ` ${normalizedSpeech(wakeWord)} `;
  if (!trigger.trim() || !spoken.includes(trigger)) return undefined;
  if (/\b(?:vai pure|prego|puoi parlare|puoi intervenire|intervieni|dimmi pure|go ahead|you can speak|please speak)\b/iu.test(text)) {
    return "grant";
  }
  if (/\b(?:lascia stare|non ora|abbassa la mano|non intervenire|never mind|not now|lower your hand)\b/iu.test(text)) {
    return "decline";
  }
  return undefined;
}

export function isMeetingWakePhrase(spokenText: string, wakeWord: string): boolean {
  const spoken = normalizedWakePhrase(spokenText);
  const trigger = normalizedWakePhrase(wakeWord);
  if (!spoken || !trigger) return false;
  if (spoken === trigger) return true;

  // Teams captions sometimes split the product name into separate words.
  return trigger === "conclavia" && [
    "conclavia",
    "conlavia",
    "conclava",
    "assistente",
    "collegadigitale",
  ].includes(spoken);
}

export function parseMeetingVoiceCommand(
  spokenText: string,
  wakeWord: string,
): { kind: MeetingCommandKind; prompt: string } | undefined {
  const trigger = wakeWord.trim();
  if (!spokenText.trim() || !trigger) return undefined;
  const escapedTrigger = trigger
    .split(/\s+/)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s+");
  const triggerPattern = normalizedWakePhrase(trigger) === "conclavia"
    ? `(?:${escapedTrigger}|con\\s+clavia|con\\s+la\\s+via|con\\s+lavia|assistente|collega\\s+digitale)`
    : escapedTrigger;
  const triggerMatch = new RegExp(`\\b${triggerPattern}\\b`, "iu").exec(spokenText);
  if (!triggerMatch || triggerMatch.index === undefined) {
    const directAudioCheck = /^\s*(?:ciao|salve|hello|hi)\b.*\b(?:mi\s+senti|can\s+you\s+hear\s+me)\b/iu
      .test(spokenText);
    if (!directAudioCheck) return undefined;
    return {
      kind: "ask",
      prompt: /\bcan\s+you\s+hear\s+me\b/iu.test(spokenText)
        ? "Can you hear me?"
        : "Mi senti?",
    };
  }
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
    {
      kind: "agenda",
      pattern: /^(?:scaletta|agenda|prossimo\s+punto|next\s+(?:agenda\s+)?item)\b\s*/iu,
    },
    { kind: "correct", pattern: /^(?:verifica|correggi|controlla|verify|check)\b\s*/iu },
    { kind: "ask", pattern: /^(?:rispondi|dimmi|answer)\b\s*/iu },
  ];

  for (const rule of rules) {
    if (!rule.pattern.test(request)) continue;
    const prompt = request.replace(rule.pattern, "").trim();
    if (!["summary", "agenda"].includes(rule.kind) && !prompt) return undefined;
    return { kind: rule.kind, prompt };
  }

  if (/\b(?:scaletta|agenda|prossimo\s+punto|next\s+(?:agenda\s+)?item)\b/iu.test(request)) {
    return { kind: "agenda", prompt: request };
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
