import { Types } from "mongoose";
import { NextResponse } from "next/server";

import { connectToDatabase } from "@/lib/mongodb";
import { serializeAudienceRoom } from "@/lib/serialize-audience-room";
import { serializeTalkRun } from "@/lib/serialize-talk-run";
import { isYouTubeAudienceConfigured } from "@/lib/youtube-live";
import { AudienceRoomModel } from "@/models/AudienceRoom";
import { TalkRunModel } from "@/models/TalkRun";
import type { AudienceCueMode, TalkRunAudienceCue } from "@/types/audience";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; messageId: string }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function PATCH(request: Request, context: RouteContext) {
  const { id, messageId } = await context.params;
  if (!Types.ObjectId.isValid(id)) {
    return NextResponse.json({ error: "Talk run not found" }, { status: 404 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }
  if (!isRecord(body) || typeof body.action !== "string") {
    return NextResponse.json({ error: "Invalid audience action" }, { status: 400 });
  }
  const actions = ["approve", "reject", "on_air", "host", "participant", "prompt"];
  if (!actions.includes(body.action)) {
    return NextResponse.json({ error: "Invalid audience action" }, { status: 400 });
  }
  const targetParticipantIndex = Number.isInteger(body.targetParticipantIndex)
    ? (body.targetParticipantIndex as number)
    : undefined;

  try {
    await connectToDatabase();
    const [room, run] = await Promise.all([
      AudienceRoomModel.findOne({ runId: id }).exec(),
      TalkRunModel.findById(id).exec(),
    ]);
    if (!room || !run) {
      return NextResponse.json(
        { error: room ? "Talk run not found" : "Audience room not found" },
        { status: 404 },
      );
    }
    const message = room.messages.find((candidate) => candidate.id === messageId);
    if (!message) {
      return NextResponse.json({ error: "Audience message not found" }, { status: 404 });
    }

    if (body.action === "approve") {
      if (message.status === "pending") message.status = "available";
      await room.save();
      return NextResponse.json({
        audience: serializeAudienceRoom(room, isYouTubeAudienceConfigured()),
        run: serializeTalkRun(run),
      });
    }
    if (body.action === "reject") {
      message.status = "rejected";
      message.selectedAt = new Date();
      await room.save();
      return NextResponse.json({
        audience: serializeAudienceRoom(room, isYouTubeAudienceConfigured()),
        run: serializeTalkRun(run),
      });
    }
    if (room.moderationEnabled && message.status === "pending") {
      return NextResponse.json(
        { error: "Approve this message before using it" },
        { status: 409 },
      );
    }
    if (["queued", "used", "rejected"].includes(message.status)) {
      return NextResponse.json(
        { error: "This audience message is no longer available" },
        { status: 409 },
      );
    }

    if (body.action === "on_air") {
      const now = new Date();
      message.status = "on_air";
      message.action = "on_air";
      message.selectedAt = now;
      message.onAirUntil = new Date(now.getTime() + 12_000);
      room.activeMessageId = message.id;
      await room.save();
      return NextResponse.json({
        audience: serializeAudienceRoom(room, isYouTubeAudienceConfigured()),
        run: serializeTalkRun(run),
      });
    }

    if (!["idle", "generating"].includes(run.status)) {
      return NextResponse.json(
        { error: "The audience cue cannot be queued in the current run state" },
        { status: 409 },
      );
    }
    if (run.audienceCue) {
      return NextResponse.json(
        { error: "Another audience message is already queued" },
        { status: 409 },
      );
    }
    const talk = run.talkSnapshot;
    if (!talk) {
      return NextResponse.json({ error: "Run configuration unavailable" }, { status: 409 });
    }
    if (body.action === "host" && talk.moderator.kind === "none") {
      return NextResponse.json(
        { error: "This episode has no host" },
        { status: 409 },
      );
    }
    if (
      targetParticipantIndex !== undefined &&
      (targetParticipantIndex < 0 ||
        targetParticipantIndex >= talk.participants.length ||
        talk.participants[targetParticipantIndex]?.kind === "unassigned")
    ) {
      return NextResponse.json({ error: "Invalid audience cue target" }, { status: 400 });
    }
    if (body.action === "participant" && targetParticipantIndex === undefined) {
      return NextResponse.json(
        { error: "Choose the guest who should answer" },
        { status: 400 },
      );
    }

    const cue: TalkRunAudienceCue = {
      provider: "youtube",
      messageId: message.id,
      authorName: message.authorName,
      authorImageUrl: message.authorImageUrl,
      content: message.content,
      mode: body.action as AudienceCueMode,
      targetParticipantIndex,
    };
    const queuedRun = await TalkRunModel.findOneAndUpdate(
      { _id: run._id, audienceCue: { $exists: false } },
      {
        $set: { audienceCue: cue },
        $unset: { preparedTurn: 1 },
      },
      { new: true },
    ).exec();
    if (!queuedRun) {
      return NextResponse.json(
        { error: "Another audience message is already queued" },
        { status: 409 },
      );
    }
    message.status = "queued";
    message.action = body.action as AudienceCueMode;
    message.targetParticipantIndex = targetParticipantIndex;
    message.selectedAt = new Date();
    await room.save();

    return NextResponse.json({
      audience: serializeAudienceRoom(room, isYouTubeAudienceConfigured()),
      run: serializeTalkRun(queuedRun),
    });
  } catch (error) {
    console.error("Unable to update audience message", error);
    return NextResponse.json(
      { error: "Unable to update the audience message" },
      { status: 500 },
    );
  }
}
