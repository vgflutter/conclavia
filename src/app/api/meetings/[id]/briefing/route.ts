import { Types } from "mongoose";
import { NextResponse } from "next/server";

import { getAssistantProfile } from "@/lib/assistant-profile";
import { buildMeetingAssistantPrompt } from "@/lib/meeting-assistant-prompt";
import { buildMeetingContinuity } from "@/lib/meeting-continuity";
import { connectToDatabase } from "@/lib/mongodb";
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

    const briefing = await buildMeetingContinuity(meeting);
    const profile = await getAssistantProfile();
    const assistantPrompt = buildMeetingAssistantPrompt({
      profile,
      meeting: serializeMeeting(meeting),
      briefing,
    });
    return NextResponse.json({ briefing, assistantPrompt });
  } catch (error) {
    console.error("Unable to build meeting briefing", error);
    return NextResponse.json(
      { error: "Unable to build meeting briefing" },
      { status: 500 },
    );
  }
}
