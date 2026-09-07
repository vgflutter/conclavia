import { NextResponse } from "next/server";

import { connectToDatabase } from "@/lib/mongodb";
import {
  processMeetingTranscriptAutomation,
  storeMeetingTranscript,
} from "@/lib/process-meeting-transcript";
import { MeetingModel } from "@/models/Meeting";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cleanText(value: unknown, maximum: number): string {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

export async function POST(
  request: Request,
  context: { params: Promise<{ token: string }> },
) {
  const { token } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(token)) {
    return NextResponse.json({ error: "Meeting output not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid transcript" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid transcript" }, { status: 400 });
  }

  const payload = body as Record<string, unknown>;
  const text = cleanText(payload.text, 10_000);
  const speakerName = cleanText(payload.speakerName, 160) || "Partecipante";
  const language = payload.language === "en" ? "en" : payload.language === "it" ? "it" : undefined;
  const startMs = Number(payload.startMs);
  const endMs = Number(payload.endMs);
  if (!text) return NextResponse.json({ error: "Transcript text is required" }, { status: 400 });

  try {
    await connectToDatabase();
    const meeting = await MeetingModel.findOne({ "bot.outputToken": token }).exec();
    if (
      !meeting ||
      meeting.bot.provider !== "recall" ||
      !meeting.bot.externalBotId ||
      !["joining", "waiting_room", "live"].includes(meeting.status)
    ) {
      return NextResponse.json({ error: "Meeting output not active" }, { status: 409 });
    }

    const stored = await storeMeetingTranscript(meeting, {
      speakerName,
      text,
      language,
      startMs: Number.isFinite(startMs) ? Math.max(0, Math.round(startMs)) : undefined,
      endMs: Number.isFinite(endMs) ? Math.max(0, Math.round(endMs)) : undefined,
    });
    const command = stored.duplicate
      ? undefined
      : await processMeetingTranscriptAutomation(
      meeting,
      text,
    );
    return NextResponse.json(
      {
        received: true,
        command,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Unable to store live meeting transcript", error);
    return NextResponse.json(
      { error: "Meeting transcript unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
