import type {
  TalkRunIntent,
  TalkRunMessageResponse,
  TalkRunResponse,
} from "@/types/talk-run";
import { getStudioTheme } from "@/lib/studio-themes";

export type BroadcastShot = "wide" | "single" | "two_shot" | "reaction";
export type BroadcastFraming = "loose" | "medium" | "tight";
export type BroadcastCameraMotion =
  | "locked"
  | "push_in"
  | "drift_left"
  | "drift_right";

export interface BroadcastEditSegment {
  segmentId: string;
  segmentIndex: number;
  sequence: number;
  startFrame: number;
  endFrame: number;
  durationFrames: number;
  shot: BroadcastShot;
  cameraId: string;
  transition: "cut";
  framing?: BroadcastFraming;
  motion?: BroadcastCameraMotion;
  focusParticipantIndex?: number;
  companionParticipantIndex?: number;
  reactionParticipantIndex?: number;
  speakerName: string;
  speakerRole?: string;
  targetSpeakerName?: string;
  intent: TalkRunIntent;
  threadLabel: string;
  caption: string;
}

export interface BroadcastMasterManifest {
  schema: "conclavia.broadcast-master.v2";
  runId: string;
  talkId: string;
  title: string;
  topic: string;
  language: string;
  createdAt: string;
  render: {
    width: 3840;
    height: 2160;
    fps: 30;
    colorSpace: "rec709";
    audioSampleRate: 48000;
    audioChannels: 2;
    targetLufs: -14;
    truePeakDb: -1;
  };
  totalFrames: number;
  segments: BroadcastEditSegment[];
}

interface RelativeCoverageCut {
  atFrame: number;
  shot: BroadcastShot;
  focusParticipantIndex?: number;
  companionParticipantIndex?: number;
  reactionParticipantIndex?: number;
  framing?: BroadcastFraming;
  motion?: BroadcastCameraMotion;
}

function editorialWide(intent: TalkRunIntent): boolean {
  return intent === "opening" || intent === "closing" || intent === "moderation";
}

function boundedFrame(
  value: number,
  minimum: number,
  maximum: number,
): number {
  return Math.max(minimum, Math.min(maximum, Math.round(value)));
}

function cameraIdForCut(cut: RelativeCoverageCut): string {
  if (cut.shot === "wide") return "CAM-WS";
  if (cut.shot === "reaction") {
    return `CAM-R${(cut.reactionParticipantIndex ?? 0) + 1}`;
  }
  if (cut.shot === "two_shot") {
    return `CAM-2-${(cut.focusParticipantIndex ?? 0) + 1}-${(cut.companionParticipantIndex ?? 0) + 1}`;
  }
  return `CAM-S${(cut.focusParticipantIndex ?? 0) + 1}`;
}

function coverageForMessage(
  message: TalkRunMessageResponse,
  durationFrames: number,
  fps: number,
  usesCreatorDirection: boolean,
): RelativeCoverageCut[] {
  const speaker = message.participantIndex;
  if (editorialWide(message.intent) || speaker === undefined) {
    return [
      {
        atFrame: 0,
        shot: "wide",
        motion: usesCreatorDirection ? "push_in" : "locked",
      },
    ];
  }

  const target = message.targetParticipantIndex;
  const pattern = message.sequence % 3;
  const cuts: RelativeCoverageCut[] = [
    {
      atFrame: 0,
      shot: "single",
      focusParticipantIndex: speaker,
      framing: usesCreatorDirection && pattern === 1 ? "loose" : "medium",
      motion: usesCreatorDirection
        ? pattern === 0
          ? "push_in"
          : pattern === 1
            ? "drift_left"
            : "drift_right"
        : pattern === 0
          ? "push_in"
          : "locked",
    },
  ];
  const targetIsAdjacent =
    target !== undefined && Math.abs(speaker - target) === 1;

  const minimumPunchSeconds = usesCreatorDirection ? 7.8 : 11.5;
  if (durationFrames >= fps * minimumPunchSeconds) {
    cuts.push({
      atFrame: boundedFrame(
        durationFrames * (usesCreatorDirection ? 0.34 : 0.48),
        fps * (usesCreatorDirection ? 3.2 : 5),
        durationFrames - fps * (usesCreatorDirection ? 3.2 : 4),
      ),
      shot: "single",
      focusParticipantIndex: speaker,
      framing: "tight",
      motion: "push_in",
    });
  }

  const minimumInsertSeconds = usesCreatorDirection ? 11.5 : 15;
  if (target !== undefined && durationFrames >= fps * minimumInsertSeconds) {
    const insertAt = boundedFrame(
      durationFrames * (usesCreatorDirection ? 0.62 : 0.68),
      fps * (usesCreatorDirection ? 7 : 9),
      durationFrames - fps * (usesCreatorDirection ? 3.2 : 4),
    );
    const insertDuration = Math.round(
      fps *
        (targetIsAdjacent
          ? usesCreatorDirection
            ? 2.75
            : 3.4
          : usesCreatorDirection
            ? 2.15
            : 2.8),
    );
    cuts.push({
      atFrame: insertAt,
      shot: targetIsAdjacent ? "two_shot" : "reaction",
      focusParticipantIndex: targetIsAdjacent ? speaker : target,
      companionParticipantIndex: targetIsAdjacent ? target : undefined,
      reactionParticipantIndex: targetIsAdjacent ? undefined : target,
      framing: targetIsAdjacent ? "medium" : "loose",
      motion: usesCreatorDirection
        ? targetIsAdjacent
          ? "push_in"
          : "drift_right"
        : "locked",
    });
    cuts.push({
      atFrame: insertAt + insertDuration,
      shot: "single",
      focusParticipantIndex: speaker,
      framing: "medium",
      motion: usesCreatorDirection
        ? pattern === 2
          ? "drift_left"
          : "push_in"
        : "locked",
    });
  } else if (
    target === undefined &&
    durationFrames >= fps * (usesCreatorDirection ? 14.5 : 20)
  ) {
    const wideAt = boundedFrame(
      durationFrames * (usesCreatorDirection ? 0.67 : 0.72),
      fps * (usesCreatorDirection ? 8 : 12),
      durationFrames - fps * (usesCreatorDirection ? 3.2 : 4.2),
    );
    const wideEnd =
      wideAt + Math.round(fps * (usesCreatorDirection ? 2.35 : 3.2));
    if (wideEnd < durationFrames) {
      cuts.push({
        atFrame: wideAt,
        shot: "wide",
        motion: usesCreatorDirection ? "push_in" : "locked",
      });
      cuts.push({
        atFrame: wideEnd,
        shot: "single",
        focusParticipantIndex: speaker,
        framing: "tight",
        motion: "push_in",
      });
    }
  }

  if (durationFrames >= fps * (usesCreatorDirection ? 22 : 28)) {
    cuts.push({
      atFrame: durationFrames - Math.round(fps * 4.8),
      shot: "single",
      focusParticipantIndex: speaker,
      framing: "tight",
      motion: usesCreatorDirection ? "push_in" : "locked",
    });
  }

  const sorted = cuts
    .filter((cut) => cut.atFrame >= 0 && cut.atFrame < durationFrames)
    .sort((left, right) => left.atFrame - right.atFrame);
  return sorted.filter(
    (cut, index) =>
      index === sorted.length - 1 || cut.atFrame !== sorted[index + 1].atFrame,
  );
}

export function buildBroadcastMasterManifest(
  run: TalkRunResponse,
): BroadcastMasterManifest {
  const fps = 30;
  const snapshot = run.talkSnapshot;
  const usesCreatorDirection =
    getStudioTheme(snapshot?.settings.studioTheme).editorialTone === "creator";
  let frameCursor = 0;
  let segmentIndex = 0;
  const segments: BroadcastEditSegment[] = [];

  for (const message of run.messages) {
    const messageFrames = Math.max(
      1,
      Math.round(message.estimatedAirtimeSeconds * fps),
    );
    const coverage = coverageForMessage(
      message,
      messageFrames,
      fps,
      usesCreatorDirection,
    );
    coverage.forEach((cut, cutIndex) => {
      const nextCut = coverage[cutIndex + 1];
      const relativeEnd = nextCut ? nextCut.atFrame - 1 : messageFrames - 1;
      const durationFrames = Math.max(1, relativeEnd - cut.atFrame + 1);
      segmentIndex += 1;
      segments.push({
        segmentId: `${message.sequence}.${cutIndex + 1}`,
        segmentIndex,
        sequence: message.sequence,
        startFrame: frameCursor + cut.atFrame,
        endFrame: frameCursor + relativeEnd,
        durationFrames,
        shot: cut.shot,
        cameraId: cameraIdForCut(cut),
        transition: "cut",
        framing: cut.framing,
        motion: cut.motion,
        focusParticipantIndex: cut.focusParticipantIndex,
        companionParticipantIndex: cut.companionParticipantIndex,
        reactionParticipantIndex: cut.reactionParticipantIndex,
        speakerName: message.speakerName,
        speakerRole: message.speakerRole,
        targetSpeakerName: message.targetSpeakerName,
        intent: message.intent,
        threadLabel: message.threadLabel,
        caption: message.content,
      });
    });
    frameCursor += messageFrames;
  }

  return {
    schema: "conclavia.broadcast-master.v2",
    runId: run.id,
    talkId: run.talkId,
    title: snapshot?.title ?? "Conclavia",
    topic: snapshot?.topic ?? run.discussionState.centralQuestion,
    language: snapshot?.language ?? "English",
    createdAt: run.updatedAt,
    render: {
      width: 3840,
      height: 2160,
      fps,
      colorSpace: "rec709",
      audioSampleRate: 48000,
      audioChannels: 2,
      targetLufs: -14,
      truePeakDb: -1,
    },
    totalFrames: frameCursor,
    segments,
  };
}
