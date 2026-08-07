import { Types } from "mongoose";
import { NextResponse } from "next/server";

import { connectToDatabase } from "@/lib/mongodb";
import {
  emptyAudienceRoom,
  serializeAudienceRoom,
} from "@/lib/serialize-audience-room";
import {
  extractYouTubeVideoId,
  fetchYouTubeLiveMessages,
  isYouTubeAudienceConfigured,
  resolveYouTubeLiveVideo,
  YouTubeLiveError,
} from "@/lib/youtube-live";
import { AudienceRoomModel } from "@/models/AudienceRoom";
import { TalkRunModel } from "@/models/TalkRun";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  if (!Types.ObjectId.isValid(id)) {
    return NextResponse.json({ error: "Talk run not found" }, { status: 404 });
  }

  try {
    await connectToDatabase();
    const room = await AudienceRoomModel.findOne({ runId: id }).exec();
    return NextResponse.json({
      audience: room
        ? serializeAudienceRoom(room, isYouTubeAudienceConfigured())
        : emptyAudienceRoom(isYouTubeAudienceConfigured()),
    });
  } catch (error) {
    console.error("Unable to load audience room", error);
    return NextResponse.json(
      { error: "Unable to load the audience room" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  if (!Types.ObjectId.isValid(id)) {
    return NextResponse.json({ error: "Talk run not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }
  if (!isRecord(body) || typeof body.source !== "string") {
    return NextResponse.json(
      { error: "A YouTube live URL or video ID is required" },
      { status: 400 },
    );
  }
  const videoId = extractYouTubeVideoId(body.source);
  if (!videoId) {
    return NextResponse.json(
      { error: "Invalid YouTube live URL or video ID" },
      { status: 400 },
    );
  }
  const moderationEnabled = body.moderationEnabled === true;

  try {
    await connectToDatabase();
    const runExists = await TalkRunModel.exists({ _id: id });
    if (!runExists) {
      return NextResponse.json({ error: "Talk run not found" }, { status: 404 });
    }

    const live = await resolveYouTubeLiveVideo(videoId);
    const firstPage = await fetchYouTubeLiveMessages(
      live.liveChatId,
      moderationEnabled,
    );
    const room = await AudienceRoomModel.findOneAndUpdate(
      { runId: id },
      {
        $set: {
          provider: "youtube",
          videoId: live.videoId,
          videoTitle: live.videoTitle,
          liveChatId: live.liveChatId,
          connected: !firstPage.ended,
          moderationEnabled,
          nextPageToken: firstPage.nextPageToken,
          pollingIntervalMillis: firstPage.pollingIntervalMillis,
          messages: firstPage.messages.slice(-200),
        },
        $unset: { activeMessageId: 1, error: 1 },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    ).exec();
    return NextResponse.json({
      audience: serializeAudienceRoom(room, true),
    });
  } catch (error) {
    const status = error instanceof YouTubeLiveError ? error.status : 500;
    console.error("Unable to connect YouTube live audience", error);
    return NextResponse.json(
      {
        error:
          error instanceof YouTubeLiveError
            ? error.message
            : "Unable to connect the YouTube live audience",
      },
      { status },
    );
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  if (!Types.ObjectId.isValid(id)) {
    return NextResponse.json({ error: "Talk run not found" }, { status: 404 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }
  if (!isRecord(body) || typeof body.moderationEnabled !== "boolean") {
    return NextResponse.json({ error: "Invalid moderation setting" }, { status: 400 });
  }

  try {
    await connectToDatabase();
    const room = await AudienceRoomModel.findOne({ runId: id }).exec();
    if (!room) {
      return NextResponse.json({ error: "Audience room not found" }, { status: 404 });
    }
    room.moderationEnabled = body.moderationEnabled;
    for (const message of room.messages) {
      if (!body.moderationEnabled && message.status === "pending") {
        message.status = "available";
      } else if (body.moderationEnabled && message.status === "available") {
        message.status = "pending";
      }
    }
    await room.save();
    return NextResponse.json({
      audience: serializeAudienceRoom(room, isYouTubeAudienceConfigured()),
    });
  } catch (error) {
    console.error("Unable to update audience room", error);
    return NextResponse.json(
      { error: "Unable to update the audience room" },
      { status: 500 },
    );
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  if (!Types.ObjectId.isValid(id)) {
    return NextResponse.json({ error: "Talk run not found" }, { status: 404 });
  }
  try {
    await connectToDatabase();
    const room = await AudienceRoomModel.findOneAndUpdate(
      { runId: id },
      {
        $set: { connected: false },
        $unset: { activeMessageId: 1, error: 1 },
      },
      { new: true },
    ).exec();
    return NextResponse.json({
      audience: room
        ? serializeAudienceRoom(room, isYouTubeAudienceConfigured())
        : emptyAudienceRoom(isYouTubeAudienceConfigured()),
    });
  } catch (error) {
    console.error("Unable to disconnect audience room", error);
    return NextResponse.json(
      { error: "Unable to disconnect the audience room" },
      { status: 500 },
    );
  }
}
