import type { TalkResponse, TalkPace } from "@/types/talk";
import type {
  TalkRunArcPhase,
  TalkRunDiscussionState,
  TalkRunFloorRequest,
  TalkRunIntent,
  TalkRunMessageResponse,
  TalkRunResponse,
  TalkRunTurnPlan,
} from "@/types/talk-run";

export const TALK_ARC_PHASES: TalkRunArcPhase[] = [
  "positions",
  "conflict",
  "examination",
  "synthesis",
  "conclusion",
];

const ARC_OBJECTIVES: Record<TalkRunArcPhase, string> = {
  positions: "Make the genuinely different starting positions explicit.",
  conflict: "Isolate the central incompatibility instead of multiplying side topics.",
  examination: "Test the central claims against objections, consequences, and exceptions.",
  synthesis: "Clarify conditions, revisions, and the strongest remaining disagreement.",
  conclusion: "State what the discussion established and why disagreement remains, if it does.",
};

export function minimumMeaningfulTurns(maxTurns: number): number {
  return Math.min(maxTurns, Math.max(5, Math.ceil(maxTurns * 0.5)));
}

export function shouldReviewAfterTurn(
  run: TalkRunResponse,
  plan: TalkRunTurnPlan,
): boolean {
  if (plan.speakerType !== "participant" || plan.intent === "closing") {
    return false;
  }
  const nextCount = run.participantTurnCount + 1;
  const plannedSeconds = estimateAirtimeSeconds(plan.maxWords, plan.speakerType);
  const timeLimitApproaching =
    run.estimatedAirtimeSeconds + plannedSeconds >=
    run.targetDurationMinutes * 60 * 0.92;
  if (timeLimitApproaching) return true;
  if (run.discussionState.arcPhase === "synthesis") return nextCount % 2 === 0;
  const lateArc = run.discussionState.arcPhase === "examination";
  return (
    nextCount >= run.maxTurns ||
    (lateArc ? nextCount % 3 === 0 : nextCount % 4 === 0)
  );
}

const BASE_WORD_RANGES: Record<TalkRunIntent, [number, number]> = {
  opening: [38, 70],
  argument: [42, 88],
  reply: [18, 48],
  challenge: [18, 45],
  question: [9, 25],
  answer: [24, 62],
  clarification: [20, 52],
  partial_agreement: [16, 42],
  interruption: [8, 20],
  moderation: [10, 28],
  closing: [45, 78],
};

const PACE_SCALE: Record<TalkPace, number> = {
  fast: 0.66,
  balanced: 0.9,
  deep: 1.12,
};

export function estimateAirtimeSeconds(
  wordCount: number,
  speakerType: TalkRunTurnPlan["speakerType"],
): number {
  const wordsPerMinute = speakerType === "moderator" ? 185 : 170;
  const studioTransitionSeconds = 1;
  return Math.max(
    studioTransitionSeconds,
    Math.ceil((wordCount / wordsPerMinute) * 60) + studioTransitionSeconds,
  );
}

function remainingTimeRatio(run: TalkRunResponse): number {
  const target = Math.max(60, run.targetDurationMinutes * 60);
  return Math.max(0, (target - run.estimatedAirtimeSeconds) / target);
}

function boundedText(value: string, maximum = 90): string {
  const normalized = value.replace(/\s+/gu, " ").trim();
  if (normalized.length <= maximum) return normalized;
  return `${normalized.slice(0, maximum - 1).trimEnd()}…`;
}

function editorialLabel(value: string): string {
  const normalized = boundedText(value, 72);
  const words = normalized.split(/\s+/u);
  if (words.length <= 9) return normalized;
  return `${words.slice(0, 9).join(" ").replace(/[,:;.!?…]+$/u, "")}…`;
}

function wordRange(
  intent: TalkRunIntent,
  pace: TalkPace,
  timeRatio = 1,
  seed: string = intent,
): [number, number] {
  const [baseMin, baseMax] = BASE_WORD_RANGES[intent];
  const timeScale = timeRatio <= 0.1 ? 0.58 : timeRatio <= 0.22 ? 0.76 : 1;
  const scale = PACE_SCALE[pace] * timeScale;
  const scaledMin = Math.max(8, Math.round(baseMin * scale));
  const scaledMax = Math.max(scaledMin + 4, Math.round(baseMax * scale));
  const spread = scaledMax - scaledMin;
  const target = scaledMin + Math.round((spread * stableJitter(seed)) / 30);
  const tolerance = Math.max(3, Math.round(spread * 0.12));

  return [
    Math.max(scaledMin, target - tolerance),
    Math.min(scaledMax, target + tolerance),
  ];
}

function stableJitter(seed: string): number {
  let hash = 2166136261;
  for (const character of seed) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash % 31);
}

function participantMessages(messages: TalkRunMessageResponse[]) {
  return messages.filter(
    (message): message is TalkRunMessageResponse & { participantIndex: number } =>
      message.speakerType === "participant" &&
      message.participantIndex !== undefined,
  );
}

function discussionFocus(talk: TalkResponse, run: TalkRunResponse): string {
  if (run.discussionState.arcPhase === "conflict" && run.discussionState.keyConflict) {
    return editorialLabel(run.discussionState.keyConflict);
  }
  const openQuestion = run.discussionState.openQuestions.at(-1);
  if (openQuestion) return editorialLabel(openQuestion);
  if (run.discussionState.currentFocus) {
    return editorialLabel(run.discussionState.currentFocus);
  }
  return editorialLabel(talk.topic);
}

function shouldHostIntervene(talk: TalkResponse, run: TalkRunResponse): boolean {
  if (talk.moderator.kind === "none" || run.participantTurnCount === 0) {
    return false;
  }

  if (run.messages.at(-1)?.speakerType === "moderator") return false;
  if (run.participantTurnCount >= run.maxTurns) return false;

  const interval =
    talk.moderator.style === "challenging"
      ? 2
      : talk.moderator.style === "facilitating"
        ? 4
        : 3;
  const scheduled = run.participantTurnCount % interval === 0;
  const timeCheck =
    talk.moderator.manageTime &&
    (run.maxTurns - run.participantTurnCount === 1 ||
      remainingTimeRatio(run) <= 0.16);

  return scheduled || timeCheck;
}

function moderatorPlan(
  talk: TalkResponse,
  run: TalkRunResponse,
  intent: Extract<TalkRunIntent, "opening" | "moderation" | "question" | "closing">,
): TalkRunTurnPlan {
  const moderatorName = talk.moderator.name || "Moderator";
  const lastParticipant = participantMessages(run.messages).at(-1);
  const targetParticipantIndex =
    intent === "moderation" || intent === "question"
      ? lastParticipant?.participantIndex
      : undefined;
  const [minWords, maxWords] = wordRange(
    intent,
    talk.settings.pace,
    remainingTimeRatio(run),
    `${talk.id}:${run.messages.length}:moderator:${intent}`,
  );
  const isPrepared = intent === "opening" || intent === "closing";

  return {
    speakerType: "moderator",
    speakerName: moderatorName,
    speakerRole: talk.moderator.role,
    intent,
    targetParticipantIndex,
    targetSpeakerName:
      targetParticipantIndex === undefined
        ? undefined
        : talk.participants[targetParticipantIndex]?.name,
    threadLabel: discussionFocus(talk, run),
    arcPhase: run.discussionState.arcPhase,
    preparationMode: isPrepared ? "prepared" : "reactive",
    referenceStyle:
      targetParticipantIndex === undefined ? "implicit" : "idea_first",
    minWords,
    maxWords,
  };
}

function chooseParticipant(talk: TalkResponse, run: TalkRunResponse): number {
  const messages = participantMessages(run.messages);
  const lastMessage = run.messages.at(-1);
  const previousParticipant = messages.at(-1)?.participantIndex;
  const directedParticipant =
    lastMessage?.speakerType === "moderator"
      ? lastMessage.targetParticipantIndex
      : lastMessage?.targetParticipantIndex;
  if (
    lastMessage?.speakerType === "moderator" &&
    directedParticipant !== undefined &&
    directedParticipant >= 0 &&
    directedParticipant < talk.participants.length
  ) {
    return directedParticipant;
  }
  const honorDirectCall =
    lastMessage?.speakerType === "moderator" ||
    stableJitter(`${talk.id}:call:${run.messages.length}`) % 4 !== 0;
  const recent = messages.slice(-3).map((message) => message.participantIndex);
  const isPingPong =
    recent.length === 3 && recent[0] === recent[2] && recent[0] !== recent[1];

  const counts = Array.from({ length: 5 }, (_, index) =>
    messages.filter((message) => message.participantIndex === index).length,
  );
  const liveFloorRequests = run.discussionState.floorQueue.filter(
    (request) => request.expiresAfterSequence >= run.messages.length + 1,
  );

  return talk.participants
    .map((participant, index) => {
      let score =
        participant.assertiveness * 0.2 +
        participant.baselineTension * 0.08 -
        counts[index] * 28 +
        stableJitter(`${talk.id}:${run.messages.length}:${index}`);

      if (
        run.discussionState.arcPhase === "positions" &&
        !run.discussionState.corePositions.some(
          (position) => position.participantIndex === index,
        )
      ) {
        score += 75;
      }

      if (directedParticipant === index) {
        score += lastMessage?.speakerType === "moderator" ? 190 : honorDirectCall ? 82 : 12;
      }
      const floorRequest = liveFloorRequests
        .filter((request) => request.participantIndex === index)
        .sort((left, right) => right.priority - left.priority)[0];
      if (floorRequest) score += floorRequest.priority * 1.25;
      if (previousParticipant === index) score -= 220;
      if (recent.at(-2) === index) score -= 38;
      if (isPingPong && recent[1] === index) score -= 145;

      return { index, score };
    })
    .sort((left, right) => right.score - left.score)[0].index;
}

function participantIntent(
  talk: TalkResponse,
  run: TalkRunResponse,
  participantIndex: number,
  floorRequest?: TalkRunFloorRequest,
): TalkRunIntent {
  const previousParticipants = participantMessages(run.messages);
  const participant = talk.participants[participantIndex];
  const lastMessage = run.messages.at(-1);
  if (lastMessage?.speakerType === "moderator") return "answer";
  if (floorRequest) return floorRequest.intent;
  if (previousParticipants.length === 0) return "argument";

  if (run.discussionState.arcPhase === "positions") {
    if (previousParticipants.length < 2) return "argument";
    return participant.assertiveness + participant.baselineTension >= 105
      ? "challenge"
      : "reply";
  }
  if (run.discussionState.arcPhase === "examination") {
    if ((run.messages.length + participantIndex) % 3 === 0) return "question";
    return participant.patience >= 65 ? "clarification" : "challenge";
  }
  if (run.discussionState.arcPhase === "synthesis") {
    return participant.patience >= 55
      ? "partial_agreement"
      : "clarification";
  }

  const wasDirectlyCalled = lastMessage?.targetParticipantIndex === participantIndex;
  if (
    !wasDirectlyCalled &&
    stableJitter(`${talk.id}:prepared:${run.messages.length}:${participantIndex}`) % 3 === 0
  ) {
    return "argument";
  }

  if (
    talk.settings.allowInterruptions &&
    participant.interruptiveness >= 65 &&
    (run.messages.length + participantIndex) % 3 === 0
  ) {
    return "interruption";
  }
  if (participant.assertiveness + participant.baselineTension >= 125) {
    return "challenge";
  }
  if (participant.patience >= 72) {
    return (run.messages.length + participantIndex) % 2 === 0
      ? "clarification"
      : "partial_agreement";
  }
  if ((run.messages.length + participantIndex) % 5 === 0) return "question";
  return "reply";
}

function targetForParticipant(
  talk: TalkResponse,
  run: TalkRunResponse,
  participantIndex: number,
  preparationMode: "reactive" | "prepared",
  floorRequest?: TalkRunFloorRequest,
): { participantIndex?: number; speakerName?: string } {
  if (preparationMode === "prepared") return {};

  if (floorRequest?.targetParticipantIndex !== undefined) {
    const target = talk.participants[floorRequest.targetParticipantIndex];
    if (target) {
      return {
        participantIndex: floorRequest.targetParticipantIndex,
        speakerName: target.name,
      };
    }
  }

  const lastMessage = run.messages.at(-1);
  if (!lastMessage) return {};
  if (lastMessage.speakerType === "moderator") {
    return { speakerName: lastMessage.speakerName };
  }

  const candidates = participantMessages(run.messages)
    .slice(-5)
    .reverse()
    .filter((message) => message.participantIndex !== participantIndex);
  if (candidates.length === 0) return {};

  const chooseOlder =
    candidates.length > 1 &&
    stableJitter(`${talk.id}:target:${run.messages.length}:${participantIndex}`) % 3 === 0;
  const selected = chooseOlder ? candidates[1] : candidates[0];
  return {
    participantIndex: selected.participantIndex,
    speakerName: selected.speakerName,
  };
}

function referenceStyle(
  talk: TalkResponse,
  run: TalkRunResponse,
  participantIndex: number,
  hasTarget: boolean,
): TalkRunTurnPlan["referenceStyle"] {
  if (!hasTarget) return "implicit";
  const styles = [
    "direct_name",
    "idea_first",
    "implicit",
    "echo_phrase",
  ] as const;
  const previousStyle = run.messages.at(-1)?.referenceStyle;
  const offset = stableJitter(
    `${talk.id}:reference:${run.messages.length}:${participantIndex}`,
  );

  for (let step = 0; step < styles.length; step += 1) {
    const style = styles[(offset + step) % styles.length];
    if (style !== previousStyle) return style;
  }
  return "idea_first";
}

function participantClosingPlan(
  talk: TalkResponse,
  run: TalkRunResponse,
): TalkRunTurnPlan | undefined {
  const participantIndex = talk.participants.reduce((selected, participant, index) => {
    if (participant.kind !== "ai") return selected;
    if (selected < 0) return index;
    return participant.patience > talk.participants[selected].patience
      ? index
      : selected;
  }, -1);
  if (participantIndex < 0) return undefined;

  const participant = talk.participants[participantIndex];
  const [minWords, maxWords] = wordRange(
    "closing",
    talk.settings.pace,
    remainingTimeRatio(run),
    `${talk.id}:${run.messages.length}:${participantIndex}:closing`,
  );
  return {
    speakerType: "participant",
    participantIndex,
    speakerName: participant.name,
    speakerRole: participant.role,
    intent: "closing",
    threadLabel: discussionFocus(talk, run),
    arcPhase: "conclusion",
    preparationMode: "prepared",
    referenceStyle: "implicit",
    minWords,
    maxWords,
  };
}

function audiencePlan(
  talk: TalkResponse,
  run: TalkRunResponse,
): TalkRunTurnPlan | undefined {
  const cue = run.audienceCue;
  if (!cue) return undefined;

  const requestedParticipant = cue.targetParticipantIndex;
  const participantIndex =
    requestedParticipant !== undefined &&
    requestedParticipant >= 0 &&
    requestedParticipant < talk.participants.length &&
    talk.participants[requestedParticipant]?.kind !== "unassigned"
      ? requestedParticipant
      : chooseParticipant(talk, run);
  const participant = talk.participants[participantIndex];
  const threadLabel = editorialLabel(cue.content);

  if (cue.mode === "host" && talk.moderator.kind !== "none") {
    const [minWords, maxWords] = wordRange(
      "moderation",
      talk.settings.pace,
      remainingTimeRatio(run),
      `${talk.id}:${run.messages.length}:audience:${cue.messageId}:host`,
    );
    return {
      speakerType: "moderator",
      speakerName: talk.moderator.name || "Moderator",
      speakerRole: talk.moderator.role,
      intent: "moderation",
      targetParticipantIndex: participantIndex,
      targetSpeakerName: participant.name,
      threadLabel,
      arcPhase: run.discussionState.arcPhase,
      preparationMode: "reactive",
      referenceStyle: "idea_first",
      minWords,
      maxWords: Math.min(maxWords, 60),
      audienceCue: cue,
    };
  }

  const [minWords, maxWords] = wordRange(
    "answer",
    talk.settings.pace,
    remainingTimeRatio(run),
    `${talk.id}:${run.messages.length}:audience:${cue.messageId}:${participantIndex}`,
  );
  return {
    speakerType: "participant",
    participantIndex,
    speakerName: participant.name,
    speakerRole: participant.role,
    intent: "answer",
    threadLabel,
    arcPhase: run.discussionState.arcPhase,
    preparationMode: "reactive",
    referenceStyle: "implicit",
    minWords,
    maxWords,
    audienceCue: cue,
  };
}

export function chooseNextTurn(
  talk: TalkResponse,
  run: TalkRunResponse,
): TalkRunTurnPlan | undefined {
  if (run.phase === "completed") return undefined;
  if (run.phase === "opening") return moderatorPlan(talk, run, "opening");
  if (run.phase === "closing") {
    return talk.moderator.kind === "ai"
      ? moderatorPlan(talk, run, "closing")
      : participantClosingPlan(talk, run);
  }
  if (run.discussionState.arcPhase === "conclusion") {
    return talk.moderator.kind === "ai" && talk.moderator.summarizeAtEnd
      ? moderatorPlan(talk, run, "closing")
      : undefined;
  }

  const audienceTurn = audiencePlan(talk, run);
  if (audienceTurn) return audienceTurn;

  if (shouldHostIntervene(talk, run)) {
    return moderatorPlan(
      talk,
      run,
      talk.moderator.style === "neutral" ? "question" : "moderation",
    );
  }

  const participantIndex = chooseParticipant(talk, run);
  const participant = talk.participants[participantIndex];
  const floorRequest = run.discussionState.floorQueue
    .filter(
      (request) =>
        request.participantIndex === participantIndex &&
        request.expiresAfterSequence >= run.messages.length + 1,
    )
    .sort((left, right) => right.priority - left.priority)[0];
  const intent = participantIntent(talk, run, participantIndex, floorRequest);
  const preparationMode = intent === "argument" ? "prepared" : "reactive";
  const target = targetForParticipant(
    talk,
    run,
    participantIndex,
    preparationMode,
    floorRequest,
  );
  const [minWords, maxWords] = wordRange(
    intent,
    talk.settings.pace,
    remainingTimeRatio(run),
    `${talk.id}:${run.messages.length}:${participantIndex}:${intent}`,
  );

  return {
    speakerType: "participant",
    participantIndex,
    speakerName: participant.name,
    speakerRole: participant.role,
    intent,
    targetParticipantIndex: target.participantIndex,
    targetSpeakerName: target.speakerName,
    threadLabel: floorRequest?.threadLabel
      ? editorialLabel(floorRequest.threadLabel)
      : discussionFocus(talk, run),
    arcPhase: run.discussionState.arcPhase,
    preparationMode,
    referenceStyle: referenceStyle(
      talk,
      run,
      participantIndex,
      Boolean(target.speakerName),
    ),
    minWords,
    maxWords,
  };
}

function appendUnique(items: string[], value: string | undefined, limit: number) {
  if (!value) return items.slice(-limit);
  const normalized = value.trim();
  if (!normalized) return items.slice(-limit);
  return [...items.filter((item) => item !== normalized), normalized].slice(-limit);
}

function statementExcerpt(content: string): string {
  const firstSentence = content.match(/^.*?[.!?](?:\s|$)/u)?.[0] ?? content;
  return boundedText(firstSentence, 220);
}

function questionExcerpt(content: string): string | undefined {
  const question = content.match(/(?:^|[.!]\s+)([^?]{8,}\?)/u)?.[1];
  return question ? boundedText(question, 220) : undefined;
}

export function createInitialDiscussionState(
  talk: TalkResponse,
): TalkRunDiscussionState {
  const italian = talk.language.toLocaleLowerCase().startsWith("ital");
  return {
    arcPhase: "positions",
    centralQuestion: talk.topic,
    phaseObjective: italian
      ? "Rendere esplicite le posizioni iniziali realmente diverse."
      : ARC_OBJECTIVES.positions,
    currentFocus: boundedText(talk.topic),
    corePositions: [],
    keyConflict: "",
    contestedClaims: [],
    evidenceAndTradeoffs: [],
    openQuestions: [],
    agreements: [],
    unresolvedConflicts: [],
    turningPoints: [],
    floorQueue: [],
    conclusionReadiness: "not_ready",
    conclusionReason: italian
      ? "Le posizioni iniziali non sono ancora state definite."
      : "The starting positions have not been established yet.",
    conclusion: undefined,
    editorialReviewCount: 0,
    editorialInputTokens: 0,
    editorialOutputTokens: 0,
    participantMemories: talk.participants.map((_, participantIndex) => ({
      participantIndex,
      statements: [],
    })),
  };
}

export function updateDiscussionState(
  current: TalkRunDiscussionState,
  plan: TalkRunTurnPlan,
  content: string,
  sequence = 0,
): TalkRunDiscussionState {
  const excerpt = statementExcerpt(content);
  const question = questionExcerpt(content);
  const conflict =
    plan.targetSpeakerName &&
    (plan.intent === "challenge" || plan.intent === "interruption")
      ? `${plan.speakerName} ↔ ${plan.targetSpeakerName}: ${plan.threadLabel}`
      : undefined;
  const existingPosition = current.corePositions.find(
    (position) => position.participantIndex === plan.participantIndex,
  );
  const corePositions =
    plan.participantIndex === undefined
      ? current.corePositions
      : [
          ...current.corePositions.filter(
            (position) => position.participantIndex !== plan.participantIndex,
          ),
          {
            participantIndex: plan.participantIndex,
            summary:
              current.arcPhase === "positions" || !existingPosition
                ? excerpt
                : existingPosition.summary,
          },
        ].slice(-5);
  const turningPoint =
    plan.participantIndex !== undefined &&
    existingPosition &&
    (plan.intent === "partial_agreement" || plan.intent === "clarification")
      ? { participantIndex: plan.participantIndex, summary: excerpt }
      : undefined;
  const liveQueue = (current.floorQueue ?? []).filter(
    (request) =>
      request.expiresAfterSequence >= sequence &&
      request.participantIndex !== plan.participantIndex,
  );
  const requestedReply: TalkRunFloorRequest | undefined =
    plan.targetParticipantIndex !== undefined &&
    plan.targetParticipantIndex !== plan.participantIndex
      ? {
          participantIndex: plan.targetParticipantIndex,
          targetParticipantIndex: plan.participantIndex,
          intent: plan.intent === "question" || plan.intent === "moderation"
            ? "answer"
            : plan.intent === "challenge" || plan.intent === "interruption"
              ? "reply"
              : "clarification",
          reason: excerpt,
          threadLabel: plan.threadLabel,
          priority:
            plan.intent === "question" || plan.intent === "moderation" ? 100 : 88,
          expiresAfterSequence: sequence + 2,
        }
      : undefined;

  return {
    ...current,
    currentFocus: plan.threadLabel || current.currentFocus,
    corePositions,
    contestedClaims:
      plan.intent === "challenge" || plan.intent === "interruption"
        ? appendUnique(current.contestedClaims, excerpt, 6)
        : current.contestedClaims.slice(-6),
    evidenceAndTradeoffs:
      current.arcPhase === "examination"
        ? appendUnique(current.evidenceAndTradeoffs, excerpt, 8)
        : current.evidenceAndTradeoffs.slice(-8),
    openQuestions: appendUnique(
      current.openQuestions,
      plan.intent === "question" || plan.intent === "moderation"
        ? question ?? excerpt
        : question,
      6,
    ),
    agreements:
      plan.intent === "partial_agreement"
        ? appendUnique(current.agreements, excerpt, 5)
        : current.agreements.slice(-5),
    unresolvedConflicts: appendUnique(current.unresolvedConflicts, conflict, 6),
    turningPoints: turningPoint
      ? [
          ...current.turningPoints.filter(
            (point) =>
              point.participantIndex !== turningPoint.participantIndex ||
              point.summary !== turningPoint.summary,
          ),
          turningPoint,
        ].slice(-6)
      : current.turningPoints.slice(-6),
    floorQueue: requestedReply
      ? [
          ...liveQueue.filter(
            (request) => request.participantIndex !== requestedReply.participantIndex,
          ),
          requestedReply,
        ].slice(-5)
      : liveQueue.slice(-5),
    participantMemories: current.participantMemories.map((memory) =>
      memory.participantIndex === plan.participantIndex
        ? {
            ...memory,
            statements: appendUnique(memory.statements, excerpt, 6),
          }
        : { ...memory, statements: memory.statements.slice(-6) },
    ),
  };
}
