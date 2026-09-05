import { Types } from "mongoose";
import { NextResponse } from "next/server";

import { connectToDatabase } from "@/lib/mongodb";
import { serializeMeeting } from "@/lib/serialize-meeting";
import { MeetingModel } from "@/models/Meeting";
import type { AgendaItemStatus } from "@/types/meeting";

export const runtime = "nodejs";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!Types.ObjectId.isValid(id)) return NextResponse.json({ error: "Meeting not found" }, { status: 404 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid agenda update" }, { status: 400 });
  }
  const payload = body as Record<string, unknown>;
  const itemId = typeof payload.itemId === "string" ? payload.itemId : "";
  const status = payload.status as AgendaItemStatus;
  if (!itemId || !["pending", "covered", "skipped"].includes(status)) {
    return NextResponse.json({ error: "Item and status are required" }, { status: 400 });
  }

  try {
    await connectToDatabase();
    const meeting = await MeetingModel.findById(id).exec();
    if (!meeting) return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
    const item = meeting.agenda.find((agendaItem) => agendaItem.id === itemId);
    if (!item) return NextResponse.json({ error: "Agenda item not found" }, { status: 404 });
    if (item.mandatory && status === "skipped") {
      return NextResponse.json({ error: "A mandatory item cannot be skipped" }, { status: 409 });
    }
    item.status = status;
    await meeting.save();
    return NextResponse.json({ meeting: serializeMeeting(meeting) });
  } catch (error) {
    console.error("Unable to update meeting agenda", error);
    return NextResponse.json({ error: "Unable to update meeting agenda" }, { status: 500 });
  }
}
