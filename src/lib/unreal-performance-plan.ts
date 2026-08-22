import type {
  TalkRunIntent,
  TalkRunMessageResponse,
} from "@/types/talk-run";

export const UNREAL_PERFORMANCE_MOODS = [
  "neutral",
  "happiness",
  "sadness",
  "disgust",
  "anger",
  "surprise",
  "fear",
  "confidence",
  "excitement",
  "boredom",
  "playfulness",
  "confusion",
] as const;

export const UNREAL_PERFORMANCE_FOCUSES = [
  "camera",
  "target",
  "thought",
] as const;

export const UNREAL_PERFORMANCE_GESTURES = [
  "none",
  "nod",
  "tilt",
  "emphasis",
  "settle",
  "raise-hand",
  "lower-hand",
] as const;

export type UnrealPerformanceMood =
  (typeof UNREAL_PERFORMANCE_MOODS)[number];
export type UnrealPerformanceFocus =
  (typeof UNREAL_PERFORMANCE_FOCUSES)[number];
export type UnrealPerformanceGesture =
  (typeof UNREAL_PERFORMANCE_GESTURES)[number];

export interface UnrealPerformanceBeat {
  atMs: number;
  mood: UnrealPerformanceMood;
  intensity: number;
  focus: UnrealPerformanceFocus;
  gesture: UnrealPerformanceGesture;
}

interface PerformancePreset {
  mood: UnrealPerformanceMood;
  intensity: number;
  focus: UnrealPerformanceFocus;
  gesture: UnrealPerformanceGesture;
}

interface CandidateBeat extends PerformancePreset {
  atMs: number;
  priority: number;
}

const INTENT_PRESETS: Record<TalkRunIntent, PerformancePreset> = {
  opening: {
    mood: "confidence",
    intensity: 0.48,
    focus: "camera",
    gesture: "settle",
  },
  argument: {
    mood: "confidence",
    intensity: 0.5,
    focus: "camera",
    gesture: "none",
  },
  reply: {
    mood: "confidence",
    intensity: 0.54,
    focus: "target",
    gesture: "emphasis",
  },
  challenge: {
    mood: "anger",
    intensity: 0.62,
    focus: "target",
    gesture: "emphasis",
  },
  question: {
    mood: "confusion",
    intensity: 0.52,
    focus: "target",
    gesture: "tilt",
  },
  answer: {
    mood: "confidence",
    intensity: 0.5,
    focus: "target",
    gesture: "nod",
  },
  clarification: {
    mood: "confusion",
    intensity: 0.48,
    focus: "target",
    gesture: "tilt",
  },
  partial_agreement: {
    mood: "happiness",
    intensity: 0.64,
    focus: "target",
    gesture: "nod",
  },
  interruption: {
    mood: "excitement",
    intensity: 0.7,
    focus: "target",
    gesture: "emphasis",
  },
  moderation: {
    mood: "confidence",
    intensity: 0.44,
    focus: "camera",
    gesture: "settle",
  },
  closing: {
    mood: "confidence",
    intensity: 0.54,
    focus: "camera",
    gesture: "nod",
  },
};

export const UNREAL_EXPRESSION_DIAGNOSTIC_MOODS =
  UNREAL_PERFORMANCE_MOODS;

/**
 * Stable, shuffled decks make the visual experiment look random without
 * letting the HUD and the cue disagree. Every twelve interventions exercise
 * every commercial-solver mood exactly once; the next block changes order so
 * a new stretch of dialogue does not repeat the same emotional cadence.
 */
const UNREAL_EXPRESSION_DIAGNOSTIC_DECKS = [
  [
    "anger",
    "surprise",
    "confidence",
    "disgust",
    "fear",
    "happiness",
    "confusion",
    "excitement",
    "boredom",
    "playfulness",
    "sadness",
    "neutral",
  ],
  [
    "playfulness",
    "fear",
    "anger",
    "happiness",
    "confusion",
    "disgust",
    "excitement",
    "confidence",
    "sadness",
    "surprise",
    "neutral",
    "boredom",
  ],
  [
    "disgust",
    "confidence",
    "surprise",
    "boredom",
    "happiness",
    "anger",
    "playfulness",
    "sadness",
    "fear",
    "neutral",
    "confusion",
    "excitement",
  ],
] as const satisfies readonly (readonly UnrealPerformanceMood[])[];

export interface UnrealExpressionDiagnostic {
  sequence: number;
  step: number;
  total: number;
  mood: UnrealPerformanceMood;
  intensity: number;
}

/**
 * Pseudo-random but repeatable visual audit. The intervention number selects a
 * shuffled deck and position, which keeps retries debuggable while guaranteeing
 * full coverage of the twelve solver states. Neutral is the control; every
 * other state is driven at full intensity so a missing expression cannot be
 * mistaken for a timid casting choice.
 */
export function unrealExpressionDiagnostic(
  message: TalkRunMessageResponse,
): UnrealExpressionDiagnostic {
  const sequence = Math.max(1, Math.round(message.sequence));
  const zeroBasedSequence = sequence - 1;
  const total = UNREAL_EXPRESSION_DIAGNOSTIC_MOODS.length;
  const deckIndex = Math.floor(zeroBasedSequence / total);
  const deck =
    UNREAL_EXPRESSION_DIAGNOSTIC_DECKS[
      deckIndex % UNREAL_EXPRESSION_DIAGNOSTIC_DECKS.length
    ];
  const index = zeroBasedSequence % total;
  const mood = deck[index];
  return {
    sequence,
    step: index + 1,
    total,
    mood,
    intensity: mood === "neutral" ? 0 : 1,
  };
}

function clampIntensity(value: number): number {
  // The commercial solver accepts 0..1 and its own default is 1. Keeping the
  // production score in this narrower band makes the performance visible
  // without turning a discussion into theatrical mugging.
  return Math.round(Math.min(0.72, Math.max(0.44, value)) * 100) / 100;
}

function utterancePreset(
  message: TalkRunMessageResponse,
  content: string,
): PerformancePreset {
  const base = INTENT_PRESETS[message.intent];

  // Select the acting direction once, before speech starts. The commercial
  // model then owns the continuous full-face solve; switching mood midway
  // through an utterance is both less natural and more prone to visible pops.
  if (
    /\b(?:assurdo|incredibile|sorprendente|inaspettato|davvero\?|absurd|incredible|surprising|unexpected|really\?)\b/u.test(
      content,
    )
  ) {
    return {
      ...base,
      mood: "surprise",
      intensity: clampIntensity(Math.max(base.intensity, 0.62)),
    };
  }

  if (
    message.intent !== "challenge" &&
    message.intent !== "interruption" &&
    /\b(?:concordo|hai ragione|d['’]accordo|punto valido|giusto|agree|you['’]re right|valid point)\b/u.test(
      content,
    )
  ) {
    return {
      ...base,
      mood: "happiness",
      intensity: clampIntensity(Math.max(base.intensity, 0.62)),
    };
  }

  return base;
}

function clampAtMs(value: number, durationMs: number): number {
  return Math.round(Math.min(durationMs - 650, Math.max(700, value)));
}

function candidateAt(
  content: string,
  pattern: RegExp,
  durationMs: number,
  preset: PerformancePreset,
  priority: number,
): CandidateBeat | undefined {
  const match = pattern.exec(content);
  if (!match || content.length === 0) return undefined;
  const progress = Math.min(0.9, Math.max(0.08, match.index / content.length));
  return {
    atMs: clampAtMs(progress * durationMs, durationMs),
    ...preset,
    priority,
  };
}

function closingPreset(message: TalkRunMessageResponse): PerformancePreset {
  const base = INTENT_PRESETS[message.intent];
  return {
    // Keep one emotional identity for the whole intervention. The commercial
    // solver supplies continuous full-face motion; changing its mood enum in
    // the middle of a phoneme produces a visible discontinuity.
    mood: base.mood,
    intensity: clampIntensity(
      base.intensity +
        (message.arcPhase === "conclusion" || message.intent === "closing"
          ? 0.06
          : -0.08),
    ),
    focus:
      message.arcPhase === "conclusion" || message.intent === "closing"
        ? "camera"
        : "target",
    gesture: "nod",
  };
}

function fallbackBeat(
  message: TalkRunMessageResponse,
  durationMs: number,
): CandidateBeat {
  const base = INTENT_PRESETS[message.intent];
  if (message.intent === "challenge" || message.intent === "interruption") {
    return {
      atMs: Math.round(durationMs * 0.56),
      mood: base.mood,
      intensity: clampIntensity(base.intensity + 0.08),
      focus: "target",
      gesture: "emphasis",
      priority: 1,
    };
  }
  if (
    message.intent === "question" ||
    message.intent === "clarification"
  ) {
    return {
      atMs: Math.round(durationMs * 0.58),
      mood: base.mood,
      intensity: clampIntensity(base.intensity + 0.06),
      focus: "target",
      gesture: "tilt",
      priority: 1,
    };
  }
  return {
    atMs: Math.round(durationMs * 0.62),
    ...closingPreset(message),
    priority: 1,
  };
}

/**
 * Builds a compact performance score for the commercial facial solver. During
 * this diagnostic the mood is selected deterministically from the intervention
 * number and kept at one exact intensity for the entire utterance.
 */
function singleMoodPerformancePlan(
  message: TalkRunMessageResponse,
  durationMs: number,
): UnrealPerformanceBeat[] {
  const safeDurationMs = Math.max(2_000, Math.min(60_000, durationMs));
  const content = message.content.normalize("NFC").toLocaleLowerCase("it");
  const diagnostic = unrealExpressionDiagnostic(message);
  const editorialPreset = utterancePreset(message, content);
  const base: PerformancePreset = {
    ...editorialPreset,
    mood: diagnostic.mood,
    intensity: diagnostic.intensity,
  };
  const candidates: CandidateBeat[] = [];

  const agreement = candidateAt(
    content,
    /\b(?:s[iì]|concordo|capisco|giusto|vero|d['’]accordo|yes|agree|understand|right|true)\b/u,
    safeDurationMs,
    {
      mood: base.mood,
      intensity: clampIntensity(base.intensity + 0.04),
      focus: "target",
      gesture: "nod",
    },
    4,
  );
  const contrast = candidateAt(
    content,
    /\b(?:ma|per[oò]|tuttavia|invece|eppure|but|however|instead|yet)\b/u,
    safeDurationMs,
    {
      mood: base.mood,
      intensity: clampIntensity(base.intensity + 0.1),
      focus: "target",
      gesture: "emphasis",
    },
    5,
  );
  const question = candidateAt(
    content,
    /\b(?:perch[eé]|come|quale|davvero|cosa|why|how|which|really|what)\b|\?/u,
    safeDurationMs,
    {
      mood: base.mood,
      intensity: clampIntensity(base.intensity + 0.06),
      focus: "target",
      gesture: "tilt",
    },
    3,
  );
  const surprise = candidateAt(
    content,
    /\b(?:assurdo|incredibile|sorprendente|inaspettato|absurd|incredible|surprising|unexpected)\b/u,
    safeDurationMs,
    {
      mood: base.mood,
      intensity: clampIntensity(base.intensity + 0.1),
      focus: "camera",
      gesture: "emphasis",
    },
    4,
  );
  const conclusion = candidateAt(
    content,
    /\b(?:quindi|dunque|insomma|concludendo|in conclusione|in sintesi|therefore|so|ultimately|in conclusion|in summary)\b/u,
    safeDurationMs,
    closingPreset(message),
    6,
  );

  for (const candidate of [
    agreement,
    contrast,
    question,
    surprise,
    conclusion,
  ]) {
    if (candidate) candidates.push(candidate);
  }

  if (safeDurationMs >= 3_200 && candidates.length === 0) {
    candidates.push(fallbackBeat(message, safeDurationMs));
  }

  const maxBeats = safeDurationMs < 4_000 ? 2 : safeDurationMs < 9_000 ? 3 : 4;
  const selected: CandidateBeat[] = [];
  for (const candidate of candidates
    .sort((left, right) => right.priority - left.priority)
    .slice(0, maxBeats - 1)
    .sort((left, right) => left.atMs - right.atMs)) {
    const previous = selected.at(-1);
    if (previous && candidate.atMs - previous.atMs < 1_350) {
      if (candidate.priority > previous.priority) selected[selected.length - 1] = candidate;
      continue;
    }
    selected.push(candidate);
  }

  const beats: UnrealPerformanceBeat[] = [
    { atMs: 0, ...base },
    ...selected.map((beat) => ({
      atMs: beat.atMs,
      mood: base.mood,
      intensity: base.intensity,
      focus: beat.focus,
      gesture: beat.gesture,
    })),
  ];

  // Let the performance breathe back down before the cut. This is deliberately
  // sparse and slow: the solver still owns brows, cheeks, eyes and phonemes.
  if (safeDurationMs >= 4_400 && beats.length < 4) {
    const settleAtMs = Math.round(safeDurationMs * 0.82);
    if (settleAtMs - beats.at(-1)!.atMs >= 1_350) {
      beats.push({
        atMs: settleAtMs,
        mood: base.mood,
        // Do not erase the performance before the cut. Earlier we backed the
        // mood down so far that the second half of every intervention returned
        // to the same mannequin-like neutral face.
        intensity: base.intensity,
        focus:
          message.arcPhase === "conclusion" || message.intent === "closing"
            ? "camera"
            : base.focus,
        gesture:
          message.arcPhase === "conclusion" || message.intent === "closing"
            ? "nod"
            : "settle",
      });
    }
  }

  return beats;
}

const SENTENCE_TRANSITION_MOODS = [
  "confidence",
  "surprise",
  "playfulness",
  "anger",
  "happiness",
  "confusion",
  "excitement",
  "disgust",
  "sadness",
  "fear",
  "boredom",
] as const satisfies readonly UnrealPerformanceMood[];

function sentenceChunks(content: string): string[] {
  const chunks = Array.from(
    content.normalize("NFC").matchAll(/[^.!?…]+(?:[.!?…]+|$)/gu),
    (match) => match[0].trim(),
  ).filter(Boolean);

  if (chunks.length <= 4) return chunks;

  // Four sentences already exercise three transitions and ten solver beats.
  // Keep the remaining text in the last acting unit instead of exceeding the
  // compact realtime score sent to Unreal.
  return [...chunks.slice(0, 3), chunks.slice(3).join(" ")];
}

function sentenceWeight(sentence: string): number {
  const wordCount = sentence.split(/\s+/u).filter(Boolean).length;
  const punctuationPause = /[!?]$/u.test(sentence) ? 1.6 : 1.1;
  return Math.max(1, wordCount) + punctuationPause;
}

function sentenceBoundaries(sentences: string[], durationMs: number): number[] {
  const weights = sentences.map(sentenceWeight);
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  let elapsedWeight = 0;

  return weights.slice(0, -1).map((weight) => {
    elapsedWeight += weight;
    return Math.round((elapsedWeight / totalWeight) * durationMs);
  });
}

function sentenceMoodSequence(
  message: TalkRunMessageResponse,
  count: number,
): UnrealPerformanceMood[] {
  const diagnostic = unrealExpressionDiagnostic(message);
  const firstMood =
    diagnostic.mood === "neutral" ? "confidence" : diagnostic.mood;
  const rotation = (Math.max(1, Math.round(message.sequence)) - 1) %
    SENTENCE_TRANSITION_MOODS.length;
  const rotated = [
    ...SENTENCE_TRANSITION_MOODS.slice(rotation),
    ...SENTENCE_TRANSITION_MOODS.slice(0, rotation),
  ];
  const moods: UnrealPerformanceMood[] = [firstMood];

  for (const mood of rotated) {
    if (moods.length >= count) break;
    if (mood !== moods.at(-1) && !moods.includes(mood)) moods.push(mood);
  }

  return moods;
}

function sentenceMoodIntensity(
  mood: UnrealPerformanceMood,
  sentenceIndex: number,
): number {
  if (mood === "boredom" || mood === "sadness") return 0.88;
  if (mood === "fear" || mood === "confusion") return 0.92;
  return sentenceIndex % 2 === 0 ? 1 : 0.96;
}

function sentenceDirection(mood: UnrealPerformanceMood): Pick<
  PerformancePreset,
  "focus" | "gesture"
> {
  switch (mood) {
    case "anger":
    case "disgust":
      return { focus: "target", gesture: "emphasis" };
    case "confusion":
    case "fear":
      return { focus: "thought", gesture: "tilt" };
    case "happiness":
    case "confidence":
      return { focus: "camera", gesture: "nod" };
    case "surprise":
    case "excitement":
    case "playfulness":
      return { focus: "camera", gesture: "emphasis" };
    default:
      return { focus: "target", gesture: "settle" };
  }
}

/**
 * Diagnostic sentence score. Every complete sentence gets its own stable mood.
 * Around punctuation the previous expression fades down, the next mood is
 * selected close to neutral, then it rises smoothly while the new sentence is
 * spoken. This isolates transition quality before editorial AI chooses moods.
 */
export function unrealPerformancePlan(
  message: TalkRunMessageResponse,
  durationMs: number,
): UnrealPerformanceBeat[] {
  const safeDurationMs = Math.max(2_000, Math.min(60_000, durationMs));
  const sentences = sentenceChunks(message.content);
  if (sentences.length < 2) {
    return singleMoodPerformancePlan(message, safeDurationMs);
  }

  const moods = sentenceMoodSequence(message, sentences.length);
  const boundaries = sentenceBoundaries(sentences, safeDurationMs);
  const firstDirection = sentenceDirection(moods[0]);
  const beats: UnrealPerformanceBeat[] = [
    {
      atMs: 0,
      mood: moods[0],
      intensity: sentenceMoodIntensity(moods[0], 0),
      ...firstDirection,
    },
  ];

  for (const [index, rawBoundary] of boundaries.entries()) {
    const nextMood = moods[index + 1];
    if (!nextMood) break;

    const previousAtMs = beats.at(-1)?.atMs ?? 0;
    const followingBoundary = boundaries[index + 1] ?? safeDurationMs;
    const fadeAtMs = Math.max(previousAtMs + 180, rawBoundary - 420);
    const switchAtMs = Math.max(fadeAtMs + 180, rawBoundary - 70);
    const riseAtMs = Math.min(
      followingBoundary - 260,
      Math.max(switchAtMs + 240, rawBoundary + 260),
    );

    // Very short sentences cannot contain a clean three-stage transition. In
    // that rare case preserve the prior performance instead of producing a
    // visible snap just to exercise another mood.
    if (riseAtMs <= switchAtMs + 120 || riseAtMs >= safeDurationMs - 180) {
      continue;
    }

    const previous = beats.at(-1)!;
    beats.push({
      atMs: fadeAtMs,
      mood: previous.mood,
      intensity: 0.18,
      focus: previous.focus,
      gesture: "none",
    });
    beats.push({
      atMs: switchAtMs,
      mood: nextMood,
      intensity: 0.18,
      focus: sentenceDirection(nextMood).focus,
      gesture: "none",
    });
    beats.push({
      atMs: riseAtMs,
      mood: nextMood,
      intensity: sentenceMoodIntensity(nextMood, index + 1),
      ...sentenceDirection(nextMood),
    });
  }

  return beats.slice(0, 12);
}
