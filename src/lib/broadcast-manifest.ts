import type {
  TalkRunIntent,
  TalkRunMessageResponse,
  TalkRunResponse,
} from "@/types/talk-run";

export type BroadcastShot = "wide" | "single" | "two_shot";

export interface BroadcastEditSegment {
  sequence: number;
  startFrame: number;
  endFrame: number;
  durationFrames: number;
  shot: BroadcastShot;
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
  schema: "conclavia.broadcast-master.v1";
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
  };
  totalFrames: number;
  segments: BroadcastEditSegment[];
}

function editorialWide(intent: TalkRunIntent): boolean {
  return intent === "opening" || intent === "closing" || intent === "moderation";
}

function shotForMessage(message: TalkRunMessageResponse): BroadcastShot {
  if (editorialWide(message.intent) || message.participantIndex === undefined) {
    return "wide";
  }
  if (
    message.targetParticipantIndex !== undefined &&
    Math.abs(message.participantIndex - message.targetParticipantIndex) === 1
  ) {
    return "two_shot";
  }
  return "single";
}

export function buildBroadcastMasterManifest(
  run: TalkRunResponse,
): BroadcastMasterManifest {
  const fps = 30;
  let frameCursor = 0;
  const segments = run.messages.map((message) => {
    const durationFrames = Math.max(
      1,
      Math.round(message.estimatedAirtimeSeconds * fps),
    );
    const shot = shotForMessage(message);
    const segment: BroadcastEditSegment = {
      sequence: message.sequence,
      startFrame: frameCursor,
      endFrame: frameCursor + durationFrames - 1,
      durationFrames,
      shot,
      focusParticipantIndex: message.participantIndex,
      companionParticipantIndex:
        shot === "two_shot" ? message.targetParticipantIndex : undefined,
      reactionParticipantIndex:
        shot === "single" && message.targetParticipantIndex !== undefined
          ? message.targetParticipantIndex
          : undefined,
      speakerName: message.speakerName,
      speakerRole: message.speakerRole,
      targetSpeakerName: message.targetSpeakerName,
      intent: message.intent,
      threadLabel: message.threadLabel,
      caption: message.content,
    };
    frameCursor += durationFrames;
    return segment;
  });
  const snapshot = run.talkSnapshot;

  return {
    schema: "conclavia.broadcast-master.v1",
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
    },
    totalFrames: frameCursor,
    segments,
  };
}
