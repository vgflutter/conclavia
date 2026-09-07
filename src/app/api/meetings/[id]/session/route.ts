import { Types } from "mongoose";
import { NextResponse } from "next/server";

import { getMeetingBotAdapter } from "@/lib/meeting-bot-adapter";
import { getMeetingBotRuntimeConfig } from "@/lib/meeting-bot-config";
import { scheduleMeetingBot } from "@/lib/meeting-bot-scheduler";
import { connectToDatabase } from "@/lib/mongodb";
import { serializeMeeting } from "@/lib/serialize-meeting";
import { MeetingModel } from "@/models/Meeting";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  if (!Types.ObjectId.isValid(id)) {
    return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const action =
    body && typeof body === "object" && "action" in body
      ? (body as { action?: unknown }).action
      : undefined;
  if (action !== "join" && action !== "schedule" && action !== "leave") {
    return NextResponse.json(
      { error: "Action must be join, schedule or leave" },
      { status: 400 },
    );
  }

  try {
    await connectToDatabase();
    const meeting = await MeetingModel.findById(id).exec();
    if (!meeting) {
      return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
    }

    const adapter = getMeetingBotAdapter(
      action === "leave" ? meeting.bot.provider : undefined,
    );
    if (action === "schedule") {
      if (!meeting.autoJoin || !["scheduled", "failed"].includes(meeting.status)) {
        return NextResponse.json(
          { error: "Automatic entry cannot be scheduled from the current state" },
          { status: 409 },
        );
      }
      await scheduleMeetingBot(meeting);
    } else if (action === "join") {
      if (!["scheduled", "failed"].includes(meeting.status)) {
        return NextResponse.json(
          { error: "This meeting cannot be joined from its current state" },
          { status: 409 },
        );
      }

      const activeColleague = await MeetingModel.exists({
        _id: { $ne: meeting._id },
        meetingUrl: meeting.meetingUrl,
        "bot.status": { $in: ["scheduling", "joining", "waiting_room", "joined"] },
      });
      if (activeColleague) {
        return NextResponse.json(
          { error: "Il collega digitale è già stato inviato a questo meeting." },
          { status: 409 },
        );
      }

      const session = await adapter.join(
        serializeMeeting(meeting),
        new URL(request.url).origin,
      );
      const config = getMeetingBotRuntimeConfig();
      meeting.status = adapter.live ? "joining" : "live";
      meeting.bot.provider = session.provider;
      meeting.bot.accessMode = config.accessMode;
      meeting.bot.status = adapter.live ? "joining" : "joined";
      meeting.bot.externalBotId = session.externalBotId;
      meeting.bot.accountEmail = adapter.live ? config.accountEmail : undefined;
      meeting.bot.outputUrl = session.outputUrl;
      meeting.bot.joinedAt = adapter.live ? undefined : session.joinedAt;
      meeting.bot.leftAt = undefined;
      meeting.bot.providerStatusCode = adapter.live ? "joining" : "preview";
      meeting.bot.lastStatusAt = new Date();
      meeting.bot.lastError = undefined;
      await meeting.save();
    } else {
      if (
        !meeting.bot.externalBotId ||
        !["joining", "waiting_room", "joined"].includes(meeting.bot.status)
      ) {
        return NextResponse.json(
          { error: "The colleague is not currently in this meeting" },
          { status: 409 },
        );
      }

      const result = await adapter.leave(meeting.bot.externalBotId);
      meeting.status = "processing";
      meeting.bot.status = "left";
      meeting.bot.leftAt = result.leftAt;
      await meeting.save();
    }

    return NextResponse.json({ meeting: serializeMeeting(meeting) });
  } catch (error) {
    console.error("Unable to update meeting session", error);
    return NextResponse.json(
      { error: "Unable to update meeting session" },
      { status: 500 },
    );
  }
}
