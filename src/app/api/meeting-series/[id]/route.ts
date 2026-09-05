import { Types } from "mongoose";
import { NextResponse } from "next/server";

import { buildMeetingSeriesContinuity } from "@/lib/meeting-continuity";
import { cancelMeetingBot } from "@/lib/meeting-bot-scheduler";
import { meetingSeriesKey } from "@/lib/meeting-validation";
import { connectToDatabase } from "@/lib/mongodb";
import { serializeMeeting } from "@/lib/serialize-meeting";
import { serializeMeetingSeries } from "@/lib/serialize-meeting-series";
import { MeetingModel } from "@/models/Meeting";
import { MeetingSeriesModel } from "@/models/MeetingSeries";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  if (!Types.ObjectId.isValid(id)) {
    return NextResponse.json({ error: "Meeting series not found" }, { status: 404 });
  }

  try {
    await connectToDatabase();
    const series = await MeetingSeriesModel.findById(id).exec();
    if (!series) {
      return NextResponse.json({ error: "Meeting series not found" }, { status: 404 });
    }
    const meetings = await MeetingModel.find({ seriesId: series._id })
      .sort({ scheduledStart: 1 })
      .exec();
    const briefing = await buildMeetingSeriesContinuity(
      series._id.toString(),
      meetingSeriesKey(series.title, series.title),
    );
    return NextResponse.json({
      series: serializeMeetingSeries(series),
      meetings: meetings.map(serializeMeeting),
      briefing,
    });
  } catch (error) {
    console.error("Unable to load meeting series", error);
    return NextResponse.json(
      { error: "Unable to load meeting series" },
      { status: 500 },
    );
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  if (!Types.ObjectId.isValid(id)) {
    return NextResponse.json({ error: "Meeting series not found" }, { status: 404 });
  }

  try {
    await connectToDatabase();
    const series = await MeetingSeriesModel.findById(id).exec();
    if (!series) {
      return NextResponse.json({ error: "Meeting series not found" }, { status: 404 });
    }
    const activeMeeting = await MeetingModel.exists({
      seriesId: series._id,
      status: { $in: ["joining", "waiting_room", "live", "processing"] },
    });
    if (activeMeeting) {
      return NextResponse.json(
        { error: "Complete active meetings before deleting this series" },
        { status: 409 },
      );
    }
    const meetings = await MeetingModel.find({ seriesId: series._id }).exec();
    for (const meeting of meetings) {
      await cancelMeetingBot(meeting);
    }
    await MeetingModel.deleteMany({ seriesId: series._id });
    await series.deleteOne();
    return NextResponse.json({ deleted: true });
  } catch (error) {
    console.error("Unable to delete meeting series", error);
    return NextResponse.json(
      { error: "Unable to delete meeting series" },
      { status: 500 },
    );
  }
}
