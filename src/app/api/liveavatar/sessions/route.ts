import { NextResponse } from "next/server";

import { findStudioAvatar } from "@/lib/liveavatar-catalog";
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

interface SessionRequest {
  avatarId?: unknown;
  sex?: unknown;
  language?: unknown;
  pace?: unknown;
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
  const avatar = requestedAvatar;
  const maxSessionDuration = liveAvatarMaxSessionSeconds();
  const language = normalizeLanguage(body.language);
  const speed =
    body.pace === "fast" ? 1.04 : body.pace === "deep" ? 0.96 : 1;

  try {
    const session = await liveAvatarRequest<SessionTokenResponse>(
      "/v1/sessions/token",
      {
        method: "POST",
        body: JSON.stringify({
          mode: "FULL",
          avatar_id: avatar.id,
          avatar_persona: {
            voice_id: avatar.voiceId,
            language,
            voice_settings: {
              provider: "elevenLabs",
              speed,
              stability: 0.42,
              similarity_boost: 0.76,
              style: 0.2,
              use_speaker_boost: true,
              model: "eleven_flash_v2_5",
              apply_language_text_normalization: false,
            },
          },
          video_settings: {
            quality: "medium",
            encoding: "H264",
          },
          is_sandbox: false,
          max_session_duration: maxSessionDuration,
        }),
      },
    );

    return NextResponse.json({
      sessionId: session.session_id,
      sessionToken: session.session_token,
      maxSessionDuration,
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
