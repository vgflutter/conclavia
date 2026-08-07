import { findStudioVoice } from "@/lib/liveavatar-catalog";
import {
  LiveAvatarApiError,
  liveAvatarRequest,
} from "@/lib/liveavatar-server";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface VoicePreviewResponse {
  audio_base64: string;
}

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  if (!findStudioVoice(id)) {
    return Response.json({ error: "Voice not found" }, { status: 404 });
  }

  try {
    const preview = await liveAvatarRequest<VoicePreviewResponse>(
      `/v1/voices/${encodeURIComponent(id)}/preview`,
    );
    const audio = Buffer.from(preview.audio_base64, "base64");
    return new Response(new Uint8Array(audio), {
      headers: {
        "Cache-Control": "private, max-age=86400",
        "Content-Length": String(audio.byteLength),
        "Content-Type": "audio/mpeg",
      },
    });
  } catch (error) {
    const status = error instanceof LiveAvatarApiError ? error.status : 502;
    return Response.json(
      { error: "Unable to load the voice preview" },
      { status: status >= 400 && status < 600 ? status : 502 },
    );
  }
}
