import { NextResponse } from "next/server";

import {
  sendUnrealDirectorCue,
  type UnrealDirectorCue,
} from "@/lib/unreal-studio";
import {
  UNREAL_PERFORMANCE_FOCUSES,
  UNREAL_PERFORMANCE_GESTURES,
  UNREAL_PERFORMANCE_MOODS,
  type UnrealPerformanceBeat,
} from "@/lib/unreal-performance-plan";

const SHOTS = [
  "wide",
  "close-up",
  "two-shot",
  "profile",
  "push-in",
  "three-quarter-left",
  "three-quarter-right",
  "profile-left",
  "profile-right",
  "reaction",
] as const;

function shortText(value: unknown, maxLength: number): string | undefined {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, maxLength)
    : undefined;
}

function performanceBeats(value: unknown): UnrealPerformanceBeat[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const beats = value.slice(0, 12).flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const beat = candidate as Record<string, unknown>;
    if (
      typeof beat.atMs !== "number" ||
      typeof beat.intensity !== "number" ||
      !UNREAL_PERFORMANCE_MOODS.includes(
        beat.mood as UnrealPerformanceBeat["mood"],
      ) ||
      !UNREAL_PERFORMANCE_FOCUSES.includes(
        beat.focus as UnrealPerformanceBeat["focus"],
      ) ||
      !UNREAL_PERFORMANCE_GESTURES.includes(
        beat.gesture as UnrealPerformanceBeat["gesture"],
      )
    ) {
      return [];
    }
    return [
      {
        atMs: Math.round(Math.min(60_000, Math.max(0, beat.atMs))),
        mood: beat.mood as UnrealPerformanceBeat["mood"],
        intensity: Math.min(1, Math.max(0, beat.intensity)),
        focus: beat.focus as UnrealPerformanceBeat["focus"],
        gesture: beat.gesture as UnrealPerformanceBeat["gesture"],
      },
    ];
  });
  return beats.length > 0
    ? beats.sort((left, right) => left.atMs - right.atMs)
    : undefined;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const speakerId = shortText(body.speakerId, 40);
    const speakerName = shortText(body.speakerName, 80);
    const shot = SHOTS.includes(body.shot as (typeof SHOTS)[number])
      ? (body.shot as UnrealDirectorCue["shot"])
      : "close-up";
    if (!speakerId || !speakerName) {
      return NextResponse.json(
        { error: "speakerId and speakerName are required" },
        { status: 400 },
      );
    }

    const expectedDurationMs = Math.round(
      Math.min(
        60_000,
        Math.max(
          2_000,
          typeof body.expectedDurationMs === "number"
            ? body.expectedDurationMs
            : 8_000,
        ),
      ),
    );
    await sendUnrealDirectorCue({
      speakerId,
      targetId: shortText(body.targetId, 40),
      speakerName,
      targetName: shortText(body.targetName, 80),
      shot,
      intent: shortText(body.intent, 60) ?? "argument",
      bodyGesture:
        body.bodyGesture === "raise-hand" || body.bodyGesture === "lower-hand"
          ? body.bodyGesture
          : "none",
      listenerMood: UNREAL_PERFORMANCE_MOODS.includes(
        body.listenerMood as UnrealPerformanceBeat["mood"],
      )
        ? (body.listenerMood as UnrealPerformanceBeat["mood"])
        : undefined,
      listenerMoodIntensity:
        typeof body.listenerMoodIntensity === "number"
          ? Math.min(0.68, Math.max(0, body.listenerMoodIntensity))
          : undefined,
      expectedDurationMs,
      performanceBeats: performanceBeats(body.performanceBeats),
    });
    return NextResponse.json({ ok: true, accepted: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Cue Studio 3D non riuscito.",
      },
      { status: 502 },
    );
  }
}
