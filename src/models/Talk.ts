import {
  type HydratedDocument,
  type Model,
  Schema,
  model,
  models,
} from "mongoose";

import type { Participant, TalkRecord } from "@/types/talk";

const scoreField = {
  type: Number,
  required: true,
  min: 0,
  max: 100,
  validate: Number.isInteger,
};

const participantSchema = new Schema<Participant>(
  {
    name: { type: String, required: true, trim: true },
    role: { type: String, required: true, trim: true },
    perspectivePrompt: { type: String, required: true, trim: true },
    speakingStylePrompt: { type: String, trim: true },
    assertiveness: scoreField,
    patience: scoreField,
    interruptiveness: scoreField,
    baselineTension: scoreField,
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
    status: {
      type: String,
      enum: ["draft", "ready"],
      required: true,
    },
    settings: {
      maxTurns: { type: Number, required: true, min: 1, validate: Number.isInteger },
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
