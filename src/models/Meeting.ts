import { type HydratedDocument, type Model, Schema, model, models } from "mongoose";

import type {
  MeetingActionItem,
  MeetingAgendaItem,
  MeetingAssistantConfiguration,
  MeetingBotConfiguration,
  MeetingCommandEvent,
  MeetingParticipantNote,
  MeetingPendingIntervention,
  MeetingRecord,
  MeetingSummary,
  MeetingTranscriptSegment,
  MeetingVoiceConfiguration,
} from "@/types/meeting";

const actionItemSchema = new Schema<MeetingActionItem>(
  {
    description: { type: String, required: true, trim: true, maxlength: 1_000 },
    owner: { type: String, trim: true, maxlength: 160 },
    dueAt: { type: Date },
    completed: { type: Boolean, required: true, default: false },
  },
  { _id: false },
);

const agendaItemSchema = new Schema<MeetingAgendaItem>(
  {
    id: { type: String, required: true, trim: true },
    title: { type: String, required: true, trim: true, maxlength: 500 },
    mandatory: { type: Boolean, required: true, default: false },
    status: {
      type: String,
      enum: ["pending", "covered", "skipped"],
      required: true,
      default: "pending",
    },
    notes: { type: String, trim: true, maxlength: 2_000 },
  },
  { _id: false },
);

const assistantSchema = new Schema<MeetingAssistantConfiguration>(
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

const commandEventSchema = new Schema<MeetingCommandEvent>(
  {
    id: { type: String, required: true, trim: true },
    kind: {
      type: String,
      enum: ["remember", "summary", "agenda", "ask", "correct", "inform"],
      required: true,
    },
    prompt: { type: String, trim: true, maxlength: 2_000 },
    response: { type: String, required: true, trim: true, maxlength: 8_000 },
    createdAt: { type: Date, required: true, default: Date.now },
  },
  { _id: false },
);

const pendingInterventionSchema = new Schema<MeetingPendingIntervention>(
  {
    id: { type: String, required: true, trim: true },
    type: {
      type: String,
      enum: ["correction", "relevant_information"],
      required: true,
    },
    sourceSpeaker: { type: String, trim: true, maxlength: 160 },
    sourceStatement: { type: String, required: true, trim: true, maxlength: 2_000 },
    reason: { type: String, required: true, trim: true, maxlength: 1_000 },
    response: { type: String, required: true, trim: true, maxlength: 2_000 },
    createdAt: { type: Date, required: true, default: Date.now },
    expiresAt: { type: Date, required: true },
  },
  { _id: false },
);

const participantNoteSchema = new Schema<MeetingParticipantNote>(
  {
    displayName: { type: String, required: true, trim: true, maxlength: 160 },
    note: { type: String, required: true, trim: true, maxlength: 2_000 },
  },
  { _id: false },
);

const transcriptSegmentSchema = new Schema<MeetingTranscriptSegment>(
  {
    sequence: { type: Number, required: true, min: 1, validate: Number.isInteger },
    speakerName: { type: String, required: true, trim: true, maxlength: 160 },
    text: { type: String, required: true, trim: true, maxlength: 10_000 },
    language: { type: String, enum: ["it", "en"] },
    startMs: { type: Number, min: 0 },
    endMs: { type: Number, min: 0 },
    createdAt: { type: Date, required: true, default: Date.now },
  },
  { _id: false },
);

const summarySchema = new Schema<MeetingSummary>(
  {
    overview: { type: String, default: "", trim: true, maxlength: 8_000 },
    rememberedFacts: { type: [String], required: true, default: [] },
    decisions: { type: [String], required: true, default: [] },
    actionItems: { type: [actionItemSchema], required: true, default: [] },
    openQuestions: { type: [String], required: true, default: [] },
    participantNotes: { type: [participantNoteSchema], required: true, default: [] },
    generatedAt: { type: Date },
  },
  { _id: false },
);

const botSchema = new Schema<MeetingBotConfiguration>(
  {
    provider: {
      type: String,
      enum: ["mock", "recall", "attendee"],
      required: true,
      default: "mock",
    },
    accessMode: {
      type: String,
      enum: ["verified_guest", "anonymous_guest"],
      required: true,
      default: "anonymous_guest",
    },
    status: {
      type: String,
      enum: ["not_scheduled", "scheduling", "scheduled", "joining", "waiting_room", "joined", "left", "failed"],
      required: true,
      default: "not_scheduled",
    },
    externalBotId: { type: String, trim: true },
    accountEmail: { type: String, trim: true, lowercase: true, maxlength: 320 },
    outputToken: { type: String, required: true, trim: true },
    outputUrl: { type: String, trim: true },
    scheduledFor: { type: Date },
    joinedAt: { type: Date },
    leftAt: { type: Date },
    providerStatusCode: { type: String, trim: true, maxlength: 160 },
    lastStatusAt: { type: Date },
    lastCorrectionCheckAt: { type: Date },
    processedWebhookIds: { type: [String], required: true, default: [] },
    lastError: { type: String, trim: true, maxlength: 2_000 },
  },
  { _id: false },
);

const voiceSchema = new Schema<MeetingVoiceConfiguration>(
  {
    mode: { type: String, required: true },
    provider: { type: String, required: true },
    model: { type: String, required: true, trim: true },
    pronunciationProfile: { type: String, required: true, trim: true },
  },
  { _id: false },
);

const meetingSchema = new Schema<MeetingRecord>(
  {
    seriesId: { type: Schema.Types.ObjectId, ref: "MeetingSeries", index: true },
    title: { type: String, required: true, trim: true, maxlength: 160 },
    meetingUrl: { type: String, required: true, trim: true, maxlength: 2_000 },
    platform: {
      type: String,
      enum: ["microsoft_teams"],
      required: true,
    },
    scheduledStart: { type: Date, required: true },
    scheduledEnd: { type: Date, required: true },
    timezone: { type: String, required: true, trim: true, maxlength: 100 },
    objective: { type: String, trim: true, maxlength: 2_000 },
    seriesLabel: { type: String, trim: true, maxlength: 160 },
    seriesKey: { type: String, required: true, trim: true, maxlength: 120 },
    language: { type: String, enum: ["auto", "it", "en"], required: true },
    autoJoin: { type: Boolean, required: true, default: false },
    status: {
      type: String,
      enum: ["scheduled", "joining", "waiting_room", "live", "processing", "completed", "cancelled", "failed"],
      required: true,
      default: "scheduled",
    },
    agenda: { type: [agendaItemSchema], required: true, default: [] },
    assistant: { type: assistantSchema, required: true, default: () => ({}) },
    commandHistory: { type: [commandEventSchema], required: true, default: [] },
    pendingIntervention: { type: pendingInterventionSchema, required: false },
    bot: { type: botSchema, required: true },
    voice: { type: voiceSchema, required: true },
    retention: {
      transcriptDays: { type: Number, required: true, min: 1, default: 90 },
      storeAudio: { type: Boolean, required: true, default: false },
      consentRequired: { type: Boolean, required: true, default: true },
    },
    participants: { type: [String], required: true, default: [] },
    transcript: { type: [transcriptSegmentSchema], required: true, default: [] },
    summary: { type: summarySchema, required: true, default: () => ({}) },
  },
  { timestamps: true },
);

meetingSchema.index({ scheduledStart: 1 });
meetingSchema.index({ status: 1, scheduledStart: 1 });
meetingSchema.index({ seriesKey: 1, scheduledStart: -1 });
meetingSchema.index({ seriesId: 1, scheduledStart: 1 });
meetingSchema.index({ "bot.outputToken": 1 }, { unique: true });

export const MeetingModel =
  (models.Meeting as Model<MeetingRecord> | undefined) ??
  model<MeetingRecord>("Meeting", meetingSchema);

export type MeetingDocument = HydratedDocument<MeetingRecord>;
