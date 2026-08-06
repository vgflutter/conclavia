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
import { getStudioAvatar } from "@/lib/liveavatar-catalog";
import {
  startChromaKey,
  type ChromaKeyPipeline,
} from "@/lib/chroma-key";
import { getStudioTheme } from "@/lib/studio-themes";
import type { TalkResponse } from "@/types/talk";
import type {
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
  label: string;
}

interface ManagedSession {
  key: string;
  sessionId: string;
  participantIndex?: number;
  session: LiveAvatarSession;
  video: HTMLVideoElement;
  expiresAt: number;
  currentMessage?: TalkRunMessageResponse;
  finishSpeech?: (error?: Error) => void;
  speechTimer?: number;
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

// Seat centres in the shared studio backgrounds are approximately
// 17%, 33%, 50%, 67%, and 84% of the stage width.
const BASE_POSITIONS = [5, 21, 38, 55, 72];
const LIVEAVATAR_FULL_CREDITS_PER_MINUTE = 2;
const MAX_CONCURRENT_LIVEAVATARS = 5;

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
    const [activeLiveParticipant, setActiveLiveParticipant] = useState<number>();
    const [cameraSeat, setCameraSeat] = useState<number | null>(null);
    const [cameraError, setCameraError] = useState<string | null>(null);
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
    const cameraVideoRef = useRef<HTMLVideoElement | null>(null);
    const cameraStreamRef = useRef<MediaStream | null>(null);

    const latestMessage = run?.messages.at(-1);
    const showBroadcastContext =
      studioState !== "idle" ||
      runControlActive ||
      broadcastAudioState !== "idle";
    const onAirMessage =
      broadcastAudioState === "speaking" ? broadcastMessage : undefined;
    const currentTurn = activePlan ?? run?.activeTurn;
    const runCompleted = run?.status === "completed" && !runControlActive;
    const activeParticipantIndex = runCompleted || !showBroadcastContext
      ? undefined
      : onAirMessage?.speakerType === "participant"
        ? onAirMessage.participantIndex
        : activeLiveParticipant ??
          (currentTurn?.speakerType === "participant"
            ? currentTurn.participantIndex
            : latestMessage?.speakerType === "participant"
              ? latestMessage.participantIndex
              : undefined);
    const targetParticipantIndex = runCompleted || !showBroadcastContext
      ? undefined
      : onAirMessage?.targetParticipantIndex ??
        currentTurn?.targetParticipantIndex ??
        latestMessage?.targetParticipantIndex;
    const currentIntent = showBroadcastContext
      ? onAirMessage?.intent ?? currentTurn?.intent ?? latestMessage?.intent
      : undefined;
    const currentThread = showBroadcastContext
      ? onAirMessage?.threadLabel ||
        currentTurn?.threadLabel ||
        latestMessage?.threadLabel ||
        run?.discussionState.currentFocus ||
        talk.topic
      : talk.topic;
    const currentSpeaker = showBroadcastContext
      ? onAirMessage?.speakerName ??
        currentTurn?.speakerName ??
        latestMessage?.speakerName
      : undefined;
    const visibleCaption = showBroadcastContext
      ? onAirMessage?.content || streamingContent || latestMessage?.content || ""
      : "";
    const firstHumanSeat = talk.participants.findIndex(
      (participant) => participant.kind === "human",
    );
    const effectiveShot: Exclude<ShotMode, "auto"> =
      shotMode !== "auto"
        ? shotMode
        : runCompleted || activeParticipantIndex === undefined
          ? "wide"
          : targetParticipantIndex !== undefined &&
              currentIntent !== "opening" &&
              currentIntent !== "closing" &&
              currentIntent !== "moderation"
            ? "duo"
            : currentIntent === "opening" ||
                currentIntent === "closing" ||
                currentIntent === "moderation"
              ? "wide"
              : "close";

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
        return [
          {
            key: `participant:${index}`,
            participantIndex: index,
            sex: participant.sex,
            avatarId: avatar.id,
            label: participant.name,
          } satisfies SpeakerTarget,
        ];
      });

      if (talk.moderator.kind !== "ai") return participants;
      const moderatorAvatar = getStudioAvatar(0, "male");
      return [
        ...participants,
        {
          key: "moderator",
          sex: "male",
          avatarId: moderatorAvatar.id,
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

    async function activateStudioAudio(): Promise<boolean> {
      const videos = Array.from(sessionsRef.current.values()).map(
        (managed) => managed.video,
      );
      if (videos.length === 0) {
        setAudioState("idle");
        return true;
      }

      let blocked = false;
      let liveAudioTracks = 0;
      await Promise.all(
        videos.map(async (video) => {
          video.muted = false;
          video.volume = volume;
          try {
            await video.play();
            const stream = video.srcObject;
            if (
              stream instanceof MediaStream &&
              stream
                .getAudioTracks()
                .some((track) => track.enabled && track.readyState === "live")
            ) {
              liveAudioTracks += 1;
            }
          } catch {
            blocked = true;
          }
        }),
      );
      if (sessionsRef.current.size === 0) {
        setAudioState("idle");
        return true;
      }
      setAudioState(blocked ? "blocked" : liveAudioTracks > 0 ? "playing" : "waiting");
      return !blocked;
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
    }

    function releaseMediaElements() {
      for (const pipeline of chromaCleanupRefs.current.values()) pipeline.stop();
      chromaCleanupRefs.current.clear();
      for (const video of avatarVideoRefs.current) {
        if (!video) continue;
        video.pause();
        video.srcObject = null;
      }
      const moderatorVideo = moderatorVideoRef.current;
      if (moderatorVideo) {
        moderatorVideo.pause();
        moderatorVideo.srcObject = null;
      }
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
        setModeratorLiveState("connecting");
      }
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
      startPromiseRef.current = null;
      sdkRef.current = null;
      stoppingRef.current = false;

      if (updateInterface) {
        setStudioState("idle");
        setAudioState("idle");
        setActiveLiveParticipant(undefined);
        setSeatStates(talk.participants.map(() => "offline"));
        setSeatVideoReady(talk.participants.map(() => false));
        setModeratorLiveState("offline");
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
        session.attach(video);
        video.muted = false;
        video.volume = volume;
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
              if (
                effectiveShot === "close" &&
                target.participantIndex === activeParticipantIndex
              ) {
                pipeline.resize(1280, 720);
              } else if (
                effectiveShot === "duo" &&
                (target.participantIndex === activeParticipantIndex ||
                  target.participantIndex === targetParticipantIndex)
              ) {
                pipeline.resize(960, 540);
              } else if (
                isBroadcast &&
                target.participantIndex === activeParticipantIndex
              ) {
                pipeline.resize(800, 450);
              }
              chromaCleanupRefs.current.set(target.participantIndex, pipeline);
            } catch {
              setStudioError(t("studioChromaError"));
            }
          }
        }
      });
      session.on(sdk.AgentEventsEnum.AVATAR_SPEAK_STARTED, () => {
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
        if (stoppingRef.current) return;
        if (target.participantIndex !== undefined) {
          setSeatState(
            target.participantIndex,
            interruptedSpeech ? "error" : "offline",
          );
          setSeatVideoIsReady(target.participantIndex, false);
        } else {
          setModeratorLiveState(interruptedSpeech ? "error" : "offline");
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

    async function startLiveStudio(): Promise<void> {
      if (studioState === "ready" || studioState === "speaking") return;
      if (startPromiseRef.current) return startPromiseRef.current;

      const startPromise = (async () => {
        setStudioError(null);
        setStudioState("starting");
        setAudioState("idle");
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
        sdkRef.current = await import("@heygen/liveavatar-web-sdk");
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
      const existing = sessionsRef.current.get(target.key);
      if (existing) {
        const hasEnoughLifetime = existing.expiresAt - Date.now() > 60_000;
        if (hasEnoughLifetime || existing.currentMessage) return;
        await retireManagedSession(existing);
      }

      const existingPromise = sessionStartPromisesRef.current.get(target.key);
      if (existingPromise) return existingPromise;
      const sdk = sdkRef.current;
      if (!sdk) throw new Error(t("studioSpeakerUnavailable"));

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
      if (message.participantIndex !== undefined) {
        setActiveLiveParticipant(message.participantIndex);
      }
      managed.video.muted = false;
      managed.video.volume = volume;
      try {
        await managed.video.play();
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
          if (error) {
            onBroadcastStateChange?.("error", message);
            reject(error);
            return;
          }
          setStudioState("ready");
          setActiveLiveParticipant(undefined);
          onBroadcastStateChange?.("idle");
          resolve();
        };
        managed.finishSpeech = finish;
        managed.speechTimer = window.setTimeout(
          () => finish(new Error(t("studioSpeechTimeout"))),
          Math.max(30_000, Math.min(120_000, wordCount * 1_100)),
        );
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
      const framedFocusIndex = focusIndex ?? 0;
      if (effectiveShot === "close") {
        return index === framedFocusIndex
          ? {
              left: "29%",
              width: "42%",
              opacity: 1,
              transform: "translateY(-1.5%) scale(1.02)",
              zIndex: 24,
            }
          : {
              left: `${BASE_POSITIONS[index]}%`,
              width: "28%",
              opacity: 0,
              transform: "scale(.9)",
              zIndex: 10,
            };
      }
      if (effectiveShot === "duo") {
        const companion =
          targetParticipantIndex !== undefined &&
          targetParticipantIndex !== framedFocusIndex
            ? targetParticipantIndex
            : (framedFocusIndex + 1) % talk.participants.length;
        if (index === framedFocusIndex) {
          return {
            left: "18%",
            width: "34%",
            opacity: 1,
            transform: "scale(1.02)",
            zIndex: 24,
          };
        }
        if (index === companion) {
          return {
            left: "49%",
            width: "34%",
            opacity: 1,
            transform: "scale(1.02)",
            zIndex: 22,
          };
        }
        return {
          left: `${BASE_POSITIONS[index]}%`,
          width: "28%",
          opacity: 0,
          transform: "scale(.9)",
          zIndex: 10,
        };
      }

      const isFocused = focusIndex === index;
      const isTarget = targetParticipantIndex === index;
      return {
        left: `${BASE_POSITIONS[index]}%`,
        width: "24%",
        opacity: isFocused ? 1 : isTarget ? 0.96 : 0.86,
        transform: isFocused
          ? "translateY(-2%) scale(1.055)"
          : isTarget
            ? "translateY(-.75%) scale(1.015)"
            : "scale(.98)",
        zIndex: isFocused ? 24 : isTarget ? 18 : 10,
      };
    }

    useEffect(() => {
      const duoCompanion =
        activeParticipantIndex !== undefined
          ? targetParticipantIndex !== undefined &&
            targetParticipantIndex !== activeParticipantIndex
            ? targetParticipantIndex
            : (activeParticipantIndex + 1) % talk.participants.length
          : undefined;

      for (const [index, pipeline] of chromaCleanupRefs.current) {
        if (effectiveShot === "close" && index === activeParticipantIndex) {
          pipeline.resize(1280, 720);
        } else if (
          effectiveShot === "duo" &&
          (index === activeParticipantIndex || index === duoCompanion)
        ) {
          pipeline.resize(960, 540);
        } else if (isBroadcast && index === activeParticipantIndex) {
          pipeline.resize(800, 450);
        } else {
          pipeline.resize(640, 360);
        }
      }
    }, [
      activeParticipantIndex,
      effectiveShot,
      isBroadcast,
      talk.participants.length,
      targetParticipantIndex,
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
        for (const video of avatarVideos) {
          if (!video) continue;
          video.pause();
          video.srcObject = null;
        }
        if (moderatorVideo) {
          moderatorVideo.pause();
          moderatorVideo.srcObject = null;
        }
        cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
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
    const studioTheme = getStudioTheme(talk.settings.studioTheme);

    return (
      <section
        className={
          isBroadcast
            ? "w-full overflow-hidden bg-[#07101d]"
            : "overflow-hidden rounded-[1.4rem] border border-slate-800 bg-[#07101d] shadow-[0_24px_80px_rgba(8,18,32,.22)]"
        }
      >
        <div className="relative aspect-video overflow-hidden bg-[#08111f]" data-testid="studio-stage">
          <Image
            src={studioTheme.image}
            alt=""
            fill
            priority
            sizes="(max-width: 1152px) 100vw, 1152px"
            className="object-cover"
          />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_18%,transparent_0%,rgba(2,8,18,.06)_52%,rgba(2,8,18,.44)_100%)]" />

          <div className="absolute left-[2.2%] top-[3.5%] z-40 flex items-center gap-2 rounded-full border border-white/15 bg-[#07101d]/75 px-[2.1%] py-[.8%] text-[clamp(.38rem,1vw,.72rem)] font-black tracking-[.22em] text-white shadow-lg backdrop-blur-md">
            <span className="inline-flex size-[clamp(.32rem,.72vw,.52rem)] rounded-full bg-cyan-400 shadow-[0_0_12px_#22d3ee]" />
            CONCLAVIA
          </div>
          <div
            className={`absolute right-[2.2%] top-[3.5%] z-40 flex items-center gap-1.5 rounded-full border px-[1.8%] py-[.75%] text-[clamp(.36rem,.9vw,.66rem)] font-bold uppercase tracking-[.18em] text-white shadow-lg ${studioIsLive ? "border-red-400/30 bg-red-600/90" : studioNeedsAudio ? "border-amber-300/40 bg-amber-500/90" : "border-cyan-200/25 bg-[#12314c]/90"}`}
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

          {talk.moderator.kind !== "none" && (
            <div className="absolute left-1/2 top-[4%] z-30 max-w-[45%] -translate-x-1/2 truncate rounded-full border border-white/10 bg-slate-950/60 px-[2%] py-[.7%] text-center text-[clamp(.34rem,.82vw,.62rem)] font-semibold text-slate-200 backdrop-blur">
              {t("studioHostedBy", { name: talk.moderator.name || t("moderation") })}
            </div>
          )}

          {talk.moderator.kind === "ai" && (
            <video
              ref={moderatorVideoRef}
              autoPlay
              playsInline
              preload="auto"
              className="pointer-events-none absolute size-px opacity-0"
            />
          )}

          {talk.participants.map((participant, index) => {
            const layout = seatLayout(index);
            const avatar = studioAvatarForSeat(index);
            const isActive = activeParticipantIndex === index;
            const isTarget = targetParticipantIndex === index;
            const isLiveAvatar =
              participant.kind === "ai" && seatVideoReady[index];
            const isCamera = cameraSeat === index;

            return (
              <div key={`${participant.name}-${index}`}>
                <div
                  className="absolute h-[63%] transition-all duration-500 ease-out"
                  style={{
                    ...layout,
                    bottom: `${studioTheme.avatarBottomPercent ?? 8}%`,
                  }}
                  aria-hidden={layout.opacity === 0}
                >
                  {(isActive || isTarget) && (
                    <div className={`absolute inset-x-[20%] bottom-[7%] h-[72%] rounded-full blur-2xl ${isActive ? "bg-cyan-300/30" : "bg-amber-300/18"}`} />
                  )}

                  {participant.kind === "human" && !isCamera ? (
                    <div className="absolute inset-x-[31%] bottom-[6%] top-[10%] overflow-hidden rounded-t-full opacity-90 drop-shadow-[0_16px_24px_rgba(0,0,0,.55)]">
                      <HumanSilhouette />
                    </div>
                  ) : (
                    <div
                      className={`absolute -left-[30%] bottom-0 aspect-video w-[160%] drop-shadow-[0_18px_20px_rgba(0,0,0,.62)] transition-opacity duration-500 ${isLiveAvatar || isCamera ? "opacity-0" : "opacity-100"}`}
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
                        autoPlay
                        playsInline
                        preload="auto"
                        className="pointer-events-none absolute -left-[30%] bottom-0 aspect-video w-[160%] opacity-0"
                      />
                      <canvas
                        ref={(element) => {
                          avatarCanvasRefs.current[index] = element;
                        }}
                        className={`absolute -left-[30%] bottom-0 aspect-video w-[160%] drop-shadow-[0_18px_20px_rgba(0,0,0,.62)] transition-opacity duration-500 ${isLiveAvatar ? "opacity-100" : "opacity-0"}`}
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

                {!isBroadcast && (
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

          {studioTheme.foregroundStartPercent !== undefined ? (
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

          <div className="absolute bottom-[15.5%] left-1/2 z-40 flex max-w-[76%] -translate-x-1/2 items-center gap-[clamp(.3rem,1vw,.7rem)] rounded-lg border border-white/10 bg-[#050b15]/82 px-[2%] py-[1%] text-white shadow-2xl backdrop-blur-md">
            {currentIntent && (
              <span className="shrink-0 rounded bg-cyan-400/15 px-2 py-1 text-[clamp(.3rem,.7vw,.55rem)] font-bold uppercase tracking-[.12em] text-cyan-200">
                {t(intentKey(currentIntent))}
              </span>
            )}
            <div className="min-w-0">
              {currentSpeaker && (
                <p className="truncate text-[clamp(.34rem,.78vw,.6rem)] font-semibold text-white">
                  {currentSpeaker}
                </p>
              )}
              <p className="truncate text-[clamp(.28rem,.68vw,.54rem)] text-slate-300">
                {currentThread}
              </p>
            </div>
          </div>

          {visibleCaption && (
            <div className="absolute inset-x-[14%] bottom-[3.5%] z-50 rounded-md bg-black/78 px-[2.4%] py-[.75%] text-center text-[clamp(.34rem,.86vw,.72rem)] font-medium leading-snug text-white shadow-2xl backdrop-blur-sm">
              <p className="line-clamp-2">{visibleCaption}</p>
            </div>
          )}

          {runCompleted && run?.discussionState.conclusion && (
            <div className="absolute inset-x-[17%] bottom-[18%] z-50 rounded-xl border border-cyan-200/25 bg-[#06111f]/92 px-[3%] py-[2%] text-center text-white shadow-2xl backdrop-blur-lg">
              <p className="text-[clamp(.34rem,.72vw,.62rem)] font-black uppercase tracking-[.2em] text-cyan-300">
                {t("runnerConclusionTitle")}
              </p>
              <p className="mt-[1%] line-clamp-3 text-[clamp(.46rem,1.15vw,1rem)] font-semibold leading-relaxed">
                {run.discussionState.conclusion.answer}
              </p>
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
                <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-slate-300">
                  {t(studioStateKey)}
                </span>
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
                  {cameraSeat === null ? t("studioStartCamera") : t("studioStopCamera")}
                </span>
                <span
                  className={`size-2 rounded-full ${cameraSeat === null ? "bg-slate-600" : "bg-emerald-400"}`}
                />
              </button>
            )}
          </div>
          {cameraError && <p className="mt-2 text-xs text-red-300">{cameraError}</p>}

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
                    for (const managed of sessionsRef.current.values()) {
                      managed.video.volume = nextVolume;
                      managed.video.muted = nextVolume === 0;
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
