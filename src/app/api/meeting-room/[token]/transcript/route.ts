import { NextResponse } from "next/server";

import {
  detectImportantCorrection,
  executeMeetingCommand,
} from "@/lib/execute-meeting-command";
import { parseMeetingVoiceCommand } from "@/lib/meeting-command";
import { connectToDatabase } from "@/lib/mongodb";
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

    const duplicate = meeting.transcript.slice(-8).some(
      (segment) =>
        segment.speakerName === speakerName &&
        segment.text === text &&
        (!Number.isFinite(startMs) || segment.startMs === Math.max(0, Math.round(startMs))),
    );
    if (!duplicate) {
      const previousSequence = meeting.transcript.at(-1)?.sequence || 0;
      meeting.transcript.push({
        sequence: previousSequence + 1,
        speakerName,
        text,
        language,
        startMs: Number.isFinite(startMs) ? Math.max(0, Math.round(startMs)) : undefined,
        endMs: Number.isFinite(endMs) ? Math.max(0, Math.round(endMs)) : undefined,
        createdAt: new Date(),
      });
      if (!meeting.participants.some((name) => name.toLocaleLowerCase() === speakerName.toLocaleLowerCase())) {
        meeting.participants.push(speakerName);
      }
      if (meeting.transcript.length > 4_000) {
        meeting.transcript.splice(0, meeting.transcript.length - 4_000);
      }
      await meeting.save();
    }

    const voiceCommand = duplicate
      ? undefined
      : parseMeetingVoiceCommand(text, meeting.assistant.wakeWord || "Conclavia");
    if (!voiceCommand) {
      const lastCheck = meeting.bot.lastCorrectionCheckAt?.getTime() || 0;
      const correctionDue =
        !duplicate &&
        meeting.assistant.correctionPolicy === "important_only" &&
        text.length >= 30 &&
        !text.trim().endsWith("?") &&
        Date.now() - lastCheck >= 30_000;
      if (!correctionDue) {
        return NextResponse.json(
          { received: true },
          { headers: { "Cache-Control": "no-store" } },
        );
      }

      meeting.bot.lastCorrectionCheckAt = new Date();
      await meeting.save();
      const correction = await detectImportantCorrection(meeting, text);
      return NextResponse.json(
        {
          received: true,
          command: correction && meeting.commandHistory.at(-1)
            ? {
                id: meeting.commandHistory.at(-1)?.id,
                kind: "correct",
                response: correction,
              }
            : undefined,
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const response = await executeMeetingCommand(
      meeting,
      voiceCommand.kind,
      voiceCommand.prompt,
    );
    return NextResponse.json(
      {
        received: true,
        command: meeting.commandHistory.at(-1)
          ? {
              id: meeting.commandHistory.at(-1)?.id,
              kind: voiceCommand.kind,
              response,
            }
          : undefined,
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
