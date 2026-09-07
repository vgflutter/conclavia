import { Types } from "mongoose";
import { NextResponse } from "next/server";

import { meetingDocumentData } from "@/lib/meeting-factory";
import { scheduleMeetingBot } from "@/lib/meeting-bot-scheduler";
import { meetingSeriesKey, validateMeetingInput } from "@/lib/meeting-validation";
import { connectToDatabase } from "@/lib/mongodb";
import { serializeMeeting } from "@/lib/serialize-meeting";
import { MeetingModel } from "@/models/Meeting";
import { MeetingSeriesModel } from "@/models/MeetingSeries";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  if (!Types.ObjectId.isValid(id)) {
    return NextResponse.json({ error: "Meeting series not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid appointment" }, { status: 400 });
  }

  try {
    await connectToDatabase();
    const series = await MeetingSeriesModel.findById(id).exec();
    if (!series) {
      return NextResponse.json({ error: "Meeting series not found" }, { status: 404 });
    }

    const appointmentCount = await MeetingModel.countDocuments({ seriesId: series._id });
    if (appointmentCount >= 24) {
      return NextResponse.json(
        { error: "A series cannot contain more than 24 appointments" },
        { status: 409 },
      );
    }

    const payload = body as Record<string, unknown>;
    const label = typeof payload.label === "string" ? payload.label.trim().slice(0, 120) : "";
    const result = validateMeetingInput({
      title: label ? `${series.title} · ${label}` : series.title,
      meetingUrl: payload.meetingUrl,
      scheduledStart: payload.scheduledStart,
      durationMinutes: payload.durationMinutes,
      timezone: series.timezone,
      objective: series.objective,
      seriesLabel: series.title,
      language: series.language,
      autoJoin: series.autoJoin,
      agenda: series.agenda || [],
      correctionPolicy: series.assistant?.correctionPolicy || "important_only",
    });
    if (!result.success) {
      return NextResponse.json(
        { error: "The appointment is invalid", issues: result.issues },
        { status: 400 },
      );
    }

    const duplicate = await MeetingModel.exists({
      seriesId: series._id,
      meetingUrl: result.data.meetingUrl,
      scheduledStart: new Date(result.data.scheduledStart),
    });
    if (duplicate) {
      return NextResponse.json(
        { error: "This meeting link and start time are already in the series" },
        { status: 409 },
      );
    }

    const meeting = await MeetingModel.create(
      meetingDocumentData(result.data, {
        seriesId: series._id,
        seriesLabel: series.title,
        seriesKey: meetingSeriesKey(series.title, series.title),
        assistantName: series.assistant?.wakeWord,
      }),
    );
    await scheduleMeetingBot(meeting);
    await MeetingSeriesModel.updateOne(
      { _id: series._id },
      { $set: { updatedAt: new Date() } },
    ).exec();
    return NextResponse.json({ meeting: serializeMeeting(meeting) }, { status: 201 });
  } catch (error) {
    console.error("Unable to add meeting appointment", error);
    return NextResponse.json(
      { error: "Unable to add meeting appointment" },
      { status: 500 },
    );
  }
}
