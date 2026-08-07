import { Types } from "mongoose";
import { NextResponse } from "next/server";

import { connectToDatabase } from "@/lib/mongodb";
import { serializeAudienceRoom } from "@/lib/serialize-audience-room";
import {
  fetchYouTubeLiveMessages,
  isYouTubeAudienceConfigured,
  YouTubeLiveError,
} from "@/lib/youtube-live";
import { AudienceRoomModel } from "@/models/AudienceRoom";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  if (!Types.ObjectId.isValid(id)) {
    return NextResponse.json({ error: "Talk run not found" }, { status: 404 });
  }

  try {
    await connectToDatabase();
    const room = await AudienceRoomModel.findOne({ runId: id }).exec();
    if (!room) {
      return NextResponse.json({ error: "Audience room not found" }, { status: 404 });
    }
    if (!room.connected) {
      return NextResponse.json({
        audience: serializeAudienceRoom(room, isYouTubeAudienceConfigured()),
      });
    }

    const page = await fetchYouTubeLiveMessages(
      room.liveChatId,
      room.moderationEnabled,
      room.nextPageToken,
    );
    const existingIds = new Set(room.messages.map((message) => message.id));
    const freshMessages = page.messages.filter(
      (message) => !existingIds.has(message.id),
    );
    const update = await AudienceRoomModel.findByIdAndUpdate(
      room._id,
      {
        ...(freshMessages.length > 0
          ? { $push: { messages: { $each: freshMessages, $slice: -200 } } }
          : {}),
        $set: {
          connected: !page.ended,
          pollingIntervalMillis: page.pollingIntervalMillis,
          ...(page.nextPageToken ? { nextPageToken: page.nextPageToken } : {}),
        },
        $unset: { error: 1 },
      },
      { new: true },
    ).exec();
    if (!update) {
      return NextResponse.json({ error: "Audience room not found" }, { status: 404 });
    }
    return NextResponse.json({
      audience: serializeAudienceRoom(update, isYouTubeAudienceConfigured()),
    });
  } catch (error) {
    const status = error instanceof YouTubeLiveError ? error.status : 500;
    console.error("Unable to sync YouTube live audience", error);
    await AudienceRoomModel.updateOne(
      { runId: id },
      {
        $set: {
          error:
            error instanceof YouTubeLiveError
              ? error.message
              : "Unable to sync YouTube live chat",
        },
      },
    ).exec().catch(() => undefined);
    return NextResponse.json(
      {
        error:
          error instanceof YouTubeLiveError
            ? error.message
            : "Unable to sync YouTube live chat",
      },
      { status },
    );
  }
}
