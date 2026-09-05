import { type HydratedDocument, type Model, Schema, model, models } from "mongoose";

import type { MeetingSeriesRecord } from "@/types/meeting";

const agendaTemplateSchema = new Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 500 },
    mandatory: { type: Boolean, required: true, default: false },
  },
  { _id: false },
);

const assistantSchema = new Schema(
  {
    wakeWord: { type: String, required: true, trim: true, maxlength: 80 },
    answerQuestions: { type: Boolean, required: true, default: true },
    captureMemory: { type: Boolean, required: true, default: true },
    summarizeOnRequest: { type: Boolean, required: true, default: true },
    correctionPolicy: {
      type: String,
      enum: ["important_only", "on_request", "off"],
      required: true,
      default: "important_only",
    },
  },
  { _id: false },
);

const meetingSeriesSchema = new Schema<MeetingSeriesRecord>(
  {
    title: { type: String, required: true, trim: true, maxlength: 160 },
    objective: { type: String, trim: true, maxlength: 2_000 },
    timezone: { type: String, required: true, trim: true, maxlength: 100 },
    language: { type: String, enum: ["auto", "it", "en"], required: true },
    autoJoin: { type: Boolean, required: true, default: false },
    agenda: { type: [agendaTemplateSchema], required: true, default: [] },
    assistant: { type: assistantSchema, required: true, default: () => ({}) },
    voice: {
      mode: { type: String, required: true },
      provider: { type: String, required: true },
      model: { type: String, required: true, trim: true },
      pronunciationProfile: { type: String, required: true, trim: true },
    },
  },
  { timestamps: true },
);

meetingSeriesSchema.index({ updatedAt: -1 });

export const MeetingSeriesModel =
  (models.MeetingSeries as Model<MeetingSeriesRecord> | undefined) ??
  model<MeetingSeriesRecord>("MeetingSeries", meetingSeriesSchema);

export type MeetingSeriesDocument = HydratedDocument<MeetingSeriesRecord>;
