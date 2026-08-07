import {
  type HydratedDocument,
  type Model,
  Schema,
  Types,
  model,
  models,
} from "mongoose";

import type {
  AudienceCueMode,
  AudienceMessageStatus,
} from "@/types/audience";

export interface AudienceMessageRecord {
  id: string;
  authorChannelId?: string;
  authorName: string;
  authorImageUrl?: string;
  content: string;
  publishedAt: Date;
  status: AudienceMessageStatus;
  isSponsor: boolean;
  isModerator: boolean;
  amountDisplayString?: string;
  action?: "on_air" | AudienceCueMode;
  targetParticipantIndex?: number;
  onAirUntil?: Date;
  selectedAt?: Date;
  usedAt?: Date;
}

export interface AudienceRoomRecord {
  runId: Types.ObjectId;
  provider: "youtube";
  videoId: string;
  videoTitle: string;
  liveChatId: string;
  connected: boolean;
  moderationEnabled: boolean;
  nextPageToken?: string;
  pollingIntervalMillis: number;
  activeMessageId?: string;
  messages: AudienceMessageRecord[];
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

const audienceMessageSchema = new Schema<AudienceMessageRecord>(
  {
    id: { type: String, required: true, trim: true },
    authorChannelId: { type: String, trim: true },
    authorName: { type: String, required: true, trim: true },
    authorImageUrl: { type: String, trim: true },
    content: { type: String, required: true, trim: true, maxlength: 1_000 },
    publishedAt: { type: Date, required: true },
    status: {
      type: String,
      enum: ["pending", "available", "on_air", "queued", "used", "rejected"],
      required: true,
    },
    isSponsor: { type: Boolean, required: true, default: false },
    isModerator: { type: Boolean, required: true, default: false },
    amountDisplayString: { type: String, trim: true },
    action: {
      type: String,
      enum: ["on_air", "host", "participant", "prompt"],
    },
    targetParticipantIndex: {
      type: Number,
      min: 0,
      max: 4,
      validate: Number.isInteger,
    },
    onAirUntil: { type: Date },
    selectedAt: { type: Date },
    usedAt: { type: Date },
  },
  { _id: false },
);

const audienceRoomSchema = new Schema<AudienceRoomRecord>(
  {
    runId: {
      type: Schema.Types.ObjectId,
      ref: "TalkRun",
      required: true,
      unique: true,
      index: true,
    },
    provider: { type: String, enum: ["youtube"], required: true },
    videoId: { type: String, required: true, trim: true },
    videoTitle: { type: String, required: true, trim: true },
    liveChatId: { type: String, required: true, trim: true },
    connected: { type: Boolean, required: true, default: true },
    moderationEnabled: { type: Boolean, required: true, default: false },
    nextPageToken: { type: String, trim: true },
    pollingIntervalMillis: { type: Number, required: true, default: 5_000, min: 1_000 },
    activeMessageId: { type: String, trim: true },
    messages: { type: [audienceMessageSchema], required: true, default: [] },
    error: { type: String, trim: true },
  },
  { timestamps: true },
);

export const AudienceRoomModel =
  (models.AudienceRoom as Model<AudienceRoomRecord> | undefined) ??
  model<AudienceRoomRecord>("AudienceRoom", audienceRoomSchema);

export type AudienceRoomDocument = HydratedDocument<AudienceRoomRecord>;
