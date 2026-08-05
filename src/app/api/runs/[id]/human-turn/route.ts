import { Types } from "mongoose";
import { NextResponse } from "next/server";

import {
  AdvanceTalkRunError,
  submitHumanTalkRunTurn,
} from "@/lib/advance-talk-run";
import type { TalkRunIntent } from "@/types/talk-run";

export const runtime = "nodejs";
export const maxDuration = 120;

interface RouteContext {
  params: Promise<{ id: string }>;
}

const intents: TalkRunIntent[] = [
  "opening",
  "argument",
  "reply",
  "challenge",
  "question",
  "answer",
  "clarification",
  "partial_agreement",
  "interruption",
  "moderation",
  "closing",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  if (!Types.ObjectId.isValid(id)) {
    return NextResponse.json({ error: "Talk run not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }
  if (!isRecord(body)) {
    return NextResponse.json({ error: "Request body must be an object" }, { status: 400 });
  }

  const content = typeof body.content === "string" ? body.content.trim() : "";
  if (!content || content.length > 8_000) {
    return NextResponse.json(
      { error: "Human intervention must contain between 1 and 8000 characters" },
      { status: 400 },
    );
  }
  const intent =
    typeof body.intent === "string" && intents.includes(body.intent as TalkRunIntent)
      ? (body.intent as TalkRunIntent)
      : undefined;
  const targetParticipantIndex = Number.isInteger(body.targetParticipantIndex)
    ? (body.targetParticipantIndex as number)
    : undefined;
  const threadLabel =
    typeof body.threadLabel === "string" ? body.threadLabel.slice(0, 300) : undefined;

  try {
    const run = await submitHumanTalkRunTurn(id, {
      content,
      intent,
      targetParticipantIndex,
      threadLabel,
    });
    return NextResponse.json({ run });
  } catch (error) {
    if (error instanceof AdvanceTalkRunError) {
      return NextResponse.json(
        { error: error.message, run: error.run, code: error.code },
        { status: error.status },
      );
    }
    return NextResponse.json(
      { error: "Unable to save human intervention" },
      { status: 500 },
    );
  }
}
