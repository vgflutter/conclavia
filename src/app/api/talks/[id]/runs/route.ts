import { Types } from "mongoose";
import { NextResponse } from "next/server";

import { connectToDatabase } from "@/lib/mongodb";
import { isProviderConfigured } from "@/lib/llm-provider";
import { serializeTalk } from "@/lib/serialize-talk";
import { serializeTalkRun } from "@/lib/serialize-talk-run";
import {
  getTalkRunBlockCode,
  MAX_RUN_TURNS,
  requiredTalkProviders,
} from "@/lib/talk-run-compatibility";
import { TalkModel } from "@/models/Talk";
import { TalkRunModel } from "@/models/TalkRun";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  if (!Types.ObjectId.isValid(id)) {
    return NextResponse.json({ error: "Talk not found" }, { status: 404 });
  }

  try {
    await connectToDatabase();
    const run = await TalkRunModel.findOne({ talkId: id })
      .sort({ createdAt: -1 })
      .exec();

    return NextResponse.json({ run: run ? serializeTalkRun(run) : null });
  } catch (error) {
    console.error("Unable to load latest talk run", error);
    return NextResponse.json(
      { error: "Unable to load the talk run" },
      { status: 500 },
    );
  }
}

export async function POST(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  if (!Types.ObjectId.isValid(id)) {
    return NextResponse.json({ error: "Talk not found" }, { status: 404 });
  }

  try {
    await connectToDatabase();
    const document = await TalkModel.findById(id).exec();
    if (!document) {
      return NextResponse.json({ error: "Talk not found" }, { status: 404 });
    }

    const talk = serializeTalk(document);
    const blockCode = getTalkRunBlockCode(talk);
    if (blockCode) {
      return NextResponse.json(
        { error: "This talk cannot be run yet", code: blockCode },
        { status: 409 },
      );
    }

    const missingProvider = requiredTalkProviders(talk).find(
      (provider) => !isProviderConfigured(provider),
    );
    if (missingProvider) {
      return NextResponse.json(
        {
          error: "A required LLM provider is not configured",
          code: `missing_${missingProvider}_key`,
        },
        { status: 503 },
      );
    }

    const run = await TalkRunModel.create({
      talkId: document._id,
      status: "idle",
      phase: talk.moderator.kind === "ai" ? "opening" : "discussion",
      participantTurnCount: 0,
      maxTurns: Math.min(talk.settings.maxTurns, MAX_RUN_TURNS),
      nextParticipantIndex: 0,
      messages: [],
      startedAt: new Date(),
    });

    return NextResponse.json({ run: serializeTalkRun(run) }, { status: 201 });
  } catch (error) {
    console.error("Unable to create talk run", error);
    return NextResponse.json(
      { error: "Unable to create the talk run" },
      { status: 500 },
    );
  }
}
