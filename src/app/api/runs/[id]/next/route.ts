import { Types } from "mongoose";
import { NextResponse } from "next/server";

import { generateLlmText, ProviderError } from "@/lib/llm-provider";
import { connectToDatabase } from "@/lib/mongodb";
import { serializeTalk } from "@/lib/serialize-talk";
import { serializeTalkRun } from "@/lib/serialize-talk-run";
import { getTalkRunBlockCode } from "@/lib/talk-run-compatibility";
import {
  buildModeratorPrompt,
  buildParticipantPrompt,
} from "@/lib/talk-run-prompt";
import { TalkModel } from "@/models/Talk";
import { TalkRunModel, type TalkRunDocument } from "@/models/TalkRun";
import type { TalkRunPhase } from "@/types/talk-run";

export const runtime = "nodejs";
export const maxDuration = 120;

interface RouteContext {
  params: Promise<{ id: string }>;
}

async function failRun(
  run: TalkRunDocument,
  message: string,
): Promise<TalkRunDocument> {
  const failed = await TalkRunModel.findByIdAndUpdate(
    run._id,
    {
      $set: { status: "failed", error: message },
      $unset: { generationStartedAt: 1 },
    },
    { new: true },
  ).exec();

  return failed ?? run;
}

export async function POST(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  if (!Types.ObjectId.isValid(id)) {
    return NextResponse.json({ error: "Talk run not found" }, { status: 404 });
  }

  await connectToDatabase();
  const claimed = await TalkRunModel.findOneAndUpdate(
    {
      _id: id,
      status: { $in: ["idle", "failed"] },
    },
    {
      $set: { status: "generating", generationStartedAt: new Date() },
      $unset: { error: 1 },
    },
    { new: true },
  ).exec();

  if (!claimed) {
    const current = await TalkRunModel.findById(id).exec();
    if (!current) {
      return NextResponse.json({ error: "Talk run not found" }, { status: 404 });
    }
    if (current.status === "completed") {
      return NextResponse.json({ run: serializeTalkRun(current) });
    }
    return NextResponse.json(
      { error: "A turn is already being generated", run: serializeTalkRun(current) },
      { status: 409 },
    );
  }

  try {
    const talkDocument = await TalkModel.findById(claimed.talkId).exec();
    if (!talkDocument) {
      const failed = await failRun(claimed, "The source talk no longer exists");
      return NextResponse.json(
        { error: failed.error, run: serializeTalkRun(failed) },
        { status: 409 },
      );
    }

    const talk = serializeTalk(talkDocument);
    const blockCode = getTalkRunBlockCode(talk);
    if (blockCode) {
      const failed = await failRun(
        claimed,
        "The talk configuration is no longer supported by this runner",
      );
      return NextResponse.json(
        { error: failed.error, code: blockCode, run: serializeTalkRun(failed) },
        { status: 409 },
      );
    }

    const messages = serializeTalkRun(claimed).messages;
    const currentPhase = claimed.phase;
    let model;
    let speakerType: "participant" | "moderator";
    let participantIndex: number | undefined;
    let speakerName: string;
    let speakerRole: string | undefined;
    let prompt;

    if (currentPhase === "opening" || currentPhase === "closing") {
      if (talk.moderator.kind !== "ai") {
        const failed = await failRun(claimed, "AI moderator configuration is missing");
        return NextResponse.json(
          { error: failed.error, run: serializeTalkRun(failed) },
          { status: 409 },
        );
      }
      model = talk.moderator.modelOverride ?? talk.settings.defaultModel;
      speakerType = "moderator";
      speakerName = talk.moderator.name ?? "Moderator";
      speakerRole = talk.moderator.role;
      prompt = buildModeratorPrompt(talk, messages, currentPhase);
    } else if (currentPhase === "discussion") {
      participantIndex = claimed.nextParticipantIndex;
      const participant = talk.participants[participantIndex];
      model = participant.modelOverride ?? talk.settings.defaultModel;
      speakerType = "participant";
      speakerName = participant.name;
      speakerRole = participant.role;
      prompt = buildParticipantPrompt(talk, messages, participantIndex);
    } else {
      const completed = await TalkRunModel.findByIdAndUpdate(
        claimed._id,
        {
          $set: { status: "completed", phase: "completed", completedAt: new Date() },
          $unset: { generationStartedAt: 1 },
        },
        { new: true },
      ).exec();
      return NextResponse.json({ run: serializeTalkRun(completed ?? claimed) });
    }

    const generation = await generateLlmText({ model, ...prompt });
    let nextPhase: TalkRunPhase = currentPhase;
    let participantTurnCount = claimed.participantTurnCount;
    let nextParticipantIndex = claimed.nextParticipantIndex;

    if (currentPhase === "opening") {
      nextPhase = "discussion";
    } else if (currentPhase === "discussion") {
      participantTurnCount += 1;
      nextParticipantIndex = (claimed.nextParticipantIndex + 1) % 5;
      if (participantTurnCount >= claimed.maxTurns) {
        nextPhase =
          talk.moderator.kind === "ai" && talk.moderator.summarizeAtEnd
            ? "closing"
            : "completed";
      }
    } else {
      nextPhase = "completed";
    }

    const completed = nextPhase === "completed";
    const updated = await TalkRunModel.findByIdAndUpdate(
      claimed._id,
      {
        $push: {
          messages: {
            sequence: claimed.messages.length + 1,
            speakerType,
            participantIndex,
            speakerName,
            speakerRole,
            provider: generation.provider,
            model: generation.model,
            content: generation.content,
            inputTokens: generation.inputTokens,
            outputTokens: generation.outputTokens,
            createdAt: new Date(),
          },
        },
        $set: {
          status: completed ? "completed" : "idle",
          phase: nextPhase,
          participantTurnCount,
          nextParticipantIndex,
          ...(completed ? { completedAt: new Date() } : {}),
        },
        $unset: { generationStartedAt: 1, error: 1 },
      },
      { new: true },
    ).exec();

    if (!updated) {
      throw new Error("Talk run disappeared while saving the generated turn");
    }

    return NextResponse.json({ run: serializeTalkRun(updated) });
  } catch (error) {
    const message =
      error instanceof ProviderError
        ? error.message
        : "Unable to generate the next intervention";
    console.error("Talk run generation failed", message);
    const failed = await failRun(claimed, message);
    return NextResponse.json(
      { error: message, run: serializeTalkRun(failed) },
      { status: 502 },
    );
  }
}
