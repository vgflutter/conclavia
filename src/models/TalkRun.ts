import {
  type HydratedDocument,
  type Model,
  Schema,
  Types,
  model,
  models,
} from "mongoose";

import { LLM_MODEL_IDS, type LlmModelId, type LlmProvider } from "@/lib/llm-models";
import type {
  TalkRunPhase,
  TalkRunSpeakerType,
  TalkRunStatus,
} from "@/types/talk-run";

interface TalkRunMessageRecord {
  sequence: number;
  speakerType: TalkRunSpeakerType;
  participantIndex?: number;
  speakerName: string;
  speakerRole?: string;
  provider: LlmProvider;
  model: LlmModelId;
  content: string;
  inputTokens?: number;
  outputTokens?: number;
  createdAt: Date;
}

interface TalkRunRecord {
  talkId: Types.ObjectId;
  status: TalkRunStatus;
  phase: TalkRunPhase;
  participantTurnCount: number;
  maxTurns: number;
  nextParticipantIndex: number;
  messages: TalkRunMessageRecord[];
  error?: string;
  generationStartedAt?: Date;
  startedAt: Date;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
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
    provider: { type: String, enum: ["openai", "gemini"], required: true },
    model: { type: String, enum: LLM_MODEL_IDS, required: true },
    content: { type: String, required: true, trim: true },
    inputTokens: { type: Number, min: 0, validate: Number.isInteger },
    outputTokens: { type: Number, min: 0, validate: Number.isInteger },
    createdAt: { type: Date, required: true, default: Date.now },
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
      enum: ["idle", "generating", "completed", "failed"],
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
    nextParticipantIndex: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
      max: 4,
      validate: Number.isInteger,
    },
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
