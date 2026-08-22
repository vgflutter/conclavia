import { NextResponse } from "next/server";

import {
  getUnrealMachineStatus,
  getConfiguredUnrealStudioProfile,
  isUnrealAvatarId,
  startUnrealStudio,
  stopUnrealStudio,
} from "@/lib/unreal-studio";
import {
  isLocalUnrealLifecycleEnabled,
  startLocalUnrealInfrastructure,
} from "@/lib/unreal-local-lifecycle";

export const dynamic = "force-dynamic";
export const maxDuration = 900;

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      avatarId?: unknown;
    };
    const avatarId = isUnrealAvatarId(body.avatarId) ? body.avatarId : "aera";
    const profile = getConfiguredUnrealStudioProfile();
    let lifecycleRefreshed = false;
    if (isLocalUnrealLifecycleEnabled()) {
      const machine = await getUnrealMachineStatus();
      if (machine.state !== "running") {
        await startLocalUnrealInfrastructure();
        lifecycleRefreshed = true;
      }
    }
    // The UE 5.8 validation profile is intentionally pinned to one stable
    // 1080p MetaHuman and a real physical set. The server-side gate rejects a
    // stale engine, inactive commercial AnimBP route, vendor demo map or
    // duet/five-person revision before returning a player URL.
    let session: Awaited<ReturnType<typeof startUnrealStudio>>;
    try {
      session = await startUnrealStudio(profile, avatarId);
    } catch (error) {
      // A warm GPU normally switches avatar through the supervisor immediately.
      // If its network or watchdog state is stale, refresh the local lifecycle
      // once and retry instead of forcing every healthy avatar change through
      // the slower EC2/SSM bootstrap.
      if (!isLocalUnrealLifecycleEnabled() || lifecycleRefreshed) throw error;
      await startLocalUnrealInfrastructure();
      session = await startUnrealStudio(profile, avatarId);
    }
    return NextResponse.json({
      ok: true,
      playerUrl: session.playerUrl,
      health: session.health,
      audioEngine: "polly-generative",
      facialAnimation: "validation",
      avatarId,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Studio 3D non disponibile.",
      },
      { status: 503 },
    );
  }
}

export async function DELETE() {
  try {
    await stopUnrealStudio();
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Arresto Studio 3D non riuscito.",
      },
      { status: 502 },
    );
  }
}
