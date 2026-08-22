import {
  PollyClient,
  SynthesizeSpeechCommand,
  type VoiceId,
} from "@aws-sdk/client-polly";
import { NextResponse } from "next/server";

import {
  getUnrealVoiceLanguage,
  isUnrealVoice,
  type UnrealSpeechLanguage,
} from "@/lib/unreal-voices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const polly = new PollyClient({
  region: process.env.AWS_REGION?.trim() || "eu-central-1",
  maxAttempts: 3,
});
interface SpeechRequest {
  text?: unknown;
  voice?: unknown;
  languageCode?: unknown;
  direction?: unknown;
}

function cleanText(value: unknown): string {
  return typeof value === "string"
    ? value.replace(/[*_#]/gu, "").replace(/\s+/gu, " ").trim()
    : "";
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as SpeechRequest;
  const text = cleanText(body.text);
  const voice = isUnrealVoice(body.voice)
    ? body.voice
    : "Bianca";
  const voiceLanguage = getUnrealVoiceLanguage(voice);
  if (
    body.languageCode !== undefined
    && body.languageCode !== "it-IT"
    && body.languageCode !== "en-US"
  ) {
    return NextResponse.json({ error: "Unsupported speech language" }, { status: 400 });
  }
  const languageCode: UnrealSpeechLanguage = voiceLanguage;
  if (body.languageCode !== undefined && body.languageCode !== languageCode) {
    return NextResponse.json(
      { error: `Voice ${voice} does not support ${String(body.languageCode)}` },
      { status: 400 },
    );
  }
  const direction = cleanText(body.direction);

  if (!text || text.length > 3_000) {
    return NextResponse.json({ error: "Invalid speech text" }, { status: 400 });
  }

  const rate = direction.includes("vivace")
    ? "114%"
    : direction.includes("autorevole")
      ? "110%"
      : "112%";
  const spokenText = `<speak><prosody rate="${rate}">${escapeSsml(text)}</prosody></speak>`;

  try {
    const output = await polly.send(
      new SynthesizeSpeechCommand({
        Engine: "generative",
        VoiceId: voice as VoiceId,
        LanguageCode: languageCode,
        OutputFormat: "pcm",
        SampleRate: "16000",
        TextType: "ssml",
        Text: spokenText,
      }),
    );
    if (!output.AudioStream) throw new Error("Polly returned no audio");
    const audio = await output.AudioStream.transformToByteArray();
    const responseBody = Uint8Array.from(audio).buffer;
    return new Response(responseBody, {
      headers: {
        "Content-Type": "audio/L16;rate=16000;channels=1",
        "Content-Length": String(audio.byteLength),
        "Cache-Control": "no-store",
        "X-Conclavia-Voice": voice,
        "X-Conclavia-Language": languageCode,
      },
    });
  } catch (error) {
    console.error("Unable to synthesize Unreal speech", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Speech synthesis failed" },
      { status: 502 },
    );
  }
}

function escapeSsml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
