import { NextResponse } from "next/server";

import {
  localVoiceConfiguration,
  meetingAssistantConfiguration,
  meetingDocumentData,
} from "@/lib/meeting-factory";
import { getAssistantProfile } from "@/lib/assistant-profile";
import { scheduleMeetingBot } from "@/lib/meeting-bot-scheduler";
import { validateMeetingSeriesInput } from "@/lib/meeting-series-validation";
import { meetingSeriesKey } from "@/lib/meeting-validation";
import { connectToDatabase } from "@/lib/mongodb";
import { serializeMeeting } from "@/lib/serialize-meeting";
import { serializeMeetingSeries } from "@/lib/serialize-meeting-series";
import { MeetingModel } from "@/models/Meeting";
import {
  MeetingSeriesModel,
  type MeetingSeriesDocument,
} from "@/models/MeetingSeries";

export const runtime = "nodejs";

export async function GET() {
  try {
    await connectToDatabase();
    const series = await MeetingSeriesModel.find().sort({ updatedAt: -1 }).exec();
    return NextResponse.json({ series: series.map(serializeMeetingSeries) });
  } catch (error) {
    console.error("Unable to list meeting series", error);
    return NextResponse.json(
      { error: "Unable to load meeting series" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const result = validateMeetingSeriesInput(body);
  if (!result.success) {
    return NextResponse.json(
      { error: "The meeting series is invalid", issues: result.issues },
      { status: 400 },
    );
  }

  const input = result.data;
  let series: MeetingSeriesDocument | undefined;

  try {
    await connectToDatabase();
    const profile = await getAssistantProfile();
    const createdSeries = await MeetingSeriesModel.create({
      title: input.title,
      objective: input.objective,
      timezone: input.timezone,
      language: input.language,
      autoJoin: input.autoJoin,
      agenda: input.agenda,
      assistant: meetingAssistantConfiguration(
        input.correctionPolicy,
        profile.displayName,
      ),
      voice: localVoiceConfiguration(),
    });
    series = createdSeries;

    const key = meetingSeriesKey(input.title, input.title);
    const meetingDocuments = input.appointments.map((appointment) =>
      meetingDocumentData(
        {
          title: appointment.label
            ? `${input.title} · ${appointment.label}`.slice(0, 160)
            : input.title,
          meetingUrl: appointment.meetingUrl,
          scheduledStart: appointment.scheduledStart,
          durationMinutes: appointment.durationMinutes,
          timezone: input.timezone,
          objective: input.objective,
          seriesLabel: input.title,
          language: input.language,
          autoJoin: input.autoJoin,
          agenda: input.agenda,
          correctionPolicy: input.correctionPolicy,
        },
        {
          seriesId: createdSeries._id,
          seriesLabel: input.title,
          seriesKey: key,
          assistantName: profile.displayName,
        },
      ),
    );
    const meetings = await MeetingModel.insertMany(meetingDocuments);
    for (const meeting of meetings) {
      await scheduleMeetingBot(meeting);
    }

    return NextResponse.json(
      {
        series: serializeMeetingSeries(createdSeries),
        meetings: meetings.map(serializeMeeting),
      },
      { status: 201 },
    );
  } catch (error) {
    if (series) {
      await MeetingModel.deleteMany({ seriesId: series._id }).catch(() => undefined);
      await series.deleteOne().catch(() => undefined);
    }
    console.error("Unable to create meeting series", error);
    return NextResponse.json(
      { error: "Unable to save meeting series" },
      { status: 500 },
    );
  }
}
