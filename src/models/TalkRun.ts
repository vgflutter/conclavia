import {
  type HydratedDocument,
  type Model,
  Schema,
  Types,
  model,
  models,
} from "mongoose";

import { LLM_MODEL_IDS, type LlmModelId, type LlmProvider } from "@/lib/llm-models";
import type { TalkResponse } from "@/types/talk";
import type {
  TalkRunDiscussionState,
  TalkRunIntent,
  TalkRunPhase,
  TalkRunPreparationMode,
  TalkRunReferenceStyle,
  TalkRunSpeakerType,
  TalkRunStatus,
  TalkRunTurnPlan,
} from "@/types/talk-run";

export interface TalkRunMessageRecord {
  sequence: number;
  speakerType: TalkRunSpeakerType;
  participantIndex?: number;
  speakerName: string;
  speakerRole?: string;
  intent: TalkRunIntent;
  targetParticipantIndex?: number;
  targetSpeakerName?: string;
  threadLabel: string;
  arcPhase: TalkRunTurnPlan["arcPhase"];
  preparationMode: TalkRunPreparationMode;
  referenceStyle: TalkRunReferenceStyle;
  wordCount: number;
  estimatedAirtimeSeconds: number;
  origin: "ai" | "human";
  provider?: LlmProvider;
  model?: LlmModelId;
  content: string;
  inputTokens?: number;
  outputTokens?: number;
  createdAt: Date;
}

export interface TalkRunRecord {
  talkId: Types.ObjectId;
  status: TalkRunStatus;
  phase: TalkRunPhase;
  participantTurnCount: number;
  maxTurns: number;
  targetDurationMinutes: number;
  estimatedAirtimeSeconds: number;
  nextParticipantIndex: number;
  activeTurn?: TalkRunTurnPlan;
  preparedTurn?: TalkRunPreparedTurnRecord;
  discussionState: TalkRunDiscussionState;
  talkSnapshot?: TalkResponse;
  messages: TalkRunMessageRecord[];
  error?: string;
  generationStartedAt?: Date;
  startedAt: Date;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface TalkRunPreparedTurnRecord {
  basedOnSequence: number;
  plan: TalkRunTurnPlan;
  provider: LlmProvider;
  model: LlmModelId;
  content: string;
  inputTokens?: number;
  outputTokens?: number;
  createdAt: Date;
}

const messageSchema = new Schema<TalkRunMessageRecord>(
  {
    sequence: { type: Number, required: true, min: 1, validate: Number.isInteger },
    speakerType: {
      type: String,
      enum: ["participant", "moderator"],
      required: true,
    },
    participantIndex: { type: Number, min: 0, max: 4, validate: Number.isInteger },
    speakerName: { type: String, required: true, trim: true },
    speakerRole: { type: String, trim: true },
    intent: {
      type: String,
      enum: [
        "opening",
        "argument",
        "reply",
        "challenge",
        "question",
        "answer",
        "clarification",
        "partial_agreement",
        "interruption",
        "moderation",
        "closing",
      ],
      required: true,
      default: "argument",
    },
    targetParticipantIndex: {
      type: Number,
      min: 0,
      max: 4,
      validate: Number.isInteger,
    },
    targetSpeakerName: { type: String, trim: true },
    threadLabel: { type: String, required: true, default: "", trim: true },
    arcPhase: {
      type: String,
      enum: ["positions", "conflict", "examination", "synthesis", "conclusion"],
      required: true,
      default: "positions",
    },
    preparationMode: {
      type: String,
      enum: ["reactive", "prepared"],
      required: true,
      default: "reactive",
    },
    referenceStyle: {
      type: String,
      enum: ["direct_name", "idea_first", "implicit", "echo_phrase"],
      required: true,
      default: "idea_first",
    },
    wordCount: { type: Number, required: true, default: 0, min: 0 },
    estimatedAirtimeSeconds: { type: Number, required: true, default: 0, min: 0 },
    origin: {
      type: String,
      enum: ["ai", "human"],
      required: true,
      default: "ai",
    },
    provider: { type: String, enum: ["openai", "gemini"] },
    model: { type: String, enum: LLM_MODEL_IDS },
    content: { type: String, required: true, trim: true },
    inputTokens: { type: Number, min: 0, validate: Number.isInteger },
    outputTokens: { type: Number, min: 0, validate: Number.isInteger },
    createdAt: { type: Date, required: true, default: Date.now },
  },
  { _id: false },
);

const activeTurnSchema = new Schema<TalkRunTurnPlan>(
  {
    speakerType: {
      type: String,
      enum: ["participant", "moderator"],
      required: true,
    },
    participantIndex: { type: Number, min: 0, max: 4, validate: Number.isInteger },
    speakerName: { type: String, required: true, trim: true },
    speakerRole: { type: String, trim: true },
    intent: {
      type: String,
      enum: [
        "opening",
        "argument",
        "reply",
        "challenge",
        "question",
        "answer",
        "clarification",
        "partial_agreement",
        "interruption",
        "moderation",
        "closing",
      ],
      required: true,
    },
    targetParticipantIndex: { type: Number, min: 0, max: 4, validate: Number.isInteger },
    targetSpeakerName: { type: String, trim: true },
    threadLabel: { type: String, required: true, trim: true },
    arcPhase: {
      type: String,
      enum: ["positions", "conflict", "examination", "synthesis", "conclusion"],
      required: true,
      default: "positions",
    },
    preparationMode: {
      type: String,
      enum: ["reactive", "prepared"],
      required: true,
      default: "reactive",
    },
    referenceStyle: {
      type: String,
      enum: ["direct_name", "idea_first", "implicit", "echo_phrase"],
      required: true,
      default: "idea_first",
    },
    minWords: { type: Number, required: true, min: 1, validate: Number.isInteger },
    maxWords: { type: Number, required: true, min: 1, validate: Number.isInteger },
  },
  { _id: false },
);

const participantMemorySchema = new Schema(
  {
    participantIndex: { type: Number, required: true, min: 0, max: 4 },
    statements: { type: [String], required: true, default: [] },
  },
  { _id: false },
);

const corePositionSchema = new Schema(
  {
    participantIndex: { type: Number, required: true, min: 0, max: 4 },
    summary: { type: String, required: true, trim: true },
  },
  { _id: false },
);

const turningPointSchema = new Schema(
  {
    participantIndex: { type: Number, required: true, min: 0, max: 4 },
    summary: { type: String, required: true, trim: true },
  },
  { _id: false },
);

const floorRequestSchema = new Schema(
  {
    participantIndex: { type: Number, required: true, min: 0, max: 4 },
    targetParticipantIndex: { type: Number, min: 0, max: 4 },
    intent: {
      type: String,
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
      required: true,
    },
    reason: { type: String, required: true, trim: true },
    threadLabel: { type: String, required: true, trim: true },
    priority: { type: Number, required: true, min: 0, max: 100 },
    expiresAfterSequence: { type: Number, required: true, min: 1 },
  },
  { _id: false },
);

const conclusionSchema = new Schema(
  {
    kind: {
      type: String,
      enum: ["agreement", "conditional_agreement", "clarified_disagreement", "open"],
      required: true,
    },
    answer: { type: String, required: true, trim: true },
    agreements: { type: [String], required: true, default: [] },
    disagreements: { type: [String], required: true, default: [] },
    conditions: { type: [String], required: true, default: [] },
    openQuestions: { type: [String], required: true, default: [] },
  },
  { _id: false },
);

const preparedTurnSchema = new Schema<TalkRunPreparedTurnRecord>(
  {
    basedOnSequence: { type: Number, required: true, min: 0, validate: Number.isInteger },
    plan: { type: activeTurnSchema, required: true },
    provider: { type: String, enum: ["openai", "gemini"], required: true },
    model: { type: String, enum: LLM_MODEL_IDS, required: true },
    content: { type: String, required: true, trim: true },
    inputTokens: { type: Number, min: 0, validate: Number.isInteger },
    outputTokens: { type: Number, min: 0, validate: Number.isInteger },
    createdAt: { type: Date, required: true, default: Date.now },
  },
  { _id: false },
);

const discussionStateSchema = new Schema<TalkRunDiscussionState>(
  {
    arcPhase: {
      type: String,
      enum: ["positions", "conflict", "examination", "synthesis", "conclusion"],
      required: true,
      default: "positions",
    },
    centralQuestion: { type: String, required: true, default: "", trim: true },
    phaseObjective: { type: String, required: true, default: "", trim: true },
    currentFocus: { type: String, required: true, default: "", trim: true },
    corePositions: { type: [corePositionSchema], required: true, default: [] },
    keyConflict: { type: String, default: "", trim: true },
    contestedClaims: { type: [String], required: true, default: [] },
    evidenceAndTradeoffs: { type: [String], required: true, default: [] },
    openQuestions: { type: [String], required: true, default: [] },
    agreements: { type: [String], required: true, default: [] },
    unresolvedConflicts: { type: [String], required: true, default: [] },
    turningPoints: { type: [turningPointSchema], required: true, default: [] },
    floorQueue: { type: [floorRequestSchema], required: true, default: [] },
    conclusionReadiness: {
      type: String,
      enum: ["not_ready", "developing", "ready", "forced"],
      required: true,
      default: "not_ready",
    },
    conclusionReason: { type: String, default: "", trim: true },
    conclusion: { type: conclusionSchema },
    editorialReviewCount: { type: Number, required: true, default: 0, min: 0 },
    editorialInputTokens: { type: Number, required: true, default: 0, min: 0 },
    editorialOutputTokens: { type: Number, required: true, default: 0, min: 0 },
    participantMemories: {
      type: [participantMemorySchema],
      required: true,
      default: [],
    },
  },
  { _id: false },
);

const talkRunSchema = new Schema<TalkRunRecord>(
  {
    talkId: {
      type: Schema.Types.ObjectId,
      ref: "Talk",
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["idle", "generating", "waiting_for_human", "completed", "failed"],
      required: true,
      default: "idle",
      index: true,
    },
    phase: {
      type: String,
      enum: ["opening", "discussion", "closing", "completed"],
      required: true,
    },
    participantTurnCount: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
      validate: Number.isInteger,
    },
    maxTurns: { type: Number, required: true, min: 1, validate: Number.isInteger },
    targetDurationMinutes: {
      type: Number,
      required: true,
      default: 30,
      min: 1,
      validate: Number.isInteger,
    },
    estimatedAirtimeSeconds: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
      validate: Number.isInteger,
    },
    nextParticipantIndex: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
      max: 4,
      validate: Number.isInteger,
    },
    activeTurn: { type: activeTurnSchema },
    preparedTurn: { type: preparedTurnSchema },
    discussionState: {
      type: discussionStateSchema,
      required: true,
      default: () => ({}),
    },
    talkSnapshot: { type: Schema.Types.Mixed },
    messages: { type: [messageSchema], required: true, default: [] },
    error: { type: String, trim: true },
    generationStartedAt: { type: Date },
    startedAt: { type: Date, required: true, default: Date.now },
    completedAt: { type: Date },
  },
  { timestamps: true },
);

talkRunSchema.index({ talkId: 1, createdAt: -1 });

export const TalkRunModel =
  (models.TalkRun as Model<TalkRunRecord> | undefined) ??
  model<TalkRunRecord>("TalkRun", talkRunSchema);

export type TalkRunDocument = HydratedDocument<TalkRunRecord>;
