import "server-only";

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DescribeInstancesCommand, EC2Client } from "@aws-sdk/client-ec2";

import type { UnrealPerformanceBeat } from "@/lib/unreal-performance-plan";

export type UnrealStudioProfile = "pop" | "serious" | "lipsync" | "lipsync58";
export const UNREAL_AVATAR_IDS = ["aera", "ada", "vivian", "jelena"] as const;
export type UnrealAvatarId = (typeof UNREAL_AVATAR_IDS)[number];

export function isUnrealAvatarId(value: unknown): value is UnrealAvatarId {
  return typeof value === "string"
    && (UNREAL_AVATAR_IDS as readonly string[]).includes(value);
}

export interface UnrealStudioHealth {
  ok: boolean;
  service?: string;
  runtimeRevision?: string;
  engineVersion?: string;
  profile?: UnrealStudioProfile;
  avatarId?: UnrealAvatarId;
  stageReady?: boolean;
  grade1SetReady?: boolean;
  grade1PropCount?: number;
  cameraCount?: number;
  cameraPackage?: string;
  castCount?: number;
  activeCamera?: string;
  lastCueAt?: string;
  running?: boolean;
  audioSubjectReady?: boolean;
  audioSubjectValid?: boolean;
  faceDrivenByLiveLink?: boolean;
  commercialLipSyncReady?: boolean;
  commercialModelReady?: boolean;
  commercialModelRouteReady?: boolean;
  commercialGeneratorBound?: boolean;
  commercialGeneratorCount?: number;
  commercialControlsBound?: boolean;
  commercialSpeechActive?: boolean;
  commercialControlCount?: number;
  commercialMood?: string;
  commercialMoodIntensity?: number;
  commercialModel?: string;
  commercialLookaheadMs?: number;
  commercialMaxControl?: number;
  commercialMaxMouthControl?: number;
  commercialMaxMouthControlName?: string;
  commercialMaxUpperFaceControl?: number;
  commercialMaxUpperFaceControlName?: string;
  commercialSpeechPeakMouthControl?: number;
  commercialSpeechPeakMouthControlName?: string;
  commercialSpeechPeakUpperFaceControl?: number;
  commercialSpeechPeakUpperFaceControlName?: string;
  commercialLastSpeechPeakMouthControl?: number;
  commercialLastSpeechPeakMouthControlName?: string;
  commercialLastSpeechPeakUpperFaceControl?: number;
  commercialLastSpeechPeakUpperFaceControlName?: string;
  commercialLastSpeechSolverChunks?: number;
  commercialLastSpeechSolverCursor?: number;
  commercialCompletedSpeechCount?: number;
  cameraCueCount?: number;
  speakerHandoffCount?: number;
  commercialSolverChunksSubmitted?: number;
  commercialSolverCursor?: number;
  bodyAnimationMode?: number;
  bodyAnimClass?: string;
  bodyAnimInstance?: string;
  pcmBytesReceived?: number;
  activeFaceIndex?: number;
  performancePlanReady?: boolean;
  performanceBeatCount?: number;
  performanceSolverBeatIndex?: number;
  performanceAudibleBeatIndex?: number;
  performanceMood?: string;
  performanceTargetIntensity?: number;
  performanceFocus?: string;
  performanceGesture?: string;
  performanceAppliedBeatCount?: number;
  facialLifeLayer?: boolean;
  commercialUpperFaceOwner?: boolean;
  bodyGesture?: "none" | "raise-hand" | "lower-hand";
  bodyGestureAlpha?: number;
  bodyGesturePhase?: "idle" | "raising" | "held" | "lowering";
  physicalGestureReady?: boolean;
  physicalGestureDriver?: string;
  bodyIdleDriver?: string;
  bodyIdlePlayRate?: number;
  listeningReactionActive?: boolean;
  listeningModelReady?: boolean;
  listeningSolverChunks?: number;
  naturalGazeEnabled?: boolean;
  naturalGazeDriver?: string;
}

export interface UnrealDirectorCue {
  speakerId: string;
  targetId?: string;
  speakerName: string;
  targetName?: string;
  shot:
    | "wide"
    | "close-up"
    | "two-shot"
    | "profile"
    | "push-in"
    | "three-quarter-left"
    | "three-quarter-right"
    | "profile-left"
    | "profile-right"
    | "reaction";
  intent: string;
  bodyGesture?: "none" | "raise-hand" | "lower-hand";
  listenerMood?: UnrealPerformanceBeat["mood"];
  listenerMoodIntensity?: number;
  expectedDurationMs: number;
  performanceBeats?: UnrealPerformanceBeat[];
}

interface UnrealStudioConfig {
  playerUrl?: string;
  controlUrl?: string;
  supervisorUrl?: string;
  token?: string;
  instanceId?: string;
  awsRegion: string;
}

export type UnrealMachineState =
  | "pending"
  | "running"
  | "stopping"
  | "stopped"
  | "shutting-down"
  | "terminated"
  | "unknown"
  | "unconfigured";

export interface UnrealMachineStatus {
  configured: boolean;
  state: UnrealMachineState;
  checkedAt: string;
}

const machineStatusCache = new Map<
  string,
  { expiresAt: number; value: UnrealMachineStatus }
>();

export function isGrade1HeroStudio(health: UnrealStudioHealth): boolean {
  return Boolean(
    health.runtimeRevision?.includes("grade1-hero-56-v") &&
      health.grade1SetReady === true &&
      (health.grade1PropCount ?? 0) >= 16 &&
      health.castCount === 1 &&
      health.cameraCount === 3,
  );
}

export function isUnreal58HeroStudio(health: UnrealStudioHealth): boolean {
  return Boolean(
    health.runtimeRevision?.includes("ue58-commercial-lipsync-v") &&
      health.profile === "lipsync58" &&
      health.stageReady === true &&
      health.castCount === 1 &&
      (health.cameraCount ?? 0) >= 9 &&
      health.commercialModelRouteReady === true &&
      health.commercialLipSyncReady === true,
  );
}

export function getConfiguredUnrealStudioProfile(): UnrealStudioProfile {
  const runtime = localRuntimeEnvironment();
  const configured =
    runtime.UNREAL_STUDIO_PROFILE?.trim() ||
    process.env.UNREAL_STUDIO_PROFILE?.trim();
  switch (configured) {
    case "pop":
    case "serious":
    case "lipsync":
    case "lipsync58":
      return configured;
    default:
      return "lipsync58";
  }
}

function configuredUrl(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return url.toString().replace(/\/$/u, "");
  } catch {
    return undefined;
  }
}

function localRuntimeEnvironment(): Record<string, string> {
  try {
    return Object.fromEntries(
      readFileSync(resolve(process.cwd(), ".env.local"), "utf8")
        .split(/\r?\n/u)
        .filter((line) => line.trim() && !line.trimStart().startsWith("#"))
        .flatMap((line) => {
          const separator = line.indexOf("=");
          if (separator < 1) return [];
          const key = line.slice(0, separator).trim();
          const raw = line.slice(separator + 1).trim();
          const value = raw.replace(/^(['"])(.*)\1$/u, "$2");
          return [[key, value]];
        }),
    );
  } catch {
    return {};
  }
}

export function getUnrealStudioConfig(): UnrealStudioConfig {
  // The local lifecycle script refreshes the public IP and supervisor token
  // after every EC2 start. Next loads process.env only at boot, so prefer the
  // current server-only .env.local values instead of forcing an app restart.
  const runtime = localRuntimeEnvironment();
  const value = (key: string): string | undefined =>
    runtime[key]?.trim() || process.env[key]?.trim() || undefined;
  return {
    playerUrl: configuredUrl(value("UNREAL_STUDIO_PLAYER_URL")),
    controlUrl: configuredUrl(value("UNREAL_STUDIO_CONTROL_URL")),
    supervisorUrl: configuredUrl(value("UNREAL_STUDIO_SUPERVISOR_URL")),
    token: value("UNREAL_STUDIO_TOKEN"),
    instanceId: value("UNREAL_STUDIO_INSTANCE_ID"),
    awsRegion:
      value("UNREAL_STUDIO_AWS_REGION") ||
      value("AWS_REGION") ||
      "eu-central-1",
  };
}

function machineState(value: string | undefined): UnrealMachineState {
  switch (value) {
    case "pending":
    case "running":
    case "stopping":
    case "stopped":
    case "shutting-down":
    case "terminated":
      return value;
    default:
      return "unknown";
  }
}

export async function getUnrealMachineStatus(): Promise<UnrealMachineStatus> {
  const { instanceId, awsRegion } = getUnrealStudioConfig();
  const checkedAt = new Date().toISOString();
  if (!instanceId) {
    return { configured: false, state: "unconfigured", checkedAt };
  }

  const cacheKey = `${awsRegion}:${instanceId}`;
  const cached = machineStatusCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  let value: UnrealMachineStatus;
  try {
    const client = new EC2Client({ region: awsRegion });
    const result = await client.send(
      new DescribeInstancesCommand({ InstanceIds: [instanceId] }),
    );
    value = {
      configured: true,
      state: machineState(
        result.Reservations?.[0]?.Instances?.[0]?.State?.Name,
      ),
      checkedAt,
    };
    client.destroy();
  } catch {
    value = { configured: true, state: "unknown", checkedAt };
  }

  machineStatusCache.set(cacheKey, {
    expiresAt: Date.now() + 5_000,
    value,
  });
  return value;
}

function headers(config: UnrealStudioConfig, withBody = false): HeadersInit {
  return {
    ...(withBody ? { "Content-Type": "application/json" } : {}),
    ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}),
  };
}

async function jsonRequest<T>(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<T> {
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  const payload = (await response.json().catch(() => ({}))) as T & {
    error?: string;
  };
  if (!response.ok) {
    throw new Error(payload.error || `Studio 3D returned HTTP ${response.status}`);
  }
  return payload;
}

export async function getUnrealStudioHealth(): Promise<UnrealStudioHealth> {
  const config = getUnrealStudioConfig();
  if (!config.controlUrl) {
    return { ok: false, running: false };
  }
  try {
    return await jsonRequest<UnrealStudioHealth>(
      `${config.controlUrl}/health`,
      { headers: headers(config) },
      4_000,
    );
  } catch {
    if (!config.supervisorUrl) return { ok: false, running: false };
    try {
      const health = await jsonRequest<UnrealStudioHealth>(
        `${config.supervisorUrl}/health`,
        { headers: headers(config) },
        4_000,
      );
      return { ...health, ok: false, stageReady: false };
    } catch {
      return { ok: false, running: false };
    }
  }
}

async function waitForStudioReady(
  profile: UnrealStudioProfile,
  avatarId: UnrealAvatarId,
  timeoutMs = 300_000,
): Promise<UnrealStudioHealth> {
  const deadline = Date.now() + timeoutMs;
  let latest: UnrealStudioHealth = { ok: false, running: false };
  while (Date.now() < deadline) {
    latest = await getUnrealStudioHealth();
    if (
      latest.ok &&
      latest.stageReady &&
      latest.avatarId === avatarId &&
      (profile === "lipsync"
        ? isGrade1HeroStudio(latest)
        : profile === "lipsync58"
          ? isUnreal58HeroStudio(latest)
          : true)
    ) {
      return latest;
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error(
    latest.running
      ? (profile === "lipsync" || profile === "lipsync58") &&
        !latest.commercialLipSyncReady
        ? "Studio 3D avviato, ma il volto MetaHuman commerciale non è pronto."
        : "Studio 3D avviato, ma il set non è diventato pronto in tempo."
      : "Studio 3D non raggiungibile. Verifica host Unreal e Pixel Streaming.",
  );
}

export async function startUnrealStudio(
  profile: UnrealStudioProfile,
  avatarId: UnrealAvatarId = "aera",
): Promise<{ health: UnrealStudioHealth; playerUrl: string }> {
  const config = getUnrealStudioConfig();
  if (!config.playerUrl || !config.controlUrl) {
    throw new Error(
      "Studio 3D non configurato: servono UNREAL_STUDIO_PLAYER_URL e UNREAL_STUDIO_CONTROL_URL.",
    );
  }

  const current = await getUnrealStudioHealth();
  if (
    !current.ok ||
    !current.stageReady ||
    current.profile !== profile ||
    current.avatarId !== avatarId ||
    (profile === "lipsync" && !isGrade1HeroStudio(current)) ||
    (profile === "lipsync58" && !isUnreal58HeroStudio(current))
  ) {
    if (!config.supervisorUrl) {
      throw new Error(
        "Il renderer Unreal è offline e UNREAL_STUDIO_SUPERVISOR_URL non è configurato.",
      );
    }
    await jsonRequest(
      `${config.supervisorUrl}/start`,
      {
        method: "POST",
        headers: headers(config, true),
        body: JSON.stringify({ profile, avatarId }),
      },
      20_000,
    );
  }

  return {
    health: await waitForStudioReady(profile, avatarId),
    playerUrl: config.playerUrl,
  };
}

export async function stopUnrealStudio(): Promise<void> {
  const config = getUnrealStudioConfig();
  if (!config.supervisorUrl) return;
  await jsonRequest(
    `${config.supervisorUrl}/stop`,
    { method: "POST", headers: headers(config, true), body: "{}" },
    15_000,
  );
}

export async function sendUnrealDirectorCue(
  cue: UnrealDirectorCue,
): Promise<void> {
  const config = getUnrealStudioConfig();
  if (!config.controlUrl) throw new Error("Studio 3D control plane non configurato.");
  await jsonRequest(
    `${config.controlUrl}/director/cue`,
    {
      method: "POST",
      headers: headers(config, true),
      body: JSON.stringify(cue),
    },
    6_000,
  );
}

export async function sendUnrealPcm(pcm: ArrayBuffer): Promise<void> {
  const config = getUnrealStudioConfig();
  if (!config.supervisorUrl) {
    throw new Error("Bridge audio Studio 3D non configurato.");
  }
  const response = await fetch(`${config.supervisorUrl}/audio/pcm`, {
    method: "POST",
    headers: {
      ...headers(config),
      "Content-Type": "application/octet-stream",
    },
    body: pcm,
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) {
    throw new Error(`Bridge audio Studio 3D returned HTTP ${response.status}`);
  }
}

export async function playUnrealSpeech(
  pcm16: ArrayBuffer,
): Promise<{ durationMs: number }> {
  const config = getUnrealStudioConfig();
  if (!config.supervisorUrl) {
    throw new Error("Riproduzione voce Studio 3D non configurata.");
  }
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const response = await fetch(`${config.supervisorUrl}/audio/speech`, {
      method: "POST",
      headers: {
        ...headers(config),
        "Content-Type": "application/octet-stream",
      },
      body: pcm16,
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    const payload = (await response.json().catch(() => ({}))) as {
      error?: string;
      durationMs?: number;
    };
    if (response.ok && typeof payload.durationMs === "number") {
      return { durationMs: payload.durationMs };
    }
    if (
      response.status === 503 &&
      payload.error === "commercial_model_warming" &&
      attempt < 7
    ) {
      await new Promise((resolve) => setTimeout(resolve, 350));
      continue;
    }
    throw new Error(
      payload.error || `Studio 3D speech returned HTTP ${response.status}`,
    );
  }
  throw new Error("Il modello labiale Unreal non è diventato pronto in tempo.");
}
