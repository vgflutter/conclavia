import { NextResponse } from "next/server";

import { DEFAULT_ASSISTANT_PROFILE, getAssistantProfile } from "@/lib/assistant-profile";
import { connectToDatabase } from "@/lib/mongodb";
import { AssistantProfileModel } from "@/models/AssistantProfile";
import { MeetingModel } from "@/models/Meeting";
import { MeetingSeriesModel } from "@/models/MeetingSeries";
import type {
  AssistantAttitude,
  AssistantResponseStyle,
  AssistantVoiceStyle,
} from "@/types/assistant-profile";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json({ profile: await getAssistantProfile() });
  } catch (error) {
    console.error("Unable to load avatar profile", error);
    return NextResponse.json({ error: "Unable to load avatar profile" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid avatar profile" }, { status: 400 });
  }

  const payload = body as Record<string, unknown>;
  const displayName = typeof payload.displayName === "string" ? payload.displayName.trim().slice(0, 80) : "";
  const role = typeof payload.role === "string" ? payload.role.trim().slice(0, 120) : "";
  const style = payload.voiceStyle as AssistantVoiceStyle;
  const responseStyle = payload.responseStyle as AssistantResponseStyle;
  const attitude = payload.attitude as AssistantAttitude;
  const speakingRate = Number(payload.speakingRate);

  if (
    !displayName ||
    !role ||
    !["executive_warm", "executive_clear"].includes(style) ||
    !["concise", "balanced", "detailed"].includes(responseStyle) ||
    !["discreet", "collaborative", "proactive"].includes(attitude)
  ) {
    return NextResponse.json({ error: "Name, role, personality and voice style are required" }, { status: 400 });
  }
  if (!Number.isFinite(speakingRate) || speakingRate < 0.8 || speakingRate > 1.1) {
    return NextResponse.json({ error: "Speaking rate must be between 0.8 and 1.1" }, { status: 400 });
  }

  try {
    await connectToDatabase();
    await AssistantProfileModel.findOneAndUpdate(
      { key: "default" },
      {
        ...DEFAULT_ASSISTANT_PROFILE,
        displayName,
        role,
        personality: { responseStyle, attitude },
        voice: { ...DEFAULT_ASSISTANT_PROFILE.voice, style, speakingRate },
      },
      { upsert: true, runValidators: true, setDefaultsOnInsert: true },
    ).exec();
    await Promise.all([
      MeetingModel.updateMany(
        { status: { $in: ["scheduled", "joining", "waiting_room", "live"] } },
        { $set: { "assistant.wakeWord": displayName } },
      ).exec(),
      MeetingSeriesModel.updateMany(
        {},
        { $set: { "assistant.wakeWord": displayName } },
      ).exec(),
    ]);
    return NextResponse.json({ profile: await getAssistantProfile() });
  } catch (error) {
    console.error("Unable to save avatar profile", error);
    return NextResponse.json({ error: "Unable to save avatar profile" }, { status: 500 });
  }
}
