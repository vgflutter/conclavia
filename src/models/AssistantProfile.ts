import { type HydratedDocument, type Model, Schema, model, models } from "mongoose";

import type { AssistantProfileRecord } from "@/types/assistant-profile";

const assistantProfileSchema = new Schema<AssistantProfileRecord>(
  {
    key: { type: String, enum: ["default"], required: true, unique: true },
    displayName: { type: String, required: true, trim: true, maxlength: 80 },
    role: { type: String, required: true, trim: true, maxlength: 120 },
    appearance: { type: String, enum: ["business_clay"], required: true },
    personality: {
      responseStyle: {
        type: String,
        enum: ["concise", "balanced", "detailed"],
        required: true,
        default: "balanced",
      },
      attitude: {
        type: String,
        enum: ["discreet", "collaborative", "proactive"],
        required: true,
        default: "collaborative",
      },
    },
    voice: {
      provider: { type: String, enum: ["local"], required: true },
      model: { type: String, enum: ["supertonic_3"], required: true },
      style: {
        type: String,
        enum: ["executive_warm", "executive_clear"],
        required: true,
      },
      speakingRate: { type: Number, min: 0.8, max: 1.1, required: true },
      pronunciationProfile: { type: String, required: true, trim: true, maxlength: 120 },
    },
  },
  { timestamps: true },
);

export const AssistantProfileModel =
  (models.AssistantProfile as Model<AssistantProfileRecord> | undefined) ??
  model<AssistantProfileRecord>("AssistantProfile", assistantProfileSchema);

export type AssistantProfileDocument = HydratedDocument<AssistantProfileRecord>;
