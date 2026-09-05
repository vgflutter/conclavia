import { Types } from "mongoose";
import { NextResponse } from "next/server";

import { connectToDatabase } from "@/lib/mongodb";
import { serializeMeeting } from "@/lib/serialize-meeting";
import { MeetingModel } from "@/models/Meeting";
import type { MeetingActionItem } from "@/types/meeting";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

function stringList(value: unknown, maximum = 20): string[] | null {
  if (!Array.isArray(value)) return null;
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().slice(0, 1_000))
    .filter(Boolean)
    .slice(0, maximum);
}

function actionItems(value: unknown): MeetingActionItem[] | null {
  if (!Array.isArray(value)) return null;
  return value
    .filter(
      (item): item is Record<string, unknown> =>
        Boolean(item) && typeof item === "object" && !Array.isArray(item),
    )
    .map((item) => ({
      description:
        typeof item.description === "string"
          ? item.description.trim().slice(0, 1_000)
          : "",
      owner:
        typeof item.owner === "string"
          ? item.owner.trim().slice(0, 160) || undefined
          : undefined,
      completed: item.completed === true,
    }))
    .filter((item) => item.description)
    .slice(0, 20);
}

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  if (!Types.ObjectId.isValid(id)) {
    return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid meeting outcome" }, { status: 400 });
  }

  const payload = body as Record<string, unknown>;
  const overview =
    typeof payload.overview === "string"
      ? payload.overview.trim().slice(0, 8_000)
      : "";
  const decisions = stringList(payload.decisions);
  const rememberedFacts = stringList(payload.rememberedFacts);
  const openQuestions = stringList(payload.openQuestions);
  const items = actionItems(payload.actionItems);

  if (!overview || !rememberedFacts || !decisions || !openQuestions || !items) {
    return NextResponse.json(
      { error: "Overview, remembered facts, decisions, action items and open questions are required" },
      { status: 400 },
    );
  }

  try {
    await connectToDatabase();
    const meeting = await MeetingModel.findById(id).exec();
    if (!meeting) {
      return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
    }

    meeting.summary.overview = overview;
    meeting.summary.rememberedFacts = rememberedFacts;
    meeting.summary.decisions = decisions;
    meeting.summary.actionItems = items;
    meeting.summary.openQuestions = openQuestions;
    meeting.summary.generatedAt = new Date();
    meeting.status = "completed";
    if (meeting.bot.status === "joined") {
      meeting.bot.status = "left";
      meeting.bot.leftAt = new Date();
    }
    await meeting.save();

    return NextResponse.json({ meeting: serializeMeeting(meeting) });
  } catch (error) {
    console.error("Unable to save meeting outcome", error);
    return NextResponse.json(
      { error: "Unable to save meeting outcome" },
      { status: 500 },
    );
  }
}
