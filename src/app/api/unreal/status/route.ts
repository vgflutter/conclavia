import { NextResponse } from "next/server";

import {
  getUnrealStudioConfig,
  getConfiguredUnrealStudioProfile,
  getUnrealStudioHealth,
  getUnrealMachineStatus,
  isGrade1HeroStudio,
  isUnreal58HeroStudio,
} from "@/lib/unreal-studio";

export const dynamic = "force-dynamic";

export async function GET() {
  const config = getUnrealStudioConfig();
  const profile = getConfiguredUnrealStudioProfile();
  const machine = await getUnrealMachineStatus();
  const shouldProbeRenderer =
    machine.state === "running" ||
    machine.state === "unknown" ||
    machine.state === "unconfigured";
  const health = shouldProbeRenderer
    ? await getUnrealStudioHealth()
    : { ok: false, running: false };
  const available = Boolean(
    health.ok &&
      health.stageReady &&
      health.commercialLipSyncReady &&
      (profile === "lipsync58"
        ? isUnreal58HeroStudio(health)
        : profile === "lipsync"
          ? isGrade1HeroStudio(health)
          : true),
  );
  const serverStatus =
    machine.state === "stopped" || machine.state === "terminated"
      ? "off"
      : machine.state === "pending"
        ? "booting"
        : machine.state === "stopping" || machine.state === "shutting-down"
          ? "stopping"
          : available
            ? "ready"
            : machine.state === "running"
              ? "online"
              : machine.state === "unknown"
                ? "error"
                : "unknown";
  return NextResponse.json({
    configured: Boolean(config.playerUrl && config.controlUrl),
    canStart: Boolean(config.supervisorUrl),
    available,
    serverStatus,
    machine,
    playerUrl: health.ok ? config.playerUrl : undefined,
    health,
    facialAnimation: "validation",
    audioEngine: "polly-generative",
  });
}
