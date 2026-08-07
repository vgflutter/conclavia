import { NextResponse } from "next/server";

import {
  findStudioAvatar,
  findStudioVoice,
} from "@/lib/liveavatar-catalog";
import {
  isLiveAvatarProductionEnabled,
  LiveAvatarApiError,
  liveAvatarMaxSessionSeconds,
  liveAvatarRequest,
} from "@/lib/liveavatar-server";

export const runtime = "nodejs";

interface SessionTokenResponse {
  session_id: string;
  session_token: string;
}

type LiveAvatarVideoQuality = "high" | "very_high";

interface SessionRequest {
  avatarId?: unknown;
  seatIndex?: unknown;
  speakerType?: unknown;
  sex?: unknown;
  language?: unknown;
  pace?: unknown;
  voiceId?: unknown;
  voiceDelivery?: unknown;
}

type VoiceDelivery = "natural" | "energetic" | "authoritative";

function normalizeDelivery(value: unknown): VoiceDelivery {
  return value === "energetic" || value === "authoritative"
    ? value
    : "natural";
}

function voiceSettings(
  delivery: VoiceDelivery,
  pace: unknown,
) {
  const paceAdjustment = pace === "fast" ? 0.04 : pace === "deep" ? -0.03 : 0;
  const profile = {
    natural: { speed: 1.08, stability: 0.48, similarity: 0.78 },
    energetic: { speed: 1.14, stability: 0.38, similarity: 0.76 },
    authoritative: { speed: 1.04, stability: 0.58, similarity: 0.82 },
  }[delivery];

  return {
    provider: "elevenLabs",
    speed: Math.min(1.18, Math.max(0.95, profile.speed + paceAdjustment)),
    stability: profile.stability,
    similarity_boost: profile.similarity,
    style: 0,
    use_speaker_boost: false,
    model: "eleven_flash_v2_5",
  };
}

function customAvatarForRequest(
  body: SessionRequest,
  sex: "female" | "male",
  fallbackVoiceId: string,
): { id: string; voiceId: string } | undefined {
  const isModerator = body.speakerType === "moderator";
  const seatIndex =
    typeof body.seatIndex === "number" &&
    Number.isInteger(body.seatIndex) &&
    body.seatIndex >= 0 &&
    body.seatIndex < 5
      ? body.seatIndex
      : undefined;
  const prefix = isModerator
    ? "LIVEAVATAR_MODERATOR"
    : seatIndex !== undefined
      ? `LIVEAVATAR_SEAT_${seatIndex + 1}`
      : undefined;
  if (!prefix) return undefined;

  const id = process.env[`${prefix}_AVATAR_ID`]?.trim();
  if (!id) return undefined;
  const configuredSex = process.env[`${prefix}_SEX`]?.trim().toLowerCase();
  if (configuredSex !== sex) {
    throw new Error(`${prefix}_SEX must match the configured participant sex`);
  }
  return {
    id,
    voiceId:
      process.env[`${prefix}_VOICE_ID`]?.trim() || fallbackVoiceId,
  };
}

function normalizeLanguage(value: unknown): "it" | "en" {
  if (typeof value !== "string") return "en";
  return value.trim().toLowerCase().startsWith("it") ? "it" : "en";
}

export async function POST(request: Request) {
  let body: SessionRequest;
  try {
    body = (await request.json()) as SessionRequest;
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }

  const sex = body.sex === "female" || body.sex === "male" ? body.sex : undefined;
  if (!sex) {
    return NextResponse.json(
      { error: "Participant sex must be female or male" },
      { status: 400 },
    );
  }
  if (!isLiveAvatarProductionEnabled()) {
    return NextResponse.json(
      { error: "Production LiveAvatar sessions are disabled" },
      { status: 403 },
    );
  }

  const requestedAvatar =
    typeof body.avatarId === "string"
      ? findStudioAvatar(body.avatarId)
      : undefined;
  if (!requestedAvatar) {
    return NextResponse.json({ error: "Avatar not allowed" }, { status: 400 });
  }
  if (requestedAvatar.sex !== sex) {
    return NextResponse.json(
      { error: "Avatar does not match participant sex" },
      { status: 400 },
    );
  }
  const requestedVoice =
    typeof body.voiceId === "string" ? findStudioVoice(body.voiceId) : undefined;
  if (body.voiceId && (!requestedVoice || requestedVoice.sex !== sex)) {
    return NextResponse.json(
      { error: "Voice does not match participant sex" },
      { status: 400 },
    );
  }
  const selectedVoiceId = requestedVoice?.id ?? requestedAvatar.voiceId;
  let avatar: { id: string; voiceId: string } = requestedAvatar;
  try {
    avatar =
      customAvatarForRequest(body, sex, selectedVoiceId) ?? {
        id: requestedAvatar.id,
        voiceId: selectedVoiceId,
      };
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid custom avatar" },
      { status: 500 },
    );
  }
  const maxSessionDuration = liveAvatarMaxSessionSeconds();
  const language = normalizeLanguage(body.language);
  const delivery = normalizeDelivery(body.voiceDelivery);
  const configuredVideoQuality =
    process.env.LIVEAVATAR_VIDEO_QUALITY?.trim().toLowerCase();
  const allowQualityFallback = configuredVideoQuality !== "very_high";
  let videoQuality: LiveAvatarVideoQuality =
    configuredVideoQuality === "high" ? "high" : "very_high";

  const requestSession = (quality: LiveAvatarVideoQuality) =>
    liveAvatarRequest<SessionTokenResponse>("/v1/sessions/token", {
      method: "POST",
      body: JSON.stringify({
        mode: "FULL",
        avatar_id: avatar.id,
        avatar_persona: {
          voice_id: avatar.voiceId,
          language,
          voice_settings: voiceSettings(delivery, body.pace),
        },
        video_settings: {
          quality,
          encoding: "H264",
        },
        is_sandbox: false,
        max_session_duration: maxSessionDuration,
      }),
    });

  try {
    let session: SessionTokenResponse;
    try {
      session = await requestSession(videoQuality);
    } catch (error) {
      const planBlocks1080 =
        error instanceof LiveAvatarApiError &&
        error.status === 403 &&
        /1080p/iu.test(error.message);
      if (
        videoQuality !== "very_high" ||
        !allowQualityFallback ||
        !planBlocks1080
      ) {
        throw error;
      }
      videoQuality = "high";
      session = await requestSession(videoQuality);
    }

    return NextResponse.json({
      sessionId: session.session_id,
      sessionToken: session.session_token,
      maxSessionDuration,
      videoQuality,
    });
  } catch (error) {
    const status = error instanceof LiveAvatarApiError ? error.status : 502;
    console.error("Unable to create LiveAvatar session", error);
    return NextResponse.json(
      { error: "Unable to create the LiveAvatar session" },
      { status: status >= 400 && status < 600 ? status : 502 },
    );
  }
}
