import type { LlmModelId, LlmProvider } from "@/lib/llm-models";
import type { TalkResponse } from "@/types/talk";

export type TalkRunStatus =
  | "idle"
  | "generating"
  | "waiting_for_human"
  | "completed"
  | "failed";
export type TalkRunPhase = "opening" | "discussion" | "closing" | "completed";
export type TalkRunArcPhase =
  | "positions"
  | "conflict"
  | "examination"
  | "synthesis"
  | "conclusion";
export type TalkRunConclusionReadiness =
  | "not_ready"
  | "developing"
  | "ready"
  | "forced";
export type TalkRunConclusionKind =
  | "agreement"
  | "conditional_agreement"
  | "clarified_disagreement"
  | "open";
export type TalkRunSpeakerType = "participant" | "moderator";
export type TalkRunMessageOrigin = "ai" | "human";
export type TalkRunPreparationMode = "reactive" | "prepared";
export type TalkRunReferenceStyle =
  | "direct_name"
  | "idea_first"
  | "implicit"
  | "echo_phrase";
export type TalkRunIntent =
  | "opening"
  | "argument"
  | "reply"
  | "challenge"
  | "question"
  | "answer"
  | "clarification"
  | "partial_agreement"
  | "interruption"
  | "moderation"
  | "closing";

export interface TalkRunTurnPlan {
  speakerType: TalkRunSpeakerType;
  participantIndex?: number;
  speakerName: string;
  speakerRole?: string;
  intent: TalkRunIntent;
  targetParticipantIndex?: number;
  targetSpeakerName?: string;
  threadLabel: string;
  arcPhase: TalkRunArcPhase;
  preparationMode: TalkRunPreparationMode;
  referenceStyle: TalkRunReferenceStyle;
  minWords: number;
  maxWords: number;
}

export interface TalkRunParticipantMemory {
  participantIndex: number;
  statements: string[];
}

export interface TalkRunCorePosition {
  participantIndex: number;
  summary: string;
}

export interface TalkRunTurningPoint {
  participantIndex: number;
  summary: string;
}

export interface TalkRunFloorRequest {
  participantIndex: number;
  targetParticipantIndex?: number;
  intent: Extract<
    TalkRunIntent,
    | "argument"
    | "reply"
    | "challenge"
    | "question"
    | "answer"
    | "clarification"
    | "partial_agreement"
    | "interruption"
  >;
  reason: string;
  threadLabel: string;
  priority: number;
  expiresAfterSequence: number;
}

export interface TalkRunConclusion {
  kind: TalkRunConclusionKind;
  answer: string;
  agreements: string[];
  disagreements: string[];
  conditions: string[];
  openQuestions: string[];
}

export interface TalkRunDiscussionState {
  arcPhase: TalkRunArcPhase;
  centralQuestion: string;
  phaseObjective: string;
  currentFocus: string;
  corePositions: TalkRunCorePosition[];
  keyConflict: string;
  contestedClaims: string[];
  evidenceAndTradeoffs: string[];
  openQuestions: string[];
  agreements: string[];
  unresolvedConflicts: string[];
  turningPoints: TalkRunTurningPoint[];
  floorQueue: TalkRunFloorRequest[];
  conclusionReadiness: TalkRunConclusionReadiness;
  conclusionReason: string;
  conclusion?: TalkRunConclusion;
  editorialReviewCount: number;
  editorialInputTokens: number;
  editorialOutputTokens: number;
  participantMemories: TalkRunParticipantMemory[];
}

export interface TalkRunMessageResponse {
  sequence: number;
  speakerType: TalkRunSpeakerType;
  participantIndex?: number;
  speakerName: string;
  speakerRole?: string;
  intent: TalkRunIntent;
  targetParticipantIndex?: number;
  targetSpeakerName?: string;
  threadLabel: string;
  arcPhase: TalkRunArcPhase;
  preparationMode: TalkRunPreparationMode;
  referenceStyle: TalkRunReferenceStyle;
  wordCount: number;
  estimatedAirtimeSeconds: number;
  origin: TalkRunMessageOrigin;
  provider?: LlmProvider;
  model?: LlmModelId;
  content: string;
  inputTokens?: number;
  outputTokens?: number;
  createdAt: string;
}

export interface TalkRunResponse {
  id: string;
  talkId: string;
  status: TalkRunStatus;
  phase: TalkRunPhase;
  participantTurnCount: number;
  maxTurns: number;
  targetDurationMinutes: number;
  estimatedAirtimeSeconds: number;
  nextParticipantIndex: number;
  activeTurn?: TalkRunTurnPlan;
  hasPreparedTurn: boolean;
  discussionState: TalkRunDiscussionState;
  talkSnapshot?: TalkResponse;
  messages: TalkRunMessageResponse[];
  error?: string;
  startedAt: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}
