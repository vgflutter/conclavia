import { Types } from "mongoose";
import { NextResponse } from "next/server";

import { executeMeetingCommand } from "@/lib/execute-meeting-command";
import { connectToDatabase } from "@/lib/mongodb";
import { serializeMeeting } from "@/lib/serialize-meeting";
import { MeetingModel } from "@/models/Meeting";
import type { MeetingCommandKind } from "@/types/meeting";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!Types.ObjectId.isValid(id)) return NextResponse.json({ error: "Meeting not found" }, { status: 404 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid command" }, { status: 400 });
  }

  const payload = body as Record<string, unknown>;
  const kind = payload.kind as MeetingCommandKind;
  const prompt = typeof payload.prompt === "string" ? payload.prompt.trim().slice(0, 2_000) : "";
  if (!["remember", "summary", "agenda", "ask", "correct"].includes(kind)) {
    return NextResponse.json({ error: "Unknown command" }, { status: 400 });
  }
  if (!["summary", "agenda"].includes(kind) && !prompt) {
    return NextResponse.json({ error: "This command requires text" }, { status: 400 });
  }

  try {
    await connectToDatabase();
    const document = await MeetingModel.findById(id).exec();
    if (!document) return NextResponse.json({ error: "Meeting not found" }, { status: 404 });

    const response = await executeMeetingCommand(document, kind, prompt);

    return NextResponse.json({ response, meeting: serializeMeeting(document) });
  } catch (error) {
    console.error("Unable to execute meeting command", error);
    return NextResponse.json({ error: "Unable to execute meeting command" }, { status: 500 });
  }
}
