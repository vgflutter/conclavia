import { NextResponse } from "next/server";

import { sendUnrealPcm } from "@/lib/unreal-studio";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const type = request.headers.get("content-type")?.split(";", 1)[0];
  if (type !== "application/octet-stream") {
    return NextResponse.json({ error: "PCM body required" }, { status: 415 });
  }
  const pcm = await request.arrayBuffer();
  if (pcm.byteLength === 0 || pcm.byteLength > 384_000 || pcm.byteLength % 4 !== 0) {
    return NextResponse.json({ error: "Invalid PCM chunk" }, { status: 400 });
  }
  try {
    await sendUnrealPcm(pcm);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "PCM bridge failed" },
      { status: 502 },
    );
  }
}
