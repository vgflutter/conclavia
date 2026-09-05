import { Types } from "mongoose";
import { NextResponse } from "next/server";

import { connectToDatabase } from "@/lib/mongodb";
import { cancelMeetingBot } from "@/lib/meeting-bot-scheduler";
import { serializeMeeting } from "@/lib/serialize-meeting";
import { MeetingModel } from "@/models/Meeting";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  if (!Types.ObjectId.isValid(id)) {
    return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
  }

  try {
    await connectToDatabase();
    const meeting = await MeetingModel.findById(id).exec();
    if (!meeting) {
      return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
    }
    return NextResponse.json({ meeting: serializeMeeting(meeting) });
  } catch (error) {
    console.error("Unable to load meeting", error);
    return NextResponse.json({ error: "Unable to load meeting" }, { status: 500 });
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  if (!Types.ObjectId.isValid(id)) {
    return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
  }

  try {
    await connectToDatabase();
    const meeting = await MeetingModel.findById(id).exec();
    if (!meeting) {
      return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
    }
    if (["joining", "waiting_room", "live", "processing"].includes(meeting.status)) {
      return NextResponse.json(
        { error: "Complete the active meeting before deleting it" },
        { status: 409 },
      );
    }
    await cancelMeetingBot(meeting);
    await meeting.deleteOne();
    return NextResponse.json({ deleted: true });
  } catch (error) {
    console.error("Unable to delete meeting", error);
    return NextResponse.json({ error: "Unable to delete meeting" }, { status: 500 });
  }
}
