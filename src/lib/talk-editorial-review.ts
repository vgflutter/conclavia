import "server-only";

import { generateLlmJson, type GenerationResult } from "@/lib/llm-provider";
import { getLlmModel, type LlmModelId } from "@/lib/llm-models";
import { minimumMeaningfulTurns } from "@/lib/talk-director";
import type { TalkResponse } from "@/types/talk";
import type {
  TalkRunArcPhase,
  TalkRunConclusion,
  TalkRunConclusionKind,
  TalkRunConclusionReadiness,
  TalkRunDiscussionState,
  TalkRunFloorRequest,
  TalkRunResponse,
} from "@/types/talk-run";

interface EditorialReviewPayload {
  arcPhase: TalkRunArcPhase;
  phaseObjective: string;
  currentFocus: string;
  corePositions: Array<{ participantIndex: number; summary: string }>;
  keyConflict: string;
  contestedClaims: string[];
  evidenceAndTradeoffs: string[];
  openQuestions: string[];
  agreements: string[];
  unresolvedConflicts: string[];
  turningPoints: Array<{ participantIndex: number; summary: string }>;
  floorQueue: TalkRunFloorRequest[];
  conclusionReadiness: TalkRunConclusionReadiness;
  conclusionReason: string;
  conclusion: TalkRunConclusion;
}

export interface EditorialReviewResult {
  state: TalkRunDiscussionState;
  generation: GenerationResult;
}

const stringArraySchema = {
  type: "array",
  items: { type: "string" },
  maxItems: 8,
} as const;

const editorialReviewSchema: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    arcPhase: {
      type: "string",
      enum: ["positions", "conflict", "examination", "synthesis", "conclusion"],
    },
    phaseObjective: { type: "string" },
    currentFocus: { type: "string" },
    corePositions: {
      type: "array",
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          participantIndex: { type: "integer", minimum: 0, maximum: 4 },
          summary: { type: "string" },
        },
        required: ["participantIndex", "summary"],
      },
    },
    keyConflict: { type: "string" },
    contestedClaims: stringArraySchema,
    evidenceAndTradeoffs: stringArraySchema,
    openQuestions: stringArraySchema,
    agreements: stringArraySchema,
    unresolvedConflicts: stringArraySchema,
    turningPoints: {
      type: "array",
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          participantIndex: { type: "integer", minimum: 0, maximum: 4 },
          summary: { type: "string" },
        },
        required: ["participantIndex", "summary"],
      },
    },
    floorQueue: {
      type: "array",
      maxItems: 4,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          participantIndex: { type: "integer", minimum: 0, maximum: 4 },
          targetParticipantIndex: {
            anyOf: [
              { type: "integer", minimum: 0, maximum: 4 },
              { type: "null" },
            ],
          },
          intent: {
            type: "string",
            enum: [
              "argument",
              "reply",
              "challenge",
              "question",
              "answer",
              "clarification",
              "partial_agreement",
              "interruption",
            ],
          },
          reason: { type: "string" },
          threadLabel: { type: "string" },
          priority: { type: "integer", minimum: 0, maximum: 100 },
          expiresAfterSequence: { type: "integer", minimum: 1 },
        },
        required: [
          "participantIndex",
          "targetParticipantIndex",
          "intent",
          "reason",
          "threadLabel",
          "priority",
          "expiresAfterSequence",
        ],
      },
    },
    conclusionReadiness: {
      type: "string",
      enum: ["not_ready", "developing", "ready", "forced"],
    },
    conclusionReason: { type: "string" },
    conclusion: {
      type: "object",
      additionalProperties: false,
      properties: {
        kind: {
          type: "string",
          enum: ["agreement", "conditional_agreement", "clarified_disagreement", "open"],
        },
        answer: { type: "string" },
        agreements: stringArraySchema,
        disagreements: stringArraySchema,
        conditions: stringArraySchema,
        openQuestions: stringArraySchema,
      },
      required: [
        "kind",
        "answer",
        "agreements",
        "disagreements",
        "conditions",
        "openQuestions",
      ],
    },
  },
  required: [
    "arcPhase",
    "phaseObjective",
    "currentFocus",
    "corePositions",
    "keyConflict",
    "contestedClaims",
    "evidenceAndTradeoffs",
    "openQuestions",
    "agreements",
    "unresolvedConflicts",
    "turningPoints",
    "floorQueue",
    "conclusionReadiness",
    "conclusionReason",
    "conclusion",
  ],
};

function compact(value: string, maximum = 320): string {
  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized.length <= maximum
    ? normalized
    : `${normalized.slice(0, maximum - 1).trimEnd()}…`;
}

function editorialLabel(value: string): string {
  const normalized = compact(value, 72);
  const words = normalized.split(/\s+/u);
  if (words.length <= 9) return normalized;
  return `${words.slice(0, 9).join(" ").replace(/[,:;.!?…]+$/u, "")}…`;
}

function strings(values: string[], maximum = 8): string[] {
  return [...new Set(values.map((value) => compact(value)).filter(Boolean))].slice(
    -maximum,
  );
}

function normalizeConclusion(
  conclusion: TalkRunConclusion,
): TalkRunConclusion {
  const kinds: TalkRunConclusionKind[] = [
    "agreement",
    "conditional_agreement",
    "clarified_disagreement",
    "open",
  ];
  return {
    kind: kinds.includes(conclusion.kind) ? conclusion.kind : "open",
    answer: compact(conclusion.answer, 600),
    agreements: strings(conclusion.agreements, 6),
    disagreements: strings(conclusion.disagreements, 6),
    conditions: strings(conclusion.conditions, 6),
    openQuestions: strings(conclusion.openQuestions, 6),
  };
}

function phaseObjective(talk: TalkResponse, phase: TalkRunArcPhase): string {
  const italian = talk.language.toLocaleLowerCase().startsWith("ital");
  const objectives: Record<TalkRunArcPhase, [string, string]> = {
    positions: [
      "Make the genuinely different starting positions explicit.",
      "Rendere esplicite le posizioni iniziali realmente diverse.",
    ],
    conflict: [
      "Isolate the decisive incompatibility and stop opening side topics.",
      "Isolare l’incompatibilità decisiva senza aprire altri temi laterali.",
    ],
    examination: [
      "Test the central claims against consequences, exceptions, costs, and feasibility.",
      "Mettere le tesi centrali alla prova su conseguenze, eccezioni, costi e fattibilità.",
    ],
    synthesis: [
      "Clarify concessions, decisive conditions, and the strongest remaining disagreement.",
      "Chiarire concessioni, condizioni decisive e il disaccordo più forte rimasto.",
    ],
    conclusion: [
      "State what was established and why any remaining disagreement survives.",
      "Stabilire cosa è emerso e perché l’eventuale disaccordo rimane.",
    ],
  };
  return objectives[phase][italian ? 1 : 0];
}

function normalizeReview(
  talk: TalkResponse,
  run: TalkRunResponse,
  payload: EditorialReviewPayload,
  generation: GenerationResult,
): TalkRunDiscussionState {
  const turnLimitReached = run.participantTurnCount >= run.maxTurns;
  const timeLimitReached =
    run.estimatedAirtimeSeconds >= run.targetDurationMinutes * 60;
  const hardLimitReached = turnLimitReached || timeLimitReached;
  const minimumReached =
    run.participantTurnCount >= minimumMeaningfulTurns(run.maxTurns);
  const synthesisHasBeenOnAir =
    run.discussionState.arcPhase === "synthesis" &&
    run.messages.some(
      (message) =>
        message.speakerType === "participant" &&
        message.arcPhase === "synthesis",
    );
  let arcPhase = payload.arcPhase;
  const proposedArcPhase = payload.arcPhase;
  let conclusionReadiness = payload.conclusionReadiness;
  const phaseOrder: TalkRunArcPhase[] = [
    "positions",
    "conflict",
    "examination",
    "synthesis",
    "conclusion",
  ];
  const currentPhaseIndex = phaseOrder.indexOf(run.discussionState.arcPhase);
  const proposedPhaseIndex = phaseOrder.indexOf(arcPhase);
  arcPhase = phaseOrder[Math.max(currentPhaseIndex, proposedPhaseIndex)];

  if (
    arcPhase === "positions" &&
    payload.corePositions.length >= 3 &&
    payload.keyConflict.trim()
  ) {
    arcPhase = "conflict";
  }
  if (
    arcPhase === "conflict" &&
    run.discussionState.arcPhase === "conflict" &&
    payload.keyConflict.trim() &&
    payload.evidenceAndTradeoffs.length >= 2
  ) {
    arcPhase = "examination";
  }
  if (
    arcPhase === "examination" &&
    run.discussionState.arcPhase === "examination" &&
    payload.evidenceAndTradeoffs.length >= 3 &&
    (payload.turningPoints.length > 0 || payload.agreements.length >= 2) &&
    minimumReached
  ) {
    arcPhase = "synthesis";
  }

  if (hardLimitReached) {
    arcPhase = "conclusion";
    conclusionReadiness = "forced";
  } else if (
    conclusionReadiness === "ready" &&
    (!minimumReached || !synthesisHasBeenOnAir)
  ) {
    arcPhase = arcPhase === "conclusion" ? "synthesis" : arcPhase;
    conclusionReadiness = "developing";
  } else if (conclusionReadiness === "ready") {
    arcPhase = "conclusion";
  } else if (arcPhase === "conclusion") {
    arcPhase = "synthesis";
  }

  const corePositions = payload.corePositions
    .filter(
      (position) =>
        Number.isInteger(position.participantIndex) &&
        position.participantIndex >= 0 &&
        position.participantIndex < talk.participants.length,
    )
    .map((position) => ({
      participantIndex: position.participantIndex,
      summary: compact(position.summary),
    }))
    .filter((position) => position.summary)
    .slice(0, 5);
  const turningPoints = payload.turningPoints
    .filter(
      (point) =>
        Number.isInteger(point.participantIndex) &&
        point.participantIndex >= 0 &&
        point.participantIndex < talk.participants.length,
    )
    .map((point) => ({
      participantIndex: point.participantIndex,
      summary: compact(point.summary),
    }))
    .filter((point) => point.summary)
    .slice(-6);
  const floorQueue = payload.floorQueue
    .filter(
      (request) =>
        Number.isInteger(request.participantIndex) &&
        request.participantIndex >= 0 &&
        request.participantIndex < talk.participants.length &&
        talk.participants[request.participantIndex]?.kind !== "unassigned" &&
        request.expiresAfterSequence >= run.messages.length + 1,
    )
    .map((request) => ({
      ...request,
      targetParticipantIndex:
        request.targetParticipantIndex === null ||
        request.targetParticipantIndex === undefined
          ? undefined
          : request.targetParticipantIndex,
      reason: compact(request.reason, 220),
      threadLabel: editorialLabel(request.threadLabel),
      priority: Math.max(0, Math.min(100, Math.round(request.priority))),
    }))
    .slice(0, 4);
  const conclusion = normalizeConclusion(payload.conclusion);

  return {
    ...run.discussionState,
    arcPhase,
    centralQuestion: talk.topic,
    phaseObjective: compact(
      arcPhase === proposedArcPhase
        ? payload.phaseObjective
        : phaseObjective(talk, arcPhase),
    ),
    currentFocus: editorialLabel(payload.currentFocus),
    corePositions,
    keyConflict: compact(payload.keyConflict),
    contestedClaims: strings(payload.contestedClaims),
    evidenceAndTradeoffs: strings(payload.evidenceAndTradeoffs),
    openQuestions: strings(payload.openQuestions),
    agreements: strings(payload.agreements),
    unresolvedConflicts: strings(payload.unresolvedConflicts),
    turningPoints,
    floorQueue,
    conclusionReadiness,
    conclusionReason: compact(payload.conclusionReason, 500),
    conclusion: arcPhase === "conclusion" ? conclusion : undefined,
    editorialReviewCount: run.discussionState.editorialReviewCount + 1,
    editorialInputTokens:
      run.discussionState.editorialInputTokens + (generation.inputTokens ?? 0),
    editorialOutputTokens:
      run.discussionState.editorialOutputTokens + (generation.outputTokens ?? 0),
  };
}

function transcript(run: TalkRunResponse): string {
  return run.messages
    .slice(-15)
    .map(
      (message) =>
        `[${message.sequence}] ${message.speakerName} (${message.intent}): ${message.content}`,
    )
    .join("\n\n");
}

export async function reviewEditorialArc(
  talk: TalkResponse,
  run: TalkRunResponse,
): Promise<EditorialReviewResult> {
  const minimumTurns = minimumMeaningfulTurns(run.maxTurns);
  const turnLimitReached = run.participantTurnCount >= run.maxTurns;
  const timeLimitReached =
    run.estimatedAirtimeSeconds >= run.targetDurationMinutes * 60;
  const hardLimitReached = turnLimitReached || timeLimitReached;
  const defaultProvider = getLlmModel(talk.settings.defaultModel).provider;
  const editorialModel: LlmModelId =
    defaultProvider === "openai" ? "gpt-5.6-terra" : "gemini-3.5-flash-lite";
  const roster = talk.participants
    .map((participant, index) => `${index}: ${participant.name} — ${participant.role}`)
    .join("\n");
  const { data, generation } = await generateLlmJson<EditorialReviewPayload>({
    model: editorialModel,
    schemaName: "conclavia_editorial_review",
    schema: editorialReviewSchema,
    maxOutputTokens: 2_200,
    instructions: [
      "You are Conclavia's off-air editorial desk. Evaluate the public discussion, not the private participant prompts.",
      `Write every summary in ${talk.language}.`,
      "Use only claims actually present in the transcript. Never invent evidence, agreement, change of mind, or closure.",
      "The arc is: positions → conflict → examination → synthesis → conclusion.",
      "Positions means distinct theses are explicit. Conflict means the decisive incompatibility is isolated. Examination means premises have faced consequences, exceptions, counterexamples, or feasibility tests. Synthesis means guests have stated concessions, conditions, or durable disagreements. Conclusion means the central question now has a defensible answer or a precisely clarified unresolved conflict.",
      "Move the phase only when the transcript supports it. Do not confuse several opinions with an evolved discussion.",
      "A conclusion does not require consensus. It must say what was established, what remains disputed, and which conditions or unanswered questions matter.",
      "Build a short floor queue containing only guests who now have a substantively relevant reason to speak. Prefer direct answers, challenged guests, missing expertise, and positions that can test the current focus. Priority is 0–100; expire each request within the next three message sequences.",
      "Write currentFocus and every floorQueue.threadLabel as concise on-screen editorial labels of 3–9 words, never as full sentences or transcript excerpts.",
      `Do not mark ready before ${minimumTurns} participant interventions. The hard limit is ${run.maxTurns}.`,
      hardLimitReached
        ? `The ${timeLimitReached ? "planned airtime" : "turn ceiling"} has been reached: produce the strongest honest conclusion available and mark readiness forced.`
        : "If material objections or consequences remain untested, keep the discussion open and name the exact next editorial objective.",
    ].join("\n"),
    input: [
      `Central question: ${talk.topic}`,
      talk.description ? `Background: ${talk.description}` : undefined,
      `Participant interventions: ${run.participantTurnCount}/${run.maxTurns}`,
      `Estimated airtime: ${run.estimatedAirtimeSeconds}/${run.targetDurationMinutes * 60} seconds`,
      `Next message sequence: ${run.messages.length + 1}`,
      "Roster (zero-based participant index):",
      roster,
      "Current persisted editorial state:",
      JSON.stringify({
        arcPhase: run.discussionState.arcPhase,
        phaseObjective: run.discussionState.phaseObjective,
        currentFocus: run.discussionState.currentFocus,
        corePositions: run.discussionState.corePositions,
        keyConflict: run.discussionState.keyConflict,
        evidenceAndTradeoffs: run.discussionState.evidenceAndTradeoffs,
        openQuestions: run.discussionState.openQuestions,
        agreements: run.discussionState.agreements,
        unresolvedConflicts: run.discussionState.unresolvedConflicts,
        turningPoints: run.discussionState.turningPoints,
        floorQueue: run.discussionState.floorQueue,
      }),
      "Recent public transcript:",
      transcript(run),
    ]
      .filter(Boolean)
      .join("\n\n"),
  });

  return {
    state: normalizeReview(talk, run, data, generation),
    generation,
  };
}
