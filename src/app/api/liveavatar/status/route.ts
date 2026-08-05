import { NextResponse } from "next/server";

import {
  isLiveAvatarConfigured,
  isLiveAvatarProductionEnabled,
  liveAvatarMaxSessionSeconds,
  liveAvatarRequest,
} from "@/lib/liveavatar-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CreditResponse {
  credits_left?: number | string;
}

export async function GET() {
  const configured = isLiveAvatarConfigured();
  if (!configured) {
    return NextResponse.json({
      configured: false,
      productionEnabled: false,
      maxSessionSeconds: liveAvatarMaxSessionSeconds(),
    });
  }

  try {
    const credits = await liveAvatarRequest<CreditResponse>("/v1/users/credits");
    return NextResponse.json({
      configured: true,
      productionEnabled: isLiveAvatarProductionEnabled(),
      maxSessionSeconds: liveAvatarMaxSessionSeconds(),
      creditsLeft:
        credits.credits_left === undefined
          ? undefined
          : Number(credits.credits_left),
    });
  } catch (error) {
    console.error("Unable to read LiveAvatar status", error);
    return NextResponse.json(
      {
        configured: true,
        productionEnabled: isLiveAvatarProductionEnabled(),
        maxSessionSeconds: liveAvatarMaxSessionSeconds(),
        error: "Unable to read LiveAvatar status",
      },
      { status: 502 },
    );
  }
}
