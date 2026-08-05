import {
  type HydratedDocument,
  type Model,
  Schema,
  model,
  models,
} from "mongoose";

import type {
  ModeratorConfiguration,
  Participant,
  TalkRecord,
} from "@/types/talk";
import { DEFAULT_LLM_MODEL, LLM_MODEL_IDS } from "@/lib/llm-models";

const scoreField = {
  type: Number,
  required: true,
  min: 0,
  max: 100,
  validate: Number.isInteger,
};

const participantSchema = new Schema<Participant>(
  {
    kind: {
      type: String,
      enum: ["ai", "human", "unassigned"],
      required: true,
      default: "ai",
    },
    name: { type: String, default: "", trim: true },
    role: { type: String, default: "", trim: true },
    perspectiveMode: {
      type: String,
      enum: ["custom", "automatic", "random"],
      required: true,
      default: "custom",
    },
    perspectivePrompt: { type: String, default: "", trim: true },
    speakingStylePrompt: { type: String, trim: true },
    modelOverride: { type: String, enum: LLM_MODEL_IDS, trim: true },
    assertiveness: scoreField,
    patience: scoreField,
    interruptiveness: scoreField,
    baselineTension: scoreField,
  },
  { _id: false },
);

const moderatorSchema = new Schema<ModeratorConfiguration>(
  {
    kind: {
      type: String,
      enum: ["none", "ai", "human"],
      required: true,
      default: "none",
    },
    name: { type: String, trim: true },
    role: { type: String, trim: true },
    instructions: { type: String, trim: true },
    style: {
      type: String,
      enum: ["neutral", "challenging", "facilitating"],
      required: true,
      default: "neutral",
    },
    modelOverride: { type: String, enum: LLM_MODEL_IDS, trim: true },
    canInterrupt: { type: Boolean, required: true, default: true },
    manageTime: { type: Boolean, required: true, default: true },
    summarizeAtEnd: { type: Boolean, required: true, default: true },
  },
  { _id: false },
);

const talkSchema = new Schema<TalkRecord>(
  {
    title: { type: String, required: true, trim: true },
    topic: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    language: { type: String, required: true, trim: true },
    participants: {
      type: [participantSchema],
      required: true,
      validate: {
        validator: (participants: Participant[]) => participants.length === 5,
        message: "A talk must have exactly five participants",
      },
    },
    moderator: {
      type: moderatorSchema,
      required: true,
      default: () => ({}),
    },
    status: {
      type: String,
      enum: ["draft", "ready"],
      required: true,
    },
    settings: {
      maxTurns: { type: Number, required: true, min: 1, validate: Number.isInteger },
      targetDurationMinutes: {
        type: Number,
        required: true,
        default: 30,
        min: 1,
        validate: Number.isInteger,
      },
      defaultModel: {
        type: String,
        enum: LLM_MODEL_IDS,
        required: true,
        default: DEFAULT_LLM_MODEL,
        trim: true,
      },
      allowInterruptions: { type: Boolean, required: true },
      seekCommonGround: { type: Boolean, required: true },
    },
  },
  { timestamps: true },
);

export const TalkModel =
  (models.Talk as Model<TalkRecord> | undefined) ??
  model<TalkRecord>("Talk", talkSchema);

export type TalkDocument = HydratedDocument<TalkRecord>;
