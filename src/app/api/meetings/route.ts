import { NextResponse } from "next/server";

import { meetingDocumentData } from "@/lib/meeting-factory";
import { getAssistantProfile } from "@/lib/assistant-profile";
import { scheduleMeetingBot } from "@/lib/meeting-bot-scheduler";
import { connectToDatabase } from "@/lib/mongodb";
import { validateMeetingInput } from "@/lib/meeting-validation";
import { serializeMeeting } from "@/lib/serialize-meeting";
import { MeetingModel } from "@/models/Meeting";

export const runtime = "nodejs";

export async function GET() {
  try {
    await connectToDatabase();
    const meetings = await MeetingModel.find().sort({ scheduledStart: 1 }).exec();
    return NextResponse.json({ meetings: meetings.map(serializeMeeting) });
  } catch (error) {
    console.error("Unable to list meetings", error);
    return NextResponse.json({ error: "Unable to load meetings" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON" },
      { status: 400 },
    );
  }

  const result = validateMeetingInput(body);
  if (!result.success) {
    return NextResponse.json(
      { error: "The meeting is invalid", issues: result.issues },
      { status: 400 },
    );
  }

  try {
    await connectToDatabase();
    const profile = await getAssistantProfile();
    const meeting = await MeetingModel.create(
      meetingDocumentData(result.data, { assistantName: profile.displayName }),
    );
    await scheduleMeetingBot(meeting);

    return NextResponse.json({ meeting: serializeMeeting(meeting) }, { status: 201 });
  } catch (error) {
    console.error("Unable to create meeting", error);
    return NextResponse.json({ error: "Unable to save meeting" }, { status: 500 });
  }
}
