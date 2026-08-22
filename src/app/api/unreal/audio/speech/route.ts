import { NextResponse } from "next/server";

import { playUnrealSpeech } from "@/lib/unreal-studio";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const type = request.headers.get("content-type")?.split(";", 1)[0];
  if (type !== "application/octet-stream") {
    return NextResponse.json({ error: "PCM16 body required" }, { status: 415 });
  }
  const pcm = await request.arrayBuffer();
  if (
    pcm.byteLength === 0 ||
    pcm.byteLength > 4 * 1024 * 1024 ||
    pcm.byteLength % 2 !== 0
  ) {
    return NextResponse.json({ error: "Invalid PCM16 speech" }, { status: 400 });
  }
  try {
    return NextResponse.json(await playUnrealSpeech(pcm));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Speech bridge failed" },
      { status: 502 },
    );
  }
}
