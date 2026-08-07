"use client";

import Image from "next/image";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type { LiveAvatarSession } from "@heygen/liveavatar-web-sdk";

import { useTranslations } from "@/i18n/I18nProvider";
import type { TranslationKey } from "@/i18n/translations";
import {
  getStudioAvatar,
  getStudioModeratorAvatar,
  getStudioVoice,
} from "@/lib/liveavatar-catalog";
import {
  startChromaKey,
  type ChromaKeyPipeline,
} from "@/lib/chroma-key";
import { getStudioTheme } from "@/lib/studio-themes";
import type { AudienceMessageResponse } from "@/types/audience";
import type { TalkResponse, VoiceDelivery } from "@/types/talk";
import type {
  TalkRunArcPhase,
  TalkRunIntent,
  TalkRunMessageResponse,
  TalkRunResponse,
  TalkRunTurnPlan,
} from "@/types/talk-run";

type ShotMode = "auto" | "wide" | "close" | "duo";
type StudioState = "idle" | "starting" | "ready" | "speaking" | "error";
type SeatLiveState = "offline" | "connecting" | "ready" | "speaking" | "error";
type AudioState = "idle" | "waiting" | "playing" | "blocked";
export type BroadcastAudioState = "idle" | "loading" | "speaking" | "error";
type DirectorCueKind = "speaker" | "reaction" | "context";
type CameraFraming = "loose" | "medium" | "tight";
type CameraMotion = "locked" | "push_in" | "drift_left" | "drift_right";

interface DirectorCue {
  shot: Exclude<ShotMode, "auto">;
  focusIndex?: number;
  companionIndex?: number;
  kind: DirectorCueKind;
  framing?: CameraFraming;
  motion?: CameraMotion;
  motionDurationMs?: number;
}

export interface StudioStageHandle {
  startLiveStudio: () => Promise<void>;
  prepareSpeaker: (speaker: SpeakerDescriptor) => Promise<void>;
  speak: (message: TalkRunMessageResponse) => Promise<void>;
  stopLiveStudio: () => Promise<void>;
}

type SpeakerDescriptor = Pick<
  TalkRunTurnPlan,
  "speakerType" | "participantIndex"
>;

interface StudioStageProps {
  talk: TalkResponse;
  run: TalkRunResponse | null;
  presentation?: "studio" | "broadcast";
  activePlan?: TalkRunTurnPlan;
  streamingContent?: string;
  broadcastAudioState?: BroadcastAudioState;
  broadcastMessage?: TalkRunMessageResponse;
  audienceOverlay?: AudienceMessageResponse;
  runControlActive?: boolean;
  onPauseRun?: () => void;
  onBroadcastStateChange?: (
    state: BroadcastAudioState,
    message?: TalkRunMessageResponse,
  ) => void;
}

interface LiveAvatarStatus {
  configured: boolean;
  productionEnabled: boolean;
  maxSessionSeconds: number;
  creditsLeft?: number;
  error?: string;
}

interface LiveAvatarSessionResponse {
  sessionId?: string;
  sessionToken?: string;
  maxSessionDuration?: number;
  error?: string;
}

interface SpeakerTarget {
  key: string;
  participantIndex?: number;
  sex: "female" | "male";
  avatarId: string;
  voiceId: string;
  voiceDelivery: VoiceDelivery;
  label: string;
}

interface ManagedSession {
  key: string;
  sessionId: string;
  participantIndex?: number;
  session: LiveAvatarSession;
  video: HTMLVideoElement;
  target: SpeakerTarget;
  expiresAt: number;
  currentMessage?: TalkRunMessageResponse;
  finishSpeech?: (error?: Error) => void;
  speechTimer?: number;
  commandSentAt?: number;
}

interface LiveKitCommandTransport {
  room: {
    state: string;
    localParticipant: {
      publishData: (
        data: Uint8Array,
        options: { reliable: boolean; topic: string },
      ) => Promise<void>;
    };
  };
}

interface StudioAudioGraph {
  context: AudioContext;
  limiter: DynamicsCompressorNode;
  gain: GainNode;
}

interface StudioAudioChannel {
  source: MediaStreamAudioSourceNode;
  nodes: AudioNode[];
}

interface StudioTimingMetrics {
  startupMs?: number;
  handoffMs?: number;
  samples: number;
}

// Seat centres in the shared studio backgrounds are approximately
// 17%, 33%, 50%, 67%, and 84% of the stage width.
const BASE_POSITIONS = [6, 22, 39, 56, 73];
const SEAT_CENTERS = [17, 33, 50, 67, 84];
const CLOSE_SHOT_POSITIONS = [32, 41, 50, 59, 68];
const SEAT_ACCENTS = ["#22d3ee", "#a78bfa", "#fbbf24", "#fb7185", "#34d399"];
const LIVEAVATAR_FULL_CREDITS_PER_MINUTE = 2;
const MAX_CONCURRENT_LIVEAVATARS = 5;

function captionChunks(content: string): string[] {
  const words = content.trim().split(/\s+/u).filter(Boolean);
  if (words.length === 0) return [];

  const chunks: string[] = [];
  let current: string[] = [];
  for (const word of words) {
    current.push(word);
    const endsPhrase = /[.!?;:]$/u.test(word);
    if (current.length >= 11 || (current.length >= 6 && endsPhrase)) {
      chunks.push(current.join(" "));
      current = [];
    }
  }
  if (current.length > 0) chunks.push(current.join(" "));
  return chunks;
}

function arcPhaseKey(phase: TalkRunArcPhase): TranslationKey {
  const keys: Record<TalkRunArcPhase, TranslationKey> = {
    positions: "runnerArcPositions",
    conflict: "runnerArcConflict",
    examination: "runnerArcExamination",
    synthesis: "runnerArcSynthesis",
    conclusion: "runnerArcConclusion",
  };
  return keys[phase];
}

function chromaResolutionForShot(
  shot: Exclude<ShotMode, "auto">,
  index: number,
  focusIndex: number,
  companionIndex: number,
  activeIndex?: number,
): [number, number] {
  if (shot === "close" && index === focusIndex) return [1920, 1080];
  if (
    shot === "duo" &&
    (index === focusIndex || index === companionIndex)
  ) {
    return [1280, 720];
  }
  if (shot === "wide" && index === activeIndex) return [960, 540];
  return [640, 360];
}

function intentKey(intent: TalkRunIntent): TranslationKey {
  const keys: Record<TalkRunIntent, TranslationKey> = {
    opening: "runnerIntentOpening",
    argument: "runnerIntentArgument",
    reply: "runnerIntentReply",
    challenge: "runnerIntentChallenge",
    question: "runnerIntentQuestion",
    answer: "runnerIntentAnswer",
    clarification: "runnerIntentClarification",
    partial_agreement: "runnerIntentPartialAgreement",
    interruption: "runnerIntentInterruption",
    moderation: "runnerIntentModeration",
    closing: "runnerIntentClosing",
  };
  return keys[intent];
}

function HumanSilhouette() {
  return (
    <svg viewBox="0 0 300 420" className="h-full w-full" aria-hidden="true">
      <defs>
        <linearGradient id="human-silhouette" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#49748a" />
          <stop offset="1" stopColor="#172d47" />
        </linearGradient>
      </defs>
      <circle cx="150" cy="118" r="72" fill="url(#human-silhouette)" />
      <path
        d="M28 420c4-124 48-196 122-196s118 72 122 196H28Z"
        fill="url(#human-silhouette)"
      />
    </svg>
  );
}

export const StudioStage = forwardRef<StudioStageHandle, StudioStageProps>(
  function StudioStage(
    {
      talk,
      run,
      presentation = "studio",
      activePlan,
      streamingContent = "",
      broadcastAudioState = "idle",
      broadcastMessage,
      audienceOverlay,
      runControlActive = false,
      onPauseRun,
      onBroadcastStateChange,
    },
    ref,
  ) {
    const { locale, t } = useTranslations();
    const isBroadcast = presentation === "broadcast";
    const [shotMode, setShotMode] = useState<ShotMode>("auto");
    const [studioState, setStudioState] = useState<StudioState>("idle");
    const [audioState, setAudioState] = useState<AudioState>("idle");
    const [volume, setVolume] = useState(1);
    const [studioError, setStudioError] = useState<string | null>(null);
    const [status, setStatus] = useState<LiveAvatarStatus | null>(null);
    const [seatStates, setSeatStates] = useState<SeatLiveState[]>(() =>
      talk.participants.map(() => "offline"),
    );
    const [seatVideoReady, setSeatVideoReady] = useState<boolean[]>(() =>
      talk.participants.map(() => false),
    );
    const [moderatorLiveState, setModeratorLiveState] =
      useState<SeatLiveState>("offline");
    const [moderatorVideoReady, setModeratorVideoReady] = useState(false);
    const [activeLiveParticipant, setActiveLiveParticipant] = useState<number>();
    const [directorCue, setDirectorCue] = useState<DirectorCue>();
    const [cameraCutSerial, setCameraCutSerial] = useState(0);
    const [phaseStinger, setPhaseStinger] = useState<TalkRunArcPhase>();
    const [captionProgress, setCaptionProgress] = useState({
      sequence: -1,
      index: 0,
    });
    const [cameraSeat, setCameraSeat] = useState<number | null>(null);
    const [cameraError, setCameraError] = useState<string | null>(null);
    const [timingMetrics, setTimingMetrics] = useState<StudioTimingMetrics>({
      samples: 0,
    });
    const sessionsRef = useRef<Map<string, ManagedSession>>(new Map());
    const sessionStartPromisesRef = useRef<Map<string, Promise<void>>>(
      new Map(),
    );
    const sdkRef = useRef<
      typeof import("@heygen/liveavatar-web-sdk") | null
    >(null);
    const startPromiseRef = useRef<Promise<void> | null>(null);
    const stoppingRef = useRef(false);
    const keepAliveTimerRef = useRef<number | null>(null);
    const chromaCleanupRefs = useRef<Map<number, ChromaKeyPipeline>>(new Map());
    const avatarVideoRefs = useRef<(HTMLVideoElement | null)[]>([]);
    const avatarCanvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);
    const moderatorVideoRef = useRef<HTMLVideoElement | null>(null);
    const moderatorCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const moderatorChromaCleanupRef = useRef<ChromaKeyPipeline | null>(null);
    const cameraVideoRef = useRef<HTMLVideoElement | null>(null);
    const cameraStreamRef = useRef<MediaStream | null>(null);
    const audioGraphRef = useRef<StudioAudioGraph | null>(null);
    const audioChannelRefs = useRef<Map<HTMLVideoElement, StudioAudioChannel>>(
      new Map(),
    );
    const lastSpeechEndedAtRef = useRef<number | undefined>(undefined);
    const studioLockReleaseRef = useRef<(() => void) | null>(null);
    const previousArcPhaseRef = useRef<TalkRunArcPhase | undefined>(undefined);
    const directorTimersRef = useRef<number[]>([]);
    const seatVideoReadyRef = useRef(seatVideoReady);
    const cameraRigRef = useRef<HTMLDivElement | null>(null);

    const latestMessage = run?.messages.at(-1);
    const showBroadcastContext =
      studioState !== "idle" ||
      runControlActive ||
      broadcastAudioState !== "idle";
    const programmeMessage =
      broadcastAudioState === "loading" || broadcastAudioState === "speaking"
        ? broadcastMessage
        : undefined;
    const onAirMessage =
      broadcastAudioState === "speaking" ? broadcastMessage : undefined;
    const audienceCard = onAirMessage?.audienceCue ?? audienceOverlay;
    const currentTurn = activePlan ?? run?.activeTurn;
    const runCompleted = run?.status === "completed" && !runControlActive;
    const visibleSpeakerType =
      programmeMessage?.speakerType ?? currentTurn?.speakerType;
    const activeParticipantIndex = runCompleted || !showBroadcastContext
      ? undefined
      : programmeMessage?.speakerType === "participant"
        ? programmeMessage.participantIndex
        : activeLiveParticipant ??
          (currentTurn?.speakerType === "participant"
            ? currentTurn.participantIndex
            : latestMessage?.speakerType === "participant"
              ? latestMessage.participantIndex
              : undefined);
    const moderatorOnCamera =
      !runCompleted &&
      showBroadcastContext &&
      talk.moderator.kind === "ai" &&
      visibleSpeakerType === "moderator";
    const reactionPreviewIndex =
      directorCue?.kind === "reaction" ? directorCue.focusIndex : undefined;
    const targetParticipantIndex = runCompleted || !showBroadcastContext
      ? undefined
      : programmeMessage?.targetParticipantIndex ??
        currentTurn?.targetParticipantIndex ??
        latestMessage?.targetParticipantIndex;
    const currentIntent = showBroadcastContext
      ? programmeMessage?.intent ?? currentTurn?.intent ?? latestMessage?.intent
      : undefined;
    const currentThread = showBroadcastContext
      ? programmeMessage?.threadLabel ||
        currentTurn?.threadLabel ||
        latestMessage?.threadLabel ||
        run?.discussionState.currentFocus ||
        talk.topic
      : talk.topic;
    const currentSpeaker = showBroadcastContext
      ? reactionPreviewIndex !== undefined
        ? talk.participants[reactionPreviewIndex]?.name
        : programmeMessage?.speakerName ??
          currentTurn?.speakerName ??
          latestMessage?.speakerName
      : undefined;
    const currentRole =
      reactionPreviewIndex !== undefined
        ? talk.participants[reactionPreviewIndex]?.role
        : programmeMessage?.speakerRole ??
          (activeParticipantIndex !== undefined
            ? talk.participants[activeParticipantIndex]?.role
            : talk.moderator.role);
    const currentTargetName =
      programmeMessage?.targetSpeakerName ?? currentTurn?.targetSpeakerName;
    const currentCaptionChunks = onAirMessage
      ? captionChunks(onAirMessage.content)
      : [];
    const captionSequence = onAirMessage?.sequence;
    const captionAirtimeSeconds = onAirMessage?.estimatedAirtimeSeconds;
    const captionIndex =
      captionSequence !== undefined &&
      captionProgress.sequence === captionSequence
        ? captionProgress.index
        : 0;
    const visibleCaption = onAirMessage
      ? currentCaptionChunks[
          Math.min(captionIndex, Math.max(0, currentCaptionChunks.length - 1))
        ] ?? ""
      : !isBroadcast
        ? streamingContent
        : "";
    const visibleArcPhase =
      activePlan?.arcPhase ?? run?.activeTurn?.arcPhase ?? run?.discussionState.arcPhase;
    const firstHumanSeat = talk.participants.findIndex(
      (participant) => participant.kind === "human",
    );
    const usesEditorialWideShot =
      currentIntent === "opening" ||
      currentIntent === "closing" ||
      currentIntent === "moderation";
    const studioTheme = getStudioTheme(talk.settings.studioTheme);
    const usesCreatorDirection = studioTheme.editorialTone === "creator";
    const effectiveShot: Exclude<ShotMode, "auto"> =
      shotMode !== "auto"
        ? shotMode
        : directorCue?.shot ??
          (moderatorOnCamera
            ? "close"
            : runCompleted || activeParticipantIndex === undefined
              ? "wide"
              : usesEditorialWideShot
                ? "wide"
                : "close");
    const framedFocusIndex = directorCue?.focusIndex ?? activeParticipantIndex ?? 2;
    const duoCompanionIndex =
      directorCue?.companionIndex ??
      (targetParticipantIndex !== undefined &&
      targetParticipantIndex !== framedFocusIndex
        ? targetParticipantIndex
        : framedFocusIndex === talk.participants.length - 1
          ? framedFocusIndex - 1
          : framedFocusIndex + 1);
    const closeAnchor = SEAT_CENTERS[framedFocusIndex] ?? 50;
    const closeDestination = CLOSE_SHOT_POSITIONS[framedFocusIndex] ?? 50;
    const duoAnchor =
      ((SEAT_CENTERS[framedFocusIndex] ?? 50) +
        (SEAT_CENTERS[duoCompanionIndex] ?? 50)) /
      2;
    const duoDestination = Math.min(66, Math.max(34, duoAnchor));
    const duoSpan = Math.abs(
      (SEAT_CENTERS[framedFocusIndex] ?? 50) -
        (SEAT_CENTERS[duoCompanionIndex] ?? 50),
    );
    const cameraZoom =
      effectiveShot === "close"
        ? directorCue?.framing === "tight"
          ? 1.9
          : directorCue?.framing === "loose"
            ? 1.52
            : 1.68
        : effectiveShot === "duo"
          ? duoSpan <= 18
            ? 1.3
            : duoSpan <= 35
              ? 1.14
              : 1
          : 1;
    const cameraAnchor =
      effectiveShot === "close"
        ? closeAnchor
        : effectiveShot === "duo"
          ? duoAnchor
          : 50;
    const cameraDestination =
      effectiveShot === "close"
        ? closeDestination
        : effectiveShot === "duo"
          ? duoDestination
          : 50;
    const cameraVerticalOffset =
      effectiveShot === "close" ? -7.2 : effectiveShot === "duo" ? -3.5 : 0;
    const cameraVerticalAnchor =
      effectiveShot === "close" ? 34 : effectiveShot === "duo" ? 39 : 45;
    const cameraTransform = `translate3d(${cameraDestination - cameraAnchor}%, ${cameraVerticalOffset}%, 0) scale(${cameraZoom})`;
    const cameraMotion: CameraMotion =
      shotMode === "auto" ? directorCue?.motion ?? "locked" : "locked";
    const cameraMotionDuration =
      directorCue?.motionDurationMs ?? (effectiveShot === "close" ? 5_200 : 4_400);

    useEffect(() => {
      const rig = cameraRigRef.current;
      if (!rig) return;
      rig.getAnimations().forEach((animation) => animation.cancel());
      rig.style.transform = cameraTransform;

      if (
        cameraMotion === "locked" ||
        window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
        typeof rig.animate !== "function"
      ) {
        return;
      }

      const destination =
        cameraMotion === "push_in"
          ? `${cameraTransform} translate3d(0, -.35%, 0) scale(1.035)`
          : cameraMotion === "drift_left"
            ? `${cameraTransform} translate3d(-.75%, -.15%, 0) scale(1.018)`
            : `${cameraTransform} translate3d(.75%, -.15%, 0) scale(1.018)`;
      const animation = rig.animate(
        [
          { transform: cameraTransform },
          { transform: destination },
        ],
        {
          duration: cameraMotionDuration,
          easing: "cubic-bezier(.18,.72,.22,1)",
          fill: "both",
        },
      );
      return () => animation.cancel();
    }, [
      cameraCutSerial,
      cameraMotion,
      cameraMotionDuration,
      cameraTransform,
    ]);

    useEffect(() => {
      seatVideoReadyRef.current = seatVideoReady;
    }, [seatVideoReady]);

    useEffect(() => {
      if (
        captionSequence === undefined ||
        captionAirtimeSeconds === undefined ||
        currentCaptionChunks.length <= 1
      ) {
        return;
      }

      const estimatedSpeechMs = Math.max(
        1_400,
        captionAirtimeSeconds * 840,
      );
      const intervalMs = Math.max(
        1_100,
        Math.round(estimatedSpeechMs / currentCaptionChunks.length),
      );
      let nextIndex = 0;
      const timer = window.setInterval(() => {
        nextIndex += 1;
        const boundedIndex = Math.min(
          nextIndex,
          currentCaptionChunks.length - 1,
        );
        setCaptionProgress({ sequence: captionSequence, index: boundedIndex });
        if (boundedIndex >= currentCaptionChunks.length - 1) {
          window.clearInterval(timer);
        }
      }, intervalMs);
      return () => window.clearInterval(timer);
    }, [
      captionAirtimeSeconds,
      captionSequence,
      currentCaptionChunks.length,
    ]);

    function clearDirectorTimers() {
      for (const timer of directorTimersRef.current) {
        window.clearTimeout(timer);
      }
      directorTimersRef.current = [];
    }

    function takeCamera(cue: DirectorCue) {
      setDirectorCue(cue);
      setCameraCutSerial((current) => current + 1);
    }

    function scheduleDirectorCue(delayMs: number, cue: DirectorCue) {
      const timer = window.setTimeout(() => takeCamera(cue), delayMs);
      directorTimersRef.current.push(timer);
    }

    function directSpeakingMessage(message: TalkRunMessageResponse) {
      clearDirectorTimers();
      const speakerIndex = message.participantIndex;
      const durationMs = Math.max(
        5_200,
        message.estimatedAirtimeSeconds * 840,
      );
      if (message.speakerType === "moderator" || speakerIndex === undefined) {
        const hostCue: DirectorCue = {
          shot: "close",
          kind: "speaker",
          framing: message.intent === "question" ? "tight" : "medium",
          motion: usesCreatorDirection ? "push_in" : "locked",
          motionDurationMs: Math.min(
            usesCreatorDirection ? 6_000 : 8_000,
            durationMs,
          ),
        };
        if (message.intent === "opening") {
          takeCamera({
            shot: "wide",
            kind: "context",
            motion: usesCreatorDirection ? "push_in" : "locked",
          });
          scheduleDirectorCue(usesCreatorDirection ? 1_350 : 1_800, hostCue);
        } else {
          takeCamera(hostCue);
          if (message.intent === "closing" && durationMs >= 7_500) {
            scheduleDirectorCue(durationMs - 2_800, {
              shot: "wide",
              kind: "context",
              motion: usesCreatorDirection ? "push_in" : "locked",
              motionDurationMs: usesCreatorDirection ? 2_600 : 3_400,
            });
          }
        }
        return;
      }

      const pattern = message.sequence % 3;
      const speakerCue: DirectorCue = {
        shot: "close",
        focusIndex: speakerIndex,
        kind: "speaker",
        framing:
          usesCreatorDirection && pattern === 1 ? "loose" : "medium",
        motion: usesCreatorDirection
          ? pattern === 0
            ? "push_in"
            : pattern === 1
              ? "drift_left"
              : "drift_right"
          : pattern === 0
            ? "push_in"
            : "locked",
        motionDurationMs: Math.min(
          usesCreatorDirection ? 6_200 : 8_200,
          durationMs,
        ),
      };
      takeCamera(speakerCue);
      const targetIndex = message.targetParticipantIndex;
      const targetIsReady =
        targetIndex !== undefined && seatVideoReadyRef.current[targetIndex];
      const targetIsAdjacent =
        targetIndex !== undefined && Math.abs(speakerIndex - targetIndex) === 1;

      const minimumPunchDuration = usesCreatorDirection ? 7_800 : 11_500;
      if (durationMs < minimumPunchDuration) return;

      const punchAt = usesCreatorDirection
        ? Math.min(5_400, Math.max(3_200, durationMs * 0.34))
        : Math.min(8_000, Math.max(5_000, durationMs * 0.48));
      const punchCue: DirectorCue = {
        ...speakerCue,
        framing: "tight",
        motion: "push_in",
        motionDurationMs: Math.max(2_800, durationMs - punchAt),
      };
      scheduleDirectorCue(punchAt, punchCue);

      const minimumInsertDuration = usesCreatorDirection ? 11_500 : 15_000;
      if (targetIsReady && durationMs >= minimumInsertDuration) {
        const insertAt = Math.min(
          durationMs - (usesCreatorDirection ? 3_200 : 4_000),
          Math.max(
            punchAt + (usesCreatorDirection ? 3_200 : 4_200),
            durationMs * (usesCreatorDirection ? 0.62 : 0.68),
          ),
        );
        const insertDuration = targetIsAdjacent
          ? usesCreatorDirection
            ? 2_750
            : 3_400
          : usesCreatorDirection
            ? 2_150
            : 2_800;
        scheduleDirectorCue(insertAt, {
          shot: targetIsAdjacent ? "duo" : "close",
          focusIndex: targetIsAdjacent ? speakerIndex : targetIndex,
          companionIndex: targetIsAdjacent ? targetIndex : undefined,
          kind: targetIsAdjacent ? "context" : "reaction",
          framing: targetIsAdjacent ? "medium" : "loose",
          motion: usesCreatorDirection
            ? targetIsAdjacent
              ? "push_in"
              : "drift_right"
            : "locked",
          motionDurationMs: insertDuration,
        });
        scheduleDirectorCue(insertAt + insertDuration, {
          ...speakerCue,
          framing: "medium",
          motion: usesCreatorDirection
            ? pattern === 2
              ? "drift_left"
              : "push_in"
            : "locked",
          motionDurationMs: Math.max(2_500, durationMs - insertAt - insertDuration),
        });
      } else if (durationMs >= (usesCreatorDirection ? 14_500 : 20_000)) {
        const contextDuration = usesCreatorDirection ? 2_350 : 3_200;
        const contextAt = Math.min(
          durationMs - (usesCreatorDirection ? 3_200 : 4_200),
          durationMs * (usesCreatorDirection ? 0.67 : 0.72),
        );
        scheduleDirectorCue(contextAt, {
          shot: "wide",
          kind: "context",
          motion: usesCreatorDirection ? "push_in" : "locked",
          motionDurationMs: contextDuration,
        });
        scheduleDirectorCue(contextAt + contextDuration, {
          ...speakerCue,
          framing: "tight",
          motion: usesCreatorDirection ? "push_in" : "locked",
          motionDurationMs: Math.max(
            2_400,
            durationMs - contextAt - contextDuration,
          ),
        });
      }

      if (durationMs >= (usesCreatorDirection ? 22_000 : 28_000)) {
        scheduleDirectorCue(durationMs - 4_800, {
          ...speakerCue,
          framing: "tight",
          motion: usesCreatorDirection ? "push_in" : "locked",
          motionDurationMs: 4_600,
        });
      }
    }

    useEffect(() => {
      const previous = previousArcPhaseRef.current;
      previousArcPhaseRef.current = visibleArcPhase;
      if (
        !previous ||
        !visibleArcPhase ||
        previous === visibleArcPhase ||
        studioState === "idle"
      ) {
        return;
      }
      setPhaseStinger(visibleArcPhase);
      const timer = window.setTimeout(
        () => setPhaseStinger(undefined),
        1_800,
      );
      return () => window.clearTimeout(timer);
    }, [studioState, visibleArcPhase]);

    function participantSex(index: number): "female" | "male" {
      return talk.participants[index]?.sex === "male" ? "male" : "female";
    }

    function studioAvatarForSeat(index: number) {
      const sex = participantSex(index);
      const sameSexOrdinal = talk.participants
        .slice(0, index)
        .filter(
          (participant, previousIndex) =>
            participant.kind === "ai" && participantSex(previousIndex) === sex,
        ).length;
      return getStudioAvatar(sameSexOrdinal, sex);
    }

    function speakerTargets(): SpeakerTarget[] {
      const participants = talk.participants.flatMap((participant, index) => {
        if (participant.kind !== "ai") return [];
        const avatar = studioAvatarForSeat(index);
        const voice =
          participant.voiceId ??
          getStudioVoice(
            talk.participants
              .slice(0, index)
              .filter(
                (candidate, previousIndex) =>
                  candidate.kind === "ai" &&
                  participantSex(previousIndex) === participant.sex,
              ).length,
            participant.sex,
            talk.language,
          ).id;
        return [
          {
            key: `participant:${index}`,
            participantIndex: index,
            sex: participant.sex,
            avatarId: avatar.id,
            voiceId: voice,
            voiceDelivery: participant.voiceDelivery ?? "natural",
            label: participant.name,
          } satisfies SpeakerTarget,
        ];
      });

      if (talk.moderator.kind !== "ai") return participants;
      const moderatorAvatar = getStudioModeratorAvatar();
      const moderatorVoice =
        talk.moderator.voiceId ?? getStudioVoice(0, "male", talk.language).id;
      return [
        ...participants,
        {
          key: "moderator",
          sex: "male",
          avatarId: moderatorAvatar.id,
          voiceId: moderatorVoice,
          voiceDelivery: talk.moderator.voiceDelivery ?? "natural",
          label: talk.moderator.name || t("moderation"),
        },
      ];
    }

    function setSeatState(index: number, state: SeatLiveState) {
      setSeatStates((current) =>
        current.map((value, currentIndex) =>
          currentIndex === index ? state : value,
        ),
      );
    }

    function setSeatVideoIsReady(index: number, ready: boolean) {
      setSeatVideoReady((current) =>
        current.map((value, currentIndex) =>
          currentIndex === index ? ready : value,
        ),
      );
    }

    function targetForSpeaker(
      speaker: SpeakerDescriptor,
    ): SpeakerTarget | undefined {
      const key =
        speaker.speakerType === "moderator"
          ? "moderator"
          : `participant:${speaker.participantIndex}`;
      return speakerTargets().find((target) => target.key === key);
    }

    async function refreshStatus(): Promise<LiveAvatarStatus | null> {
      try {
        const response = await fetch("/api/liveavatar/status", { cache: "no-store" });
        const payload = (await response.json()) as LiveAvatarStatus;
        setStatus(payload);
        return payload;
      } catch {
        const unavailable: LiveAvatarStatus = {
          configured: false,
          productionEnabled: false,
          maxSessionSeconds: 300,
          error: t("studioStatusError"),
        };
        setStatus(unavailable);
        return unavailable;
      }
    }

    function videoForTarget(target: SpeakerTarget): HTMLVideoElement | null {
      return target.participantIndex === undefined
        ? moderatorVideoRef.current
        : avatarVideoRefs.current[target.participantIndex] ?? null;
    }

    function studioAudioGraph(): StudioAudioGraph {
      const existing = audioGraphRef.current;
      if (existing && existing.context.state !== "closed") return existing;

      const context = new AudioContext({
        latencyHint: "interactive",
        sampleRate: 48_000,
      });
      const limiter = context.createDynamicsCompressor();
      limiter.threshold.value = -4;
      limiter.knee.value = 2;
      limiter.ratio.value = 12;
      limiter.attack.value = 0.002;
      limiter.release.value = 0.12;
      const gain = context.createGain();
      gain.gain.value = volume;
      limiter.connect(gain).connect(context.destination);
      const graph = { context, limiter, gain };
      audioGraphRef.current = graph;
      return graph;
    }

    function connectStudioAudio(
      video: HTMLVideoElement,
      target: SpeakerTarget,
    ): boolean {
      const stream = video.srcObject;
      if (!(stream instanceof MediaStream) || stream.getAudioTracks().length === 0) {
        return false;
      }
      if (!audioChannelRefs.current.has(video)) {
        const graph = studioAudioGraph();
        const source = graph.context.createMediaStreamSource(stream);
        const highPass = graph.context.createBiquadFilter();
        highPass.type = "highpass";
        highPass.frequency.value = target.sex === "female" ? 88 : 72;
        highPass.Q.value = 0.7;
        const lowMid = graph.context.createBiquadFilter();
        lowMid.type = "peaking";
        lowMid.frequency.value = target.sex === "female" ? 310 : 250;
        lowMid.Q.value = 0.9;
        lowMid.gain.value = -1.8;
        const presence = graph.context.createBiquadFilter();
        presence.type = "peaking";
        presence.frequency.value = target.sex === "female" ? 3_400 : 3_000;
        presence.Q.value = 0.8;
        presence.gain.value = target.voiceDelivery === "energetic" ? 0.7 : 1.2;
        const compressor = graph.context.createDynamicsCompressor();
        compressor.threshold.value = -22;
        compressor.knee.value = 8;
        compressor.ratio.value =
          target.voiceDelivery === "energetic" ? 3.2 : 2.6;
        compressor.attack.value = 0.008;
        compressor.release.value = 0.14;
        const channelGain = graph.context.createGain();
        channelGain.gain.value =
          target.voiceDelivery === "energetic"
            ? 0.94
            : target.voiceDelivery === "authoritative"
              ? 1.03
              : 1;
        source
          .connect(highPass)
          .connect(lowMid)
          .connect(presence)
          .connect(compressor)
          .connect(channelGain)
          .connect(graph.limiter);
        audioChannelRefs.current.set(video, {
          source,
          nodes: [highPass, lowMid, presence, compressor, channelGain],
        });
      }
      video.muted = true;
      video.volume = 0;
      return stream
        .getAudioTracks()
        .some((track) => track.enabled && track.readyState === "live");
    }

    function disconnectStudioAudio(video: HTMLVideoElement) {
      const channel = audioChannelRefs.current.get(video);
      channel?.source.disconnect();
      for (const node of channel?.nodes ?? []) node.disconnect();
      audioChannelRefs.current.delete(video);
    }

    function releaseStudioAudio() {
      for (const channel of audioChannelRefs.current.values()) {
        channel.source.disconnect();
        for (const node of channel.nodes) node.disconnect();
      }
      audioChannelRefs.current.clear();
      const context = audioGraphRef.current?.context;
      audioGraphRef.current = null;
      if (context && context.state !== "closed") void context.close();
    }

    async function activateStudioAudio(): Promise<boolean> {
      const graph = studioAudioGraph();
      try {
        if (graph.context.state === "suspended") await graph.context.resume();
      } catch {
        setAudioState("blocked");
        return false;
      }
      const sessions = Array.from(sessionsRef.current.values());
      if (sessions.length === 0) {
        const unlocked = graph.context.state === "running";
        setAudioState(unlocked ? "waiting" : "blocked");
        return unlocked;
      }

      let blocked = false;
      let liveAudioTracks = 0;
      await Promise.all(
        sessions.map(async (managed) => {
          const video = managed.video;
          video.muted = true;
          video.volume = 0;
          try {
            await video.play();
            if (connectStudioAudio(video, managed.target)) liveAudioTracks += 1;
          } catch {
            blocked = true;
          }
        }),
      );
      if (sessionsRef.current.size === 0) {
        setAudioState("idle");
        return true;
      }
      setAudioState(
        blocked || graph.context.state !== "running"
          ? "blocked"
          : liveAudioTracks > 0
            ? "playing"
            : "waiting",
      );
      return !blocked && graph.context.state === "running";
    }

    async function makeAvatarSpeak(
      session: LiveAvatarSession,
      content: string,
    ): Promise<void> {
      const sessionId = session.sessionId;
      const transport = session as unknown as LiveKitCommandTransport;
      if (!sessionId || transport.room.state !== "connected") {
        throw new Error(t("studioSpeakerUnavailable"));
      }

      const payload = {
        event_id: crypto.randomUUID(),
        event_type: "avatar.speak_text",
        text: content,
      };
      await transport.room.localParticipant.publishData(
        new TextEncoder().encode(JSON.stringify(payload)),
        { reliable: true, topic: "agent-control" },
      );
    }

    function clearStudioTimers() {
      if (keepAliveTimerRef.current !== null) {
        window.clearInterval(keepAliveTimerRef.current);
        keepAliveTimerRef.current = null;
      }
      clearDirectorTimers();
    }

    async function acquireStudioLock(): Promise<void> {
      if (studioLockReleaseRef.current || !("locks" in navigator)) return;

      let reportAcquired: (acquired: boolean) => void = () => undefined;
      const acquired = new Promise<boolean>((resolve) => {
        reportAcquired = resolve;
      });
      void navigator.locks
        .request(
          `conclavia-live-studio:${talk.id}`,
          { ifAvailable: true },
          async (lock) => {
            reportAcquired(Boolean(lock));
            if (!lock) return;
            await new Promise<void>((resolve) => {
              studioLockReleaseRef.current = resolve;
            });
          },
        )
        .catch(() => {
          reportAcquired(false);
        });

      if (!(await acquired)) {
        throw new Error(t("studioAlreadyActive"));
      }
    }

    function releaseStudioLock() {
      const release = studioLockReleaseRef.current;
      studioLockReleaseRef.current = null;
      release?.();
    }

    function releaseMediaElements() {
      for (const pipeline of chromaCleanupRefs.current.values()) pipeline.stop();
      chromaCleanupRefs.current.clear();
      moderatorChromaCleanupRef.current?.stop();
      moderatorChromaCleanupRef.current = null;
      for (const video of avatarVideoRefs.current) {
        if (!video) continue;
        disconnectStudioAudio(video);
        video.pause();
        video.srcObject = null;
      }
      const moderatorVideo = moderatorVideoRef.current;
      if (moderatorVideo) {
        disconnectStudioAudio(moderatorVideo);
        moderatorVideo.pause();
        moderatorVideo.srcObject = null;
      }
      releaseStudioAudio();
    }

    async function retireManagedSession(managed: ManagedSession) {
      if (sessionsRef.current.get(managed.key) !== managed) return;
      sessionsRef.current.delete(managed.key);
      if (managed.speechTimer !== undefined) {
        window.clearTimeout(managed.speechTimer);
      }
      managed.finishSpeech?.();
      if (managed.participantIndex !== undefined) {
        const participantIndex = managed.participantIndex;
        chromaCleanupRefs.current.get(participantIndex)?.stop();
        chromaCleanupRefs.current.delete(participantIndex);
        setSeatVideoIsReady(participantIndex, false);
        setSeatState(participantIndex, "connecting");
      } else {
        moderatorChromaCleanupRef.current?.stop();
        moderatorChromaCleanupRef.current = null;
        setModeratorVideoReady(false);
        setModeratorLiveState("connecting");
      }
      disconnectStudioAudio(managed.video);
      await Promise.allSettled([
        fetch(`/api/liveavatar/sessions/${managed.sessionId}`, {
          method: "DELETE",
          keepalive: true,
        }),
        Promise.resolve().then(() => managed.session.stop()),
      ]);
    }

    async function stopSessions(updateInterface: boolean) {
      if (stoppingRef.current) return;
      stoppingRef.current = true;
      clearStudioTimers();
      await Promise.allSettled(sessionStartPromisesRef.current.values());
      sessionStartPromisesRef.current.clear();
      const managedSessions = Array.from(sessionsRef.current.values());
      sessionsRef.current.clear();
      for (const managed of managedSessions) {
        if (managed.speechTimer !== undefined) {
          window.clearTimeout(managed.speechTimer);
        }
        managed.finishSpeech?.();
        try {
          managed.session.interrupt();
        } catch {
          // A disconnected session no longer accepts commands.
        }
      }
      await Promise.allSettled(
        managedSessions.flatMap((managed) => [
          fetch(`/api/liveavatar/sessions/${managed.sessionId}`, {
            method: "DELETE",
            keepalive: true,
          }),
          Promise.resolve().then(() => managed.session.stop()),
        ]),
      );
      releaseMediaElements();
      releaseStudioLock();
      startPromiseRef.current = null;
      sdkRef.current = null;
      stoppingRef.current = false;

      if (updateInterface) {
        setStudioState("idle");
        setAudioState("idle");
        setActiveLiveParticipant(undefined);
        setDirectorCue(undefined);
        setSeatStates(talk.participants.map(() => "offline"));
        setSeatVideoReady(talk.participants.map(() => false));
        setModeratorLiveState("offline");
        setModeratorVideoReady(false);
        onBroadcastStateChange?.("idle");
        window.setTimeout(() => void refreshStatus(), 1_000);
      }
    }

    async function createManagedSession(
      target: SpeakerTarget,
      sdk: typeof import("@heygen/liveavatar-web-sdk"),
    ) {
      const video = videoForTarget(target);
      if (!video) throw new Error(t("studioSessionError"));
      if (target.participantIndex !== undefined) {
        setSeatState(target.participantIndex, "connecting");
        setSeatVideoIsReady(target.participantIndex, false);
      } else {
        setModeratorLiveState("connecting");
      }

      const response = await fetch("/api/liveavatar/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          avatarId: target.avatarId,
          voiceId: target.voiceId,
          voiceDelivery: target.voiceDelivery,
          seatIndex: target.participantIndex,
          speakerType:
            target.participantIndex === undefined ? "moderator" : "participant",
          sex: target.sex,
          language: talk.language,
          pace: talk.settings.pace,
        }),
      });
      const payload = (await response.json()) as LiveAvatarSessionResponse;
      if (!response.ok || !payload.sessionId || !payload.sessionToken) {
        throw new Error(payload.error || t("studioSessionError"));
      }

      const session = new sdk.LiveAvatarSession(payload.sessionToken, {
        voiceChat: false,
      });
      const managed: ManagedSession = {
        key: target.key,
        sessionId: payload.sessionId,
        participantIndex: target.participantIndex,
        session,
        video,
        target,
        expiresAt:
          Date.now() +
          (payload.maxSessionDuration ?? status?.maxSessionSeconds ?? 300) * 1_000,
      };
      sessionsRef.current.set(target.key, managed);

      let streamReady = false;
      let startupComplete = false;
      let resolveStreamReady: (() => void) | undefined;
      const streamReadyPromise = new Promise<void>((resolve) => {
        resolveStreamReady = resolve;
      });
      session.on(sdk.SessionEvent.SESSION_STREAM_READY, () => {
        video.muted = true;
        video.volume = 0;
        session.attach(video);
        streamReady = true;
        resolveStreamReady?.();
        void activateStudioAudio();

        if (target.participantIndex !== undefined) {
          const participantIndex = target.participantIndex;
          const showLiveVideo = () =>
            setSeatVideoIsReady(participantIndex, true);
          const requestVideoFrame = (
            video as HTMLVideoElement & {
              requestVideoFrameCallback?: (callback: () => void) => number;
            }
          ).requestVideoFrameCallback;
          if (requestVideoFrame) {
            requestVideoFrame.call(video, showLiveVideo);
          } else if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
            showLiveVideo();
          } else {
            video.addEventListener("loadeddata", showLiveVideo, { once: true });
          }
          const canvas = avatarCanvasRefs.current[target.participantIndex];
          if (canvas) {
            try {
              chromaCleanupRefs.current.get(target.participantIndex)?.stop();
              const pipeline = startChromaKey(video, canvas);
              const [width, height] = chromaResolutionForShot(
                effectiveShot,
                target.participantIndex,
                framedFocusIndex,
                duoCompanionIndex,
                activeParticipantIndex,
              );
              pipeline.resize(width, height);
              chromaCleanupRefs.current.set(target.participantIndex, pipeline);
            } catch {
              setStudioError(t("studioChromaError"));
            }
          }
        } else {
          const showModeratorVideo = () => setModeratorVideoReady(true);
          const requestVideoFrame = (
            video as HTMLVideoElement & {
              requestVideoFrameCallback?: (callback: () => void) => number;
            }
          ).requestVideoFrameCallback;
          if (requestVideoFrame) {
            requestVideoFrame.call(video, showModeratorVideo);
          } else if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
            showModeratorVideo();
          } else {
            video.addEventListener("loadeddata", showModeratorVideo, {
              once: true,
            });
          }
          const canvas = moderatorCanvasRef.current;
          if (canvas) {
            try {
              moderatorChromaCleanupRef.current?.stop();
              const pipeline = startChromaKey(video, canvas);
              pipeline.resize(640, 360);
              moderatorChromaCleanupRef.current = pipeline;
            } catch {
              setStudioError(t("studioChromaError"));
            }
          }
        }
      });
      session.on(sdk.AgentEventsEnum.AVATAR_SPEAK_STARTED, () => {
        const startedAt = performance.now();
        if (managed.commandSentAt !== undefined) {
          const startupMs = Math.max(0, startedAt - managed.commandSentAt);
          const handoffMs =
            lastSpeechEndedAtRef.current === undefined
              ? undefined
              : Math.max(0, startedAt - lastSpeechEndedAtRef.current);
          setTimingMetrics((current) => ({
            startupMs,
            handoffMs,
            samples: current.samples + 1,
          }));
        }
        if (managed.currentMessage) directSpeakingMessage(managed.currentMessage);
        setStudioState("speaking");
        if (target.participantIndex !== undefined) {
          setSeatState(target.participantIndex, "speaking");
          setActiveLiveParticipant(target.participantIndex);
        } else {
          setModeratorLiveState("speaking");
        }
        onBroadcastStateChange?.("speaking", managed.currentMessage);
        void activateStudioAudio();
      });
      session.on(sdk.AgentEventsEnum.AVATAR_SPEAK_ENDED, () => {
        lastSpeechEndedAtRef.current = performance.now();
        if (target.participantIndex !== undefined) {
          setSeatState(target.participantIndex, "ready");
        } else {
          setModeratorLiveState("ready");
        }
        managed.finishSpeech?.();
      });
      session.on(sdk.SessionEvent.SESSION_DISCONNECTED, () => {
        if (!startupComplete) return;
        if (sessionsRef.current.get(target.key) !== managed) return;
        const interruptedSpeech = Boolean(managed.currentMessage);
        sessionsRef.current.delete(target.key);
        disconnectStudioAudio(managed.video);
        if (stoppingRef.current) return;
        if (target.participantIndex !== undefined) {
          setSeatState(
            target.participantIndex,
            interruptedSpeech ? "error" : "offline",
          );
          setSeatVideoIsReady(target.participantIndex, false);
        } else {
          setModeratorLiveState(interruptedSpeech ? "error" : "offline");
          setModeratorVideoReady(false);
        }
        if (!interruptedSpeech) return;
        managed.finishSpeech?.(new Error(t("studioSessionDisconnected")));
        setStudioState("error");
        setStudioError(t("studioSessionDisconnected"));
        onBroadcastStateChange?.("error");
      });

      await session.start();
      if (!streamReady) {
        await Promise.race([
          streamReadyPromise,
          new Promise<never>((_, reject) =>
            window.setTimeout(
              () => reject(new Error(t("studioSessionError"))),
              15_000,
            ),
          ),
        ]);
      }
      if (target.participantIndex !== undefined) {
        setSeatState(target.participantIndex, "ready");
      } else {
        setModeratorLiveState("ready");
      }
      startupComplete = true;
    }

    async function ensureTargetSession(
      target: SpeakerTarget,
      sdk: typeof import("@heygen/liveavatar-web-sdk"),
    ): Promise<void> {
      const existing = sessionsRef.current.get(target.key);
      if (existing) {
        const hasEnoughLifetime = existing.expiresAt - Date.now() > 60_000;
        if (hasEnoughLifetime || existing.currentMessage) return;
        await retireManagedSession(existing);
      }

      const existingPromise = sessionStartPromisesRef.current.get(target.key);
      if (existingPromise) return existingPromise;

      const startPromise = createManagedSession(target, sdk).catch(
        async (error: unknown) => {
          const managed = sessionsRef.current.get(target.key);
          if (managed) {
            sessionsRef.current.delete(target.key);
            await Promise.allSettled([
              fetch(`/api/liveavatar/sessions/${managed.sessionId}`, {
                method: "DELETE",
                keepalive: true,
              }),
              Promise.resolve().then(() => managed.session.stop()),
            ]);
          }
          if (target.participantIndex !== undefined) {
            setSeatState(target.participantIndex, "error");
            setSeatVideoIsReady(target.participantIndex, false);
          } else {
            setModeratorLiveState("error");
            setModeratorVideoReady(false);
          }
          throw error;
        },
      );
      sessionStartPromisesRef.current.set(target.key, startPromise);
      try {
        await startPromise;
      } finally {
        if (sessionStartPromisesRef.current.get(target.key) === startPromise) {
          sessionStartPromisesRef.current.delete(target.key);
        }
      }
    }

    async function startLiveStudio(): Promise<void> {
      // Called synchronously from the operator's click so the AudioContext keeps
      // that user activation while the five remote sessions connect.
      void activateStudioAudio();
      if (studioState === "ready" || studioState === "speaking") return;
      if (startPromiseRef.current) return startPromiseRef.current;

      const startPromise = (async () => {
        setStudioError(null);
        setTimingMetrics({ samples: 0 });
        lastSpeechEndedAtRef.current = undefined;
        setStudioState("starting");
        setAudioState("idle");
        await acquireStudioLock();
        const liveStatus = status ?? (await refreshStatus());
        if (!liveStatus?.configured || !liveStatus.productionEnabled) {
          throw new Error(t("studioNotConfigured"));
        }

        const targets = speakerTargets();
        if (targets.length > MAX_CONCURRENT_LIVEAVATARS) {
          throw new Error(
            t("studioSpeakerLimit", {
              current: targets.length,
              maximum: MAX_CONCURRENT_LIVEAVATARS,
            }),
          );
        }
        const sdk = await import("@heygen/liveavatar-web-sdk");
        sdkRef.current = sdk;
        await Promise.all(
          targets.map((target) => ensureTargetSession(target, sdk)),
        );
        setStudioState("ready");

        keepAliveTimerRef.current = window.setInterval(() => {
          for (const managed of sessionsRef.current.values()) {
            void managed.session.keepAlive().catch(() => undefined);
          }
        }, 30_000);
      })().catch(async (error: unknown) => {
        await stopSessions(false);
        setStudioState("error");
        setAudioState("idle");
        setSeatStates(talk.participants.map(() => "offline"));
        setModeratorLiveState("offline");
        const message = error instanceof Error ? error.message : t("studioSessionError");
        setStudioError(message);
        throw error;
      });

      startPromiseRef.current = startPromise;
      try {
        await startPromise;
      } finally {
        if (startPromiseRef.current === startPromise) {
          startPromiseRef.current = null;
        }
      }
    }

    async function prepareSpeaker(speaker: SpeakerDescriptor): Promise<void> {
      await startLiveStudio();
      if (stoppingRef.current) throw new Error(t("studioSpeakerUnavailable"));

      const target = targetForSpeaker(speaker);
      if (!target) {
        const isHumanParticipant =
          speaker.speakerType === "participant" &&
          speaker.participantIndex !== undefined &&
          talk.participants[speaker.participantIndex]?.kind === "human";
        if (isHumanParticipant || talk.moderator.kind === "human") return;
        throw new Error(t("studioSpeakerUnavailable"));
      }
      const sdk = sdkRef.current;
      if (!sdk) throw new Error(t("studioSpeakerUnavailable"));
      await ensureTargetSession(target, sdk);
    }

    async function speak(message: TalkRunMessageResponse): Promise<void> {
      const key =
        message.speakerType === "moderator"
          ? "moderator"
          : `participant:${message.participantIndex}`;
      await prepareSpeaker(message);
      let managed = sessionsRef.current.get(key);
      if (!managed) throw new Error(t("studioSpeakerUnavailable"));

      const wordCount = message.content.split(/\s+/u).filter(Boolean).length;
      const requiredLifetimeMs =
        (Math.ceil((wordCount / 170) * 60) + 12) * 1_000;
      if (managed.expiresAt - Date.now() < requiredLifetimeMs) {
        await retireManagedSession(managed);
        await prepareSpeaker(message);
        managed = sessionsRef.current.get(key);
        if (!managed) throw new Error(t("studioSpeakerUnavailable"));
      }

      managed.currentMessage = message;
      onBroadcastStateChange?.("loading", message);
      clearDirectorTimers();
      if (message.participantIndex !== undefined) {
        const reactionTarget = message.targetParticipantIndex;
        const canCutToReaction =
          reactionTarget !== undefined &&
          reactionTarget !== message.participantIndex &&
          seatVideoReadyRef.current[reactionTarget];
        if (canCutToReaction) {
          takeCamera({
            shot: "close",
            focusIndex: reactionTarget,
            kind: "reaction",
            framing: "loose",
            motion: usesCreatorDirection ? "drift_right" : "locked",
            motionDurationMs: usesCreatorDirection ? 1_500 : 2_000,
          });
          scheduleDirectorCue(usesCreatorDirection ? 1_500 : 2_000, {
            shot: "wide",
            kind: "context",
            motion: usesCreatorDirection ? "push_in" : "locked",
            motionDurationMs: usesCreatorDirection ? 2_200 : 3_000,
          });
        } else {
          takeCamera({
            shot: "wide",
            kind: "context",
            motion: usesCreatorDirection ? "push_in" : "locked",
            motionDurationMs: usesCreatorDirection ? 2_200 : 3_000,
          });
        }
        setActiveLiveParticipant(message.participantIndex);
      } else {
        takeCamera({
          shot: "close",
          kind: "speaker",
          framing: "medium",
          motion: usesCreatorDirection ? "push_in" : "locked",
          motionDurationMs: usesCreatorDirection ? 3_600 : 4_800,
        });
      }
      managed.video.muted = true;
      managed.video.volume = 0;
      try {
        await managed.video.play();
        connectStudioAudio(managed.video, managed.target);
      } catch {
        setAudioState("blocked");
      }

      await new Promise<void>((resolve, reject) => {
        let finished = false;
        const finish = (error?: Error) => {
          if (finished) return;
          finished = true;
          if (managed.speechTimer !== undefined) {
            window.clearTimeout(managed.speechTimer);
            managed.speechTimer = undefined;
          }
          managed.finishSpeech = undefined;
          managed.currentMessage = undefined;
          clearDirectorTimers();
          if (error) {
            setDirectorCue(undefined);
            onBroadcastStateChange?.("error", message);
            reject(error);
            return;
          }
          setStudioState("ready");
          setActiveLiveParticipant(undefined);
          setDirectorCue(undefined);
          onBroadcastStateChange?.("idle");
          resolve();
        };
        managed.finishSpeech = finish;
        managed.speechTimer = window.setTimeout(
          () => finish(new Error(t("studioSpeechTimeout"))),
          Math.max(30_000, Math.min(120_000, wordCount * 1_100)),
        );
        managed.commandSentAt = performance.now();
        void makeAvatarSpeak(managed.session, message.content).catch(() => {
          finish(new Error(t("studioSpeechError")));
        });
      });
    }

    async function stopLiveStudio() {
      await stopSessions(true);
    }

    async function requestStopStudio() {
      onPauseRun?.();
      await stopLiveStudio();
    }

    async function toggleCamera() {
      if (cameraStreamRef.current) {
        cameraStreamRef.current.getTracks().forEach((track) => track.stop());
        cameraStreamRef.current = null;
        if (cameraVideoRef.current) cameraVideoRef.current.srcObject = null;
        setCameraSeat(null);
        return;
      }

      if (firstHumanSeat < 0) return;
      setCameraError(null);
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            facingMode: "user",
          },
          audio: false,
        });
        cameraStreamRef.current = stream;
        setCameraSeat(firstHumanSeat);
        await new Promise<void>((resolve) =>
          window.requestAnimationFrame(() => resolve()),
        );
        if (cameraVideoRef.current) {
          cameraVideoRef.current.srcObject = stream;
          await cameraVideoRef.current.play();
        }
      } catch {
        cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
        cameraStreamRef.current = null;
        setCameraSeat(null);
        setCameraError(t("studioCameraError"));
      }
    }

    function seatLayout(index: number): {
      left: string;
      width: string;
      opacity: number;
      transform: string;
      zIndex: number;
    } {
      const focusIndex = activeParticipantIndex;
      const baseLayout = {
        left: `${BASE_POSITIONS[index]}%`,
        width: "22%",
      };
      if (moderatorOnCamera) {
        return {
          ...baseLayout,
          opacity: 0,
          transform: "scale(.98)",
          zIndex: 10,
        };
      }
      if (effectiveShot === "close") {
        return index === framedFocusIndex
          ? {
              ...baseLayout,
              opacity: 1,
              transform: "translateY(-1.5%) scale(1.025)",
              zIndex: 24,
            }
          : {
              ...baseLayout,
              opacity: 0,
              transform: "scale(.98)",
              zIndex: 10,
            };
      }
      if (effectiveShot === "duo") {
        if (index === framedFocusIndex) {
          return {
            ...baseLayout,
            opacity: 1,
            transform: "translateY(-1%) scale(1.025)",
            zIndex: 24,
          };
        }
        if (index === duoCompanionIndex) {
          return {
            ...baseLayout,
            opacity: 1,
            transform: "translateY(-.5%) scale(1.015)",
            zIndex: 22,
          };
        }
        return {
          ...baseLayout,
          opacity: 0,
          transform: "scale(.98)",
          zIndex: 10,
        };
      }

      const isFocused = focusIndex === index;
      const isTarget = targetParticipantIndex === index;
      const distanceFromCenter = Math.abs(index - 2);
      const depthScale = distanceFromCenter === 2 ? 0.9 : distanceFromCenter === 1 ? 0.96 : 1;
      const depthOffset = distanceFromCenter === 2 ? 2.8 : distanceFromCenter === 1 ? 1.1 : -0.6;
      return {
        ...baseLayout,
        opacity: isFocused ? 1 : isTarget ? 0.96 : 0.86,
        transform: isFocused
          ? `translateY(${depthOffset - 1.8}%) scale(${depthScale + 0.055})`
          : isTarget
            ? `translateY(${depthOffset - 0.7}%) scale(${depthScale + 0.025})`
            : `translateY(${depthOffset}%) scale(${depthScale})`,
        zIndex: isFocused ? 24 : isTarget ? 19 : 16 - distanceFromCenter,
      };
    }

    useEffect(() => {
      for (const [index, pipeline] of chromaCleanupRefs.current) {
        const [width, height] = chromaResolutionForShot(
          effectiveShot,
          index,
          framedFocusIndex,
          duoCompanionIndex,
          activeParticipantIndex,
        );
        pipeline.resize(width, height);
      }
      moderatorChromaCleanupRef.current?.resize(
        moderatorOnCamera ? 1920 : 640,
        moderatorOnCamera ? 1080 : 360,
      );
    }, [
      activeParticipantIndex,
      duoCompanionIndex,
      effectiveShot,
      framedFocusIndex,
      moderatorOnCamera,
    ]);

    useImperativeHandle(ref, () => ({
      startLiveStudio,
      prepareSpeaker,
      speak,
      stopLiveStudio,
    }));

    useEffect(() => {
      let cancelled = false;
      void fetch("/api/liveavatar/status", { cache: "no-store" })
        .then(async (response) => (await response.json()) as LiveAvatarStatus)
        .then((payload) => {
          if (!cancelled) setStatus(payload);
        })
        .catch(() => {
          if (!cancelled) {
            setStatus({
              configured: false,
              productionEnabled: false,
              maxSessionSeconds: 300,
              error: t("studioStatusError"),
            });
          }
        });
      return () => {
        cancelled = true;
      };
    }, [t]);

    useEffect(() => {
      stoppingRef.current = false;
      const sessions = sessionsRef.current;
      const sessionStartPromises = sessionStartPromisesRef.current;
      const chromaCleanups = chromaCleanupRefs.current;
      const avatarVideos = avatarVideoRefs.current;
      const moderatorVideo = moderatorVideoRef.current;
      return () => {
        stoppingRef.current = true;
        if (keepAliveTimerRef.current !== null) {
          window.clearInterval(keepAliveTimerRef.current);
        }
        for (const managed of sessions.values()) {
          if (managed.speechTimer !== undefined) {
            window.clearTimeout(managed.speechTimer);
          }
          managed.finishSpeech?.();
          void fetch(`/api/liveavatar/sessions/${managed.sessionId}`, {
            method: "DELETE",
            keepalive: true,
          });
          void managed.session.stop();
        }
        sessions.clear();
        sessionStartPromises.clear();
        sdkRef.current = null;
        for (const pipeline of chromaCleanups.values()) pipeline.stop();
        chromaCleanups.clear();
        moderatorChromaCleanupRef.current?.stop();
        moderatorChromaCleanupRef.current = null;
        for (const timer of directorTimersRef.current) {
          window.clearTimeout(timer);
        }
        directorTimersRef.current = [];
        for (const video of avatarVideos) {
          if (!video) continue;
          disconnectStudioAudio(video);
          video.pause();
          video.srcObject = null;
        }
        if (moderatorVideo) {
          disconnectStudioAudio(moderatorVideo);
          moderatorVideo.pause();
          moderatorVideo.srcObject = null;
        }
        releaseStudioAudio();
        cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
        releaseStudioLock();
      };
    }, []);

    const liveTargets = speakerTargets();
    const connectedCount = liveTargets.filter((target) =>
      target.participantIndex === undefined
        ? moderatorLiveState === "ready" || moderatorLiveState === "speaking"
        : seatStates[target.participantIndex] === "ready" ||
          seatStates[target.participantIndex] === "speaking",
    ).length;
    const estimatedCredits =
      liveTargets.length *
      talk.settings.targetDurationMinutes *
      LIVEAVATAR_FULL_CREDITS_PER_MINUTE;
    const studioIsLive = studioState === "speaking";
    const studioNeedsAudio = audioState === "blocked";
    const stageStatusKey: TranslationKey = studioIsLive
      ? "studioOnAir"
      : studioNeedsAudio
        ? "studioAudioBlockedBadge"
        : studioState === "starting"
          ? "studioConnectingBadge"
          : studioState === "ready"
            ? "studioReadyBadge"
            : run?.status === "completed"
              ? "studioRunCompletedBadge"
              : "studioPreview";
    const studioStateKey: TranslationKey =
      studioState === "starting"
        ? "studioConnecting"
        : studioState === "speaking"
          ? "studioSpeaking"
          : studioState === "ready"
            ? "studioConnected"
            : studioState === "error"
              ? "studioError"
              : "studioIdle";
    const moderatorAvatar = getStudioModeratorAvatar();
    const themeAvatarScale = studioTheme.id === "after_hours" ? 1.12 : 1;
    const moderatorMediaTransform = `translate(${moderatorAvatar.visual.offsetXPercent}%, ${moderatorAvatar.visual.offsetYPercent}%) scale(${moderatorAvatar.visual.scale * themeAvatarScale})`;
    const moderatorMediaFilter = `brightness(${moderatorAvatar.visual.brightness}) contrast(${moderatorAvatar.visual.contrast}) saturate(${moderatorAvatar.visual.saturation}) drop-shadow(0 18px 22px rgba(0,0,0,.66))`;

    return (
      <section
        className={
          isBroadcast
            ? "w-full overflow-hidden bg-[#07101d]"
            : "overflow-hidden rounded-[1.4rem] border border-slate-800 bg-[#07101d] shadow-[0_24px_80px_rgba(8,18,32,.22)]"
        }
      >
        <div className="relative aspect-video overflow-hidden bg-[#08111f]" data-testid="studio-stage">
          <div
            ref={cameraRigRef}
            className="absolute inset-0 transform-gpu transition-none"
            data-studio-shot={effectiveShot}
            data-director-cue={directorCue?.kind ?? "automatic"}
            data-camera-framing={directorCue?.framing ?? "medium"}
            data-camera-motion={cameraMotion}
            data-camera-cut={cameraCutSerial}
            style={{
              transform: cameraTransform,
              transformOrigin: `${cameraAnchor}% ${cameraVerticalAnchor}%`,
              willChange: "transform",
            }}
          >
            <Image
              src={studioTheme.image}
              alt=""
              fill
              priority
              sizes="(max-width: 1152px) 100vw, 1152px"
              className="object-cover"
              style={{
                filter:
                  effectiveShot === "close"
                    ? "brightness(.9) saturate(.92) blur(.65px)"
                    : effectiveShot === "duo"
                      ? "brightness(.94) saturate(.96) blur(.25px)"
                      : "brightness(1) saturate(1)",
              }}
            />
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_18%,transparent_0%,rgba(2,8,18,.06)_52%,rgba(2,8,18,.44)_100%)]" />
            <div
              className="absolute inset-0 transition-[background] duration-500"
              style={{
                background: `radial-gradient(circle at ${SEAT_CENTERS[framedFocusIndex] ?? 50}% 48%, rgba(34,211,238,.16), transparent 24%)`,
                opacity:
                  activeParticipantIndex !== undefined || moderatorOnCamera
                    ? 1
                    : 0,
              }}
            />

            {talk.moderator.kind === "ai" && (
              <video
                ref={moderatorVideoRef}
                muted
                autoPlay
                playsInline
                preload="auto"
                className="pointer-events-none absolute size-px opacity-0"
              />
            )}

            {talk.moderator.kind === "ai" && (
              <div
                className="absolute left-[38%] h-[63%] w-[24%] transition-all duration-200"
                style={{
                  bottom: `${studioTheme.avatarBottomPercent ?? 8}%`,
                  opacity: moderatorOnCamera ? 1 : 0,
                  transform: moderatorOnCamera
                    ? "translateY(-1.5%) scale(1.025)"
                    : "scale(.98)",
                  zIndex: 26,
                }}
                aria-hidden={!moderatorOnCamera}
              >
                <div className="absolute inset-x-[18%] bottom-[4%] h-[72%] rounded-full bg-cyan-300/24 blur-2xl" />
                <div className="absolute inset-x-[24%] bottom-[2%] h-[16%] rounded-full bg-black/45 blur-xl" />
                <div
                  className={`absolute -left-[30%] bottom-0 aspect-video w-[160%] origin-bottom transition-opacity duration-150 ${moderatorVideoReady ? "opacity-0" : "opacity-100"}`}
                  style={{
                    transform: moderatorMediaTransform,
                    filter: moderatorMediaFilter,
                  }}
                >
                  <Image
                    src={moderatorAvatar.image}
                    alt=""
                    fill
                    loading="eager"
                    sizes="40vw"
                    className="object-contain object-bottom"
                  />
                </div>
                <canvas
                  ref={moderatorCanvasRef}
                  className={`absolute -left-[30%] bottom-0 aspect-video w-[160%] origin-bottom transition-opacity duration-150 ${moderatorVideoReady ? "opacity-100" : "opacity-0"}`}
                  style={{
                    transform: moderatorMediaTransform,
                    filter: moderatorMediaFilter,
                  }}
                />
              </div>
            )}

            {talk.participants.map((participant, index) => {
              const layout = seatLayout(index);
              const avatar = studioAvatarForSeat(index);
              const isActive = activeParticipantIndex === index;
              const isTarget = targetParticipantIndex === index;
              const isLiveAvatar =
                participant.kind === "ai" && seatVideoReady[index];
              const isCamera = cameraSeat === index;
              const avatarMediaTransform = `translate(${avatar.visual.offsetXPercent}%, ${avatar.visual.offsetYPercent}%) scale(${avatar.visual.scale * themeAvatarScale})`;
              const avatarMediaFilter = `brightness(${avatar.visual.brightness}) contrast(${avatar.visual.contrast}) saturate(${avatar.visual.saturation}) drop-shadow(0 16px 18px rgba(0,0,0,.58))`;

            return (
              <div key={`${participant.name}-${index}`}>
                <div
                  className="absolute h-[63%] transition-[opacity,transform] duration-[90ms] ease-out"
                  style={{
                    ...layout,
                    bottom: `${studioTheme.avatarBottomPercent ?? 8}%`,
                  }}
                  aria-hidden={layout.opacity === 0}
                >
                  <div className="absolute inset-x-[25%] bottom-[1%] h-[13%] rounded-full bg-black/50 blur-xl" />
                  <div className="absolute inset-x-[22%] bottom-[9%] h-[64%] rounded-full bg-[radial-gradient(ellipse_at_50%_70%,rgba(103,232,249,.12),transparent_68%)] mix-blend-screen" />
                  {(isActive || isTarget) && (
                    <div className={`absolute inset-x-[23%] bottom-[8%] h-[66%] rounded-full blur-2xl ${isActive ? "bg-cyan-300/16" : "bg-amber-300/10"}`} />
                  )}

                  {participant.kind === "human" && !isCamera ? (
                    <div className="absolute inset-x-[31%] bottom-[6%] top-[10%] overflow-hidden rounded-t-full opacity-90 drop-shadow-[0_16px_24px_rgba(0,0,0,.55)]">
                      <HumanSilhouette />
                    </div>
                  ) : (
                    <div
                      className={`absolute -left-[30%] bottom-0 aspect-video w-[160%] origin-bottom transition-opacity duration-150 ${isLiveAvatar || isCamera ? "opacity-0" : "opacity-100"}`}
                      style={{
                        transform: avatarMediaTransform,
                        filter: avatarMediaFilter,
                      }}
                    >
                      <Image
                        src={avatar.image}
                        alt=""
                        fill
                        loading="eager"
                        sizes="40vw"
                        className="object-contain object-bottom"
                      />
                    </div>
                  )}

                  {participant.kind === "ai" && (
                    <>
                      <video
                        ref={(element) => {
                          avatarVideoRefs.current[index] = element;
                        }}
                        muted
                        autoPlay
                        playsInline
                        preload="auto"
                        className="pointer-events-none absolute -left-[30%] bottom-0 aspect-video w-[160%] opacity-0"
                      />
                      <canvas
                        ref={(element) => {
                          avatarCanvasRefs.current[index] = element;
                        }}
                        className={`absolute -left-[30%] bottom-0 aspect-video w-[160%] origin-bottom transition-opacity duration-150 ${isLiveAvatar ? "opacity-100" : "opacity-0"}`}
                        style={{
                          transform: avatarMediaTransform,
                          filter: avatarMediaFilter,
                        }}
                      />
                    </>
                  )}

                  {isCamera && (
                    <div className="absolute inset-x-[12%] bottom-[9%] top-[9%] overflow-hidden rounded-[18%_18%_8%_8%] border border-cyan-200/35 bg-slate-950 shadow-2xl">
                      <video
                        ref={cameraVideoRef}
                        muted
                        autoPlay
                        playsInline
                        className="h-full w-full scale-x-[-1] object-cover"
                      />
                      <span className="absolute left-2 top-2 rounded-full bg-red-600 px-2 py-1 text-[clamp(.28rem,.65vw,.5rem)] font-bold uppercase tracking-wide text-white">
                        {t("studioRemoteGuest")}
                      </span>
                    </div>
                  )}
                </div>

                {!isBroadcast && effectiveShot === "wide" && (
                  <div
                    className="absolute bottom-[4.4%] z-30 transition-all duration-500 ease-out"
                    style={{
                      left: layout.left,
                      width: layout.width,
                      opacity: layout.opacity,
                      transform: layout.transform,
                      zIndex: layout.zIndex + 20,
                    }}
                  >
                    <div className={`mx-auto w-[72%] min-w-0 rounded-md border px-[4%] py-[2.4%] text-center shadow-xl backdrop-blur-md ${isActive ? "border-cyan-300/70 bg-[#092b47]/95" : isTarget ? "border-amber-300/55 bg-[#182c42]/92" : "border-white/15 bg-[#07101d]/86"}`}>
                      <p className="truncate text-[clamp(.34rem,.85vw,.68rem)] font-bold text-white">
                        {participant.name || t("studioSeat", { number: index + 1 })}
                      </p>
                      <p className="truncate text-[clamp(.26rem,.59vw,.47rem)] text-slate-300">
                        {participant.kind === "human" ? t("studioHuman") : participant.role}
                      </p>
                    </div>
                  </div>
                )}
              </div>
              );
            })}

            {studioTheme.proceduralForeground === "midnight_arc" ? (
              <div className="pointer-events-none absolute inset-x-[2.5%] bottom-[-4%] z-[25] h-[36%]">
                <div className="absolute inset-x-[1.5%] top-0 h-[17%] rounded-[50%] border border-cyan-100/24 bg-[linear-gradient(180deg,rgba(210,244,255,.34),rgba(38,75,96,.34)_42%,rgba(5,14,25,.82))] shadow-[0_-10px_35px_rgba(34,211,238,.1),0_22px_60px_rgba(0,0,0,.55)] backdrop-blur-[3px]" />
                <div className="absolute inset-x-0 bottom-0 top-[8%] overflow-hidden rounded-[44%_44%_14%_14%/22%_22%_7%_7%] border-x border-t border-white/12 bg-[linear-gradient(180deg,rgba(19,45,65,.84),rgba(5,13,24,.96)_52%,rgba(2,7,14,.99))] shadow-[inset_0_1px_0_rgba(255,255,255,.18),0_-8px_35px_rgba(34,211,238,.08)]">
                  <div className="absolute inset-0 bg-[repeating-linear-gradient(90deg,transparent_0,transparent_3.8%,rgba(125,211,252,.045)_4%,transparent_4.3%)]" />
                  <div className="absolute inset-x-[8%] top-[12%] h-px bg-gradient-to-r from-transparent via-cyan-200/35 to-transparent" />
                  <div className="absolute left-[18%] top-[18%] h-[42%] w-[18%] rounded-full bg-cyan-400/8 blur-3xl" />
                  <div className="absolute right-[16%] top-[22%] h-[38%] w-[16%] rounded-full bg-orange-400/8 blur-3xl" />
                </div>
                {SEAT_CENTERS.map((position, index) => (
                  <div
                    key={`podcast-mic-${position}`}
                    data-podcast-mic={index}
                    className="absolute top-[-2%] h-[28%] w-[3%] transition-opacity duration-150"
                    style={{
                      left: `${position - 1.5}%`,
                      opacity:
                        effectiveShot === "wide" ||
                        index === framedFocusIndex ||
                        (effectiveShot === "duo" && index === duoCompanionIndex)
                          ? 1
                          : 0,
                    }}
                  >
                    <div
                      className="absolute left-1/2 top-[35%] h-[70%] w-px origin-top bg-slate-500/65"
                      style={{
                        transform: `rotate(${index < 2 ? -12 : index > 2 ? 12 : 0}deg)`,
                      }}
                    />
                    <div className="absolute left-1/2 top-[13%] h-[34%] w-[42%] -translate-x-1/2 rounded-full border border-slate-300/25 bg-[linear-gradient(90deg,#111827,#475569_48%,#0f172a)] shadow-[0_4px_10px_rgba(0,0,0,.45)]" />
                  </div>
                ))}
              </div>
            ) : studioTheme.foregroundImage ? (
              <div className="pointer-events-none absolute inset-0 z-[25] -translate-y-[1%]">
                <Image
                  src={studioTheme.foregroundImage}
                  alt=""
                  fill
                  priority
                  sizes="(max-width: 1152px) 100vw, 1152px"
                  className="object-cover"
                />
              </div>
            ) : studioTheme.foregroundStartPercent !== undefined ? (
              <div
                className="pointer-events-none absolute inset-0 z-[25]"
                style={{
                  clipPath: `inset(${studioTheme.foregroundStartPercent}% 0 0 0)`,
                }}
              >
                <Image
                  src={studioTheme.image}
                  alt=""
                  fill
                  priority
                  sizes="(max-width: 1152px) 100vw, 1152px"
                  className="object-cover"
                />
              </div>
            ) : (
              <div className="absolute inset-x-[-4%] bottom-[-14%] z-20 h-[31%] rounded-[50%_50%_0_0/34%_34%_0_0] border-t border-cyan-200/25 bg-[linear-gradient(180deg,rgba(30,54,73,.96),rgba(5,13,24,.99)_38%,#030811)] shadow-[0_-12px_36px_rgba(20,184,220,.12)]">
                <div className="absolute inset-x-[18%] top-[8%] h-[14%] rounded-full bg-cyan-300/10 blur-lg" />
              </div>
            )}
          </div>

          <div className="pointer-events-none absolute inset-0 z-[27] bg-[radial-gradient(circle_at_50%_42%,transparent_0%,transparent_48%,rgba(1,6,14,.18)_78%,rgba(1,5,12,.48)_100%)] mix-blend-multiply" />
          <div className="pointer-events-none absolute inset-x-0 top-0 z-[27] h-[18%] bg-gradient-to-b from-black/18 to-transparent" />

          <div
            key={cameraCutSerial}
            className="broadcast-camera-cut pointer-events-none absolute inset-0 z-[28] bg-slate-950"
            aria-hidden="true"
          />

          <div className="absolute left-[2.2%] top-[3.5%] z-40 flex items-center gap-2 rounded-full border border-white/15 bg-[#07101d]/82 px-[2.1%] py-[.8%] text-[clamp(.52rem,1vw,.92rem)] font-black tracking-[.22em] text-white shadow-lg backdrop-blur-md">
            <span className="inline-flex size-[clamp(.32rem,.72vw,.52rem)] rounded-full bg-cyan-400 shadow-[0_0_12px_#22d3ee]" />
            CONCLAVIA
          </div>
          <div
            className={`absolute right-[2.2%] top-[3.5%] z-40 flex items-center gap-1.5 rounded-full border px-[1.8%] py-[.75%] text-[clamp(.48rem,.9vw,.82rem)] font-bold uppercase tracking-[.18em] text-white shadow-lg ${studioIsLive ? "border-red-400/30 bg-red-600/90" : studioNeedsAudio ? "border-amber-300/40 bg-amber-500/90" : "border-cyan-200/25 bg-[#12314c]/90"}`}
            data-studio-status={stageStatusKey}
          >
            <span className={`size-[clamp(.28rem,.6vw,.44rem)] rounded-full ${studioIsLive ? "animate-pulse bg-white" : studioNeedsAudio ? "bg-amber-100" : "bg-cyan-300"}`} />
            {t(stageStatusKey)}
          </div>

          {(studioState !== "idle" || runControlActive) && (
            <div
              className={`absolute right-[2.2%] top-[12%] z-50 flex flex-col items-end gap-2 ${isBroadcast ? "opacity-0 transition-opacity hover:opacity-100 focus-within:opacity-100" : ""}`}
            >
              {studioNeedsAudio && (
                <button
                  type="button"
                  onClick={() => void activateStudioAudio()}
                  className="rounded-full border border-amber-200/50 bg-amber-400 px-3 py-1.5 text-[clamp(.36rem,.78vw,.62rem)] font-bold text-slate-950 shadow-lg transition hover:bg-amber-300"
                >
                  {t("studioEnableAudio")}
                </button>
              )}
              <button
                type="button"
                onClick={() => void requestStopStudio()}
                className="rounded-full border border-red-300/40 bg-red-600/95 px-3 py-1.5 text-[clamp(.36rem,.78vw,.62rem)] font-bold text-white shadow-lg transition hover:bg-red-500"
              >
                {t("studioStopLive")}
              </button>
            </div>
          )}

          {!isBroadcast && showBroadcastContext && currentThread && !phaseStinger && (
            <div className="absolute left-1/2 top-[4%] z-30 max-w-[46%] -translate-x-1/2 truncate rounded-full border border-white/10 bg-slate-950/68 px-[2%] py-[.7%] text-center text-[clamp(.46rem,.82vw,.8rem)] font-semibold text-slate-100 shadow-lg backdrop-blur-md">
              {currentThread}
            </div>
          )}

          {phaseStinger && (
            <div className="broadcast-stinger absolute inset-0 z-50 overflow-hidden bg-[#050b15] text-center text-white shadow-[0_24px_80px_rgba(0,0,0,.55)]">
              <Image
                src="/studio/conclavia-broadcast-bumper-v1.webp"
                alt=""
                fill
                priority
                sizes="100vw"
                className="object-cover opacity-90"
              />
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_48%,transparent_0%,rgba(3,8,18,.12)_42%,rgba(3,8,18,.6)_100%)]" />
              <div className="absolute inset-0 flex flex-col items-center justify-center px-[12%]">
                <p className="text-[clamp(.34rem,.78vw,.72rem)] font-black uppercase tracking-[.32em] text-cyan-300">
                  CONCLAVIA · {t("studioNextChapter")}
                </p>
                <p className="mt-[1.2%] text-[clamp(1rem,3.2vw,3.4rem)] font-black tracking-[-.035em]">
                  {t(arcPhaseKey(phaseStinger))}
                </p>
                <div className="mt-[2%] h-px w-[22%] bg-gradient-to-r from-transparent via-cyan-300 to-transparent" />
              </div>
            </div>
          )}

          {audienceCard && !phaseStinger && (
            <div
              key={"id" in audienceCard ? audienceCard.id : audienceCard.messageId}
              className="broadcast-audience-card pointer-events-none absolute bottom-[30%] left-[4%] z-[48] max-w-[54%] overflow-hidden rounded-xl border border-white/15 bg-[#050b15]/94 text-white shadow-[0_20px_64px_rgba(0,0,0,.58)] backdrop-blur-lg"
            >
              <div className="flex items-stretch">
                <div className="w-[.42rem] shrink-0 bg-red-600" />
                <div className="flex min-w-0 items-start gap-[clamp(.6rem,1.1vw,1rem)] px-[clamp(.75rem,1.5vw,1.35rem)] py-[clamp(.65rem,1.15vw,1.05rem)]">
                  <div
                    className="mt-[.1rem] flex size-[clamp(1.8rem,3.2vw,3rem)] shrink-0 items-center justify-center rounded-full border border-white/20 bg-slate-700 bg-cover bg-center text-[clamp(.58rem,1vw,.9rem)] font-black uppercase"
                    style={
                      audienceCard.authorImageUrl
                        ? {
                            backgroundImage: `url(${JSON.stringify(audienceCard.authorImageUrl)})`,
                          }
                        : undefined
                    }
                  >
                    {!audienceCard.authorImageUrl && audienceCard.authorName.slice(0, 1)}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-red-600 px-[.48em] py-[.2em] text-[clamp(.42rem,.65vw,.68rem)] font-black uppercase tracking-[.13em]">
                        YouTube · {t("audienceOnAir")}
                      </span>
                      <span className="truncate text-[clamp(.54rem,.82vw,.86rem)] font-bold text-slate-200">
                        @{audienceCard.authorName}
                      </span>
                    </div>
                    <p className="mt-[.45em] line-clamp-3 text-[clamp(.68rem,1.15vw,1.2rem)] font-semibold leading-[1.32] text-white">
                      “{audienceCard.content}”
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {currentSpeaker && showBroadcastContext && !runCompleted && (
            <div
              key={`${programmeMessage?.sequence ?? "plan"}-${currentSpeaker}-${reactionPreviewIndex ?? "speaker"}`}
              className="broadcast-lower-third absolute bottom-[23%] left-[4%] z-40 flex max-w-[58%] items-stretch overflow-hidden rounded-r-lg border border-white/12 bg-[#050b15]/92 text-white shadow-[0_16px_48px_rgba(0,0,0,.46)] backdrop-blur-md"
              style={{
                borderLeftColor:
                  SEAT_ACCENTS[
                    reactionPreviewIndex ?? activeParticipantIndex ?? 0
                  ],
                borderLeftWidth: "clamp(4px,.45vw,8px)",
              }}
            >
              <div className="flex min-w-0 items-center gap-[clamp(.45rem,1.1vw,1.1rem)] px-[2.2vw] py-[.9vw]">
                <div
                  className="flex h-[clamp(1.4rem,2.4vw,2.6rem)] shrink-0 items-center gap-[clamp(2px,.22vw,4px)] rounded-md border border-cyan-300/15 bg-cyan-300/8 px-[clamp(.35rem,.55vw,.65rem)]"
                  aria-hidden="true"
                >
                  {[0, 1, 2, 3].map((bar) => (
                    <span
                      key={bar}
                      className={`h-[58%] w-[clamp(2px,.2vw,4px)] origin-bottom rounded-full bg-cyan-300 ${broadcastAudioState === "speaking" || studioState === "speaking" ? "broadcast-audio-meter-bar" : "scale-y-[.28]"}`}
                      style={{ animationDelay: `${bar * 90}ms` }}
                    />
                  ))}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-[.7vw]">
                    {(reactionPreviewIndex !== undefined || currentIntent) && (
                      <span className="shrink-0 rounded bg-cyan-400/14 px-[.55vw] py-[.22vw] text-[clamp(.44rem,.62vw,.72rem)] font-black uppercase tracking-[.14em] text-cyan-200">
                        {reactionPreviewIndex !== undefined
                          ? t("studioReaction")
                          : currentIntent
                            ? t(intentKey(currentIntent))
                            : null}
                      </span>
                    )}
                    {currentTargetName && reactionPreviewIndex === undefined && (
                      <span className="truncate text-[clamp(.44rem,.65vw,.76rem)] font-semibold text-slate-400">
                        {t("studioAddressing", { name: currentTargetName })}
                      </span>
                    )}
                  </div>
                  <p className="mt-[.28vw] truncate text-[clamp(.82rem,1.42vw,1.65rem)] font-black leading-none tracking-tight">
                    {currentSpeaker}
                  </p>
                  {(currentRole || currentThread) && (
                    <p className="mt-[.34vw] truncate text-[clamp(.5rem,.76vw,.9rem)] font-medium text-slate-300">
                      {[currentRole, currentThread].filter(Boolean).join(" · ")}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {visibleCaption && (
            <div
              key={`${onAirMessage?.sequence ?? "stream"}-${captionIndex}`}
              className="broadcast-caption absolute inset-x-[12%] bottom-[3.8%] z-50 px-[2.4%] py-[.8%] text-center text-[clamp(.78rem,1.52vw,1.7rem)] font-bold leading-[1.26] tracking-[-.012em] text-white"
            >
              <p className="mx-auto max-w-[48ch] rounded-md bg-black/82 px-[1.15em] py-[.42em] shadow-[0_8px_32px_rgba(0,0,0,.5)] backdrop-blur-sm">
                {visibleCaption}
              </p>
            </div>
          )}

          {runCompleted && run?.discussionState.conclusion && (
            <div className="absolute inset-0 z-50 overflow-hidden bg-[#050b15] text-center text-white">
              <Image
                src="/studio/conclavia-broadcast-bumper-v1.webp"
                alt=""
                fill
                priority
                sizes="100vw"
                className="object-cover opacity-80"
              />
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,transparent_0%,rgba(3,8,18,.16)_44%,rgba(3,8,18,.68)_100%)]" />
              <div className="absolute inset-0 flex flex-col items-center justify-center px-[14%]">
                <p className="text-[clamp(.34rem,.76vw,.7rem)] font-black uppercase tracking-[.26em] text-cyan-300">
                  CONCLAVIA · {t("runnerConclusionTitle")}
                </p>
                <p className="mt-[1.5%] line-clamp-4 max-w-[44ch] text-[clamp(.72rem,1.75vw,1.9rem)] font-semibold leading-[1.28] tracking-[-.02em]">
                  {run.discussionState.conclusion.answer}
                </p>
                <div className="mt-[2.2%] h-px w-[18%] bg-gradient-to-r from-transparent via-cyan-300 to-transparent" />
                <p className="mt-[1.2%] text-[clamp(.28rem,.58vw,.55rem)] font-bold uppercase tracking-[.24em] text-slate-400">
                  {talk.title}
                </p>
              </div>
            </div>
          )}
        </div>

        {!isBroadcast && (
          <div className="border-t border-white/10 bg-[#0a1422] p-4 text-slate-100 sm:p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[.16em] text-cyan-300">
                      {t("studioDirector")}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-slate-400">
                      {t("studioDirectorHelp")}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap justify-end gap-2">
                    <span
                      className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${
                        usesCreatorDirection
                          ? "bg-fuchsia-400/15 text-fuchsia-200"
                          : "bg-slate-200/10 text-slate-300"
                      }`}
                    >
                      {t(
                        usesCreatorDirection
                          ? "studioDirectionCreator"
                          : "studioDirectionEditorial",
                      )}
                    </span>
                    <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-slate-300">
                      {t(studioStateKey)}
                    </span>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-4 gap-1 rounded-xl border border-white/10 bg-black/20 p-1">
                  {(["auto", "wide", "close", "duo"] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      aria-pressed={shotMode === mode}
                      onClick={() => setShotMode(mode)}
                      className={`min-h-10 rounded-lg px-2 py-2 text-[11px] font-semibold transition ${shotMode === mode ? "bg-cyan-400 text-slate-950" : "text-slate-400 hover:bg-white/5 hover:text-white"}`}
                    >
                      {t(
                        mode === "auto"
                          ? "studioShotAuto"
                          : mode === "wide"
                            ? "studioShotWide"
                            : mode === "close"
                              ? "studioShotClose"
                              : "studioShotDuo",
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {firstHumanSeat >= 0 && (
                <button
                  type="button"
                  onClick={() => void toggleCamera()}
                  className="flex min-h-11 items-center justify-between gap-8 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-left text-xs font-semibold transition hover:bg-white/10 lg:min-w-52"
                >
                  <span>
                    {cameraSeat === null
                      ? t("studioStartCamera")
                      : t("studioStopCamera")}
                  </span>
                  <span
                    className={`size-2 rounded-full ${cameraSeat === null ? "bg-slate-600" : "bg-emerald-400"}`}
                  />
                </button>
              )}
            </div>
            {cameraError && (
              <p className="mt-2 text-xs text-red-300">{cameraError}</p>
            )}

          <details className="mt-4 overflow-hidden rounded-xl border border-white/10 bg-black/15">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-xs font-semibold text-slate-300">
              <span>{t("studioLiveSystem")}</span>
              <span className="flex items-center gap-2 font-normal text-slate-500">
                <span>{connectedCount}/{liveTargets.length}</span>
                {status?.creditsLeft !== undefined && (
                  <span className="text-emerald-300">
                    {t("studioCredits", {
                      credits: status.creditsLeft.toLocaleString(locale, {
                        maximumFractionDigits: 1,
                      }),
                    })}
                  </span>
                )}
                <span aria-hidden="true">⌄</span>
              </span>
            </summary>
            <div className="border-t border-white/10 p-4">
              <p className="text-xs leading-5 text-slate-400">
                {t("studioLiveSystemHelp")}
              </p>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center text-[11px]">
                <div className="rounded-lg border border-white/10 bg-black/15 p-2">
                  <span className="block font-bold text-white">{connectedCount}/{liveTargets.length}</span>
                  <span className="text-slate-500">{t("studioConnectedAvatars")}</span>
                </div>
                <div className="rounded-lg border border-white/10 bg-black/15 p-2">
                  <span className="block font-bold text-white">{talk.settings.targetDurationMinutes} min</span>
                  <span className="text-slate-500">{t("targetDuration")}</span>
                </div>
                <div className="rounded-lg border border-white/10 bg-black/15 p-2">
                  <span className="block font-bold text-white">≈ {estimatedCredits}</span>
                  <span className="text-slate-500">{t("studioEstimatedCredits")}</span>
                </div>
              </div>
              {timingMetrics.samples > 0 && (
                <div className="mt-2 grid grid-cols-2 gap-2 text-center text-[11px]">
                  <div className="rounded-lg border border-cyan-300/15 bg-cyan-300/5 p-2">
                    <span className="block font-bold text-cyan-200">
                      {timingMetrics.startupMs === undefined
                        ? "—"
                        : `${(timingMetrics.startupMs / 1_000).toFixed(2)} s`}
                    </span>
                    <span className="text-slate-500">{t("studioVoiceStartup")}</span>
                  </div>
                  <div className="rounded-lg border border-cyan-300/15 bg-cyan-300/5 p-2">
                    <span className="block font-bold text-cyan-200">
                      {timingMetrics.handoffMs === undefined
                        ? "—"
                        : `${(timingMetrics.handoffMs / 1_000).toFixed(2)} s`}
                    </span>
                    <span className="text-slate-500">{t("studioVoiceHandoff")}</span>
                  </div>
                </div>
              )}
              <div className="mt-3 flex flex-wrap gap-1.5">
                {liveTargets.map((target) => {
                  const targetState =
                    target.participantIndex === undefined
                      ? moderatorLiveState
                      : seatStates[target.participantIndex];
                  return (
                    <span
                      key={target.key}
                      className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-black/15 px-2 py-1 text-[10px] text-slate-300"
                    >
                      <span
                        className={`size-1.5 rounded-full ${targetState === "speaking" ? "animate-pulse bg-red-400" : targetState === "ready" ? "bg-emerald-400" : targetState === "connecting" ? "animate-pulse bg-amber-300" : targetState === "error" ? "bg-red-500" : "bg-slate-600"}`}
                      />
                      {target.label}
                    </span>
                  );
                })}
              </div>
              {audioState === "blocked" && (
                <button
                  type="button"
                  onClick={() => void activateStudioAudio()}
                  className="mt-3 w-full rounded-lg bg-amber-400 px-3 py-2.5 text-xs font-bold text-slate-950 transition hover:bg-amber-300"
                >
                  {t("studioEnableAudio")}
                </button>
              )}
              {!status?.configured && status && (
                <p className="mt-3 text-xs text-amber-300">{t("studioNotConfigured")}</p>
              )}
              {liveTargets.length > MAX_CONCURRENT_LIVEAVATARS && (
                <p className="mt-3 text-xs text-amber-300">
                  {t("studioSpeakerLimit", {
                    current: liveTargets.length,
                    maximum: MAX_CONCURRENT_LIVEAVATARS,
                  })}
                </p>
              )}
              {studioError && <p className="mt-3 text-xs text-red-300">{studioError}</p>}
              <label className="mt-3 flex items-center gap-3 text-[11px] text-slate-400">
                <span>{t("studioVolume")}</span>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={volume}
                  onChange={(event) => {
                    const nextVolume = Number(event.target.value);
                    setVolume(nextVolume);
                    const gain = audioGraphRef.current?.gain;
                    if (gain) gain.gain.setTargetAtTime(nextVolume, gain.context.currentTime, 0.01);
                    for (const managed of sessionsRef.current.values()) {
                      managed.video.volume = 0;
                      managed.video.muted = true;
                    }
                  }}
                  className="min-w-0 flex-1 accent-cyan-300"
                />
                <span>{Math.round(volume * 100)}%</span>
              </label>
            </div>
            </details>
          </div>
        )}
      </section>
    );
  },
);
