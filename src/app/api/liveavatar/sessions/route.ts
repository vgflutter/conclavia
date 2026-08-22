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
  language?: unknown;
  pace?: unknown;
  seatIndex?: unknown;
  speakerType?: unknown;
  sex?: unknown;
  voiceId?: unknown;
  voiceDelivery?: unknown;
}

type VoiceDelivery = "natural" | "energetic" | "authoritative";

function normalizeDelivery(value: unknown): VoiceDelivery {
  return value === "energetic" || value === "authoritative"
    ? value
    : "natural";
}

function normalizeLanguage(value: unknown): "it" | "en" {
  if (typeof value !== "string") return "en";
  return value.trim().toLowerCase().startsWith("it") ? "it" : "en";
}

function voiceSettings(
  delivery: VoiceDelivery,
  pace: unknown,
  language: "it" | "en",
) {
  const paceAdjustment = pace === "fast" ? 0.03 : pace === "deep" ? -0.03 : 0;
  const italianProfile = {
    natural: { speed: 1.14, stability: 0.5, similarity: 0.84, style: 0.16 },
    energetic: { speed: 1.18, stability: 0.42, similarity: 0.82, style: 0.24 },
    authoritative: {
      speed: 1.09,
      stability: 0.59,
      similarity: 0.86,
      style: 0.12,
    },
  }[delivery];
  const englishProfile = {
    natural: { speed: 1.06, stability: 0.58, similarity: 0.84, style: 0.12 },
    energetic: { speed: 1.12, stability: 0.48, similarity: 0.82, style: 0.2 },
    authoritative: {
      speed: 1.03,
      stability: 0.64,
      similarity: 0.86,
      style: 0.1,
    },
  }[delivery];
  const profile = language === "it" ? italianProfile : englishProfile;

  return {
    provider: "elevenLabs",
    speed: Math.min(1.18, Math.max(0.98, profile.speed + paceAdjustment)),
    stability: profile.stability,
    similarity_boost: profile.similarity,
    style: profile.style,
    use_speaker_boost: true,
    model:
      language === "it" ? "eleven_multilingual_v2" : "eleven_flash_v2_5",
    apply_language_text_normalization: false,
  };
}

function customCastForRequest(
  body: SessionRequest,
  sex: "female" | "male",
  fallback: { id: string; voiceId: string },
): { id: string; voiceId: string } {
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
  if (!prefix) return fallback;

  const id = process.env[`${prefix}_AVATAR_ID`]?.trim() || fallback.id;
  const voiceId =
    process.env[`${prefix}_VOICE_ID`]?.trim() || fallback.voiceId;
  const configuredSex = process.env[`${prefix}_SEX`]?.trim().toLowerCase();
  const hasOverride = id !== fallback.id || voiceId !== fallback.voiceId;
  if (hasOverride && configuredSex !== sex) {
    throw new Error(`${prefix}_SEX must match the configured participant sex`);
  }
  return { id, voiceId };
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
  let cast: { id: string; voiceId: string };
  try {
    cast = customCastForRequest(body, sex, {
      id: requestedAvatar.id,
      voiceId: selectedVoiceId,
    });
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
        avatar_id: cast.id,
        avatar_persona: {
          voice_id: cast.voiceId,
          language,
          voice_settings: voiceSettings(delivery, body.pace, language),
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
      audioMode: "liveavatar_full",
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
