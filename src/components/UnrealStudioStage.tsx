"use client";

import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useTranslations } from "@/i18n/I18nProvider";
import {
  type StudioStageHandle,
  type StudioStageProps,
} from "@/components/StudioStage";
import type { TalkRunMessageResponse } from "@/types/talk-run";
import { UnrealSpeechPlayer } from "@/lib/unreal-speech-player";
import { getUnrealVoice, unrealVoicePrompt } from "@/lib/unreal-voices";
import {
  unrealExpressionDiagnostic,
  unrealPerformancePlan,
  type UnrealExpressionDiagnostic,
} from "@/lib/unreal-performance-plan";

type UnrealStageState = "idle" | "starting" | "ready" | "error";
type UnrealServerState =
  | "checking"
  | "off"
  | "booting"
  | "online"
  | "ready"
  | "stopping"
  | "error"
  | "unknown";
type UnrealShot =
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

interface CinematicCut {
  atMs: number;
  shot: UnrealShot;
}

interface UnrealSessionResponse {
  playerUrl?: string;
  error?: string;
  health?: {
    commercialLipSyncReady?: boolean;
    runtimeRevision?: string;
  };
}

interface UnrealExpressionHealth {
  performanceMood?: string;
  performanceTargetIntensity?: number;
  commercialMood?: string;
  commercialMoodIntensity?: number;
  commercialControlCount?: number;
  commercialMaxUpperFaceControl?: number;
  commercialMaxUpperFaceControlName?: string;
  commercialSpeechPeakUpperFaceControl?: number;
  commercialSpeechPeakUpperFaceControlName?: string;
}

interface UnrealStatusResponse {
  available?: boolean;
  serverStatus?: Exclude<UnrealServerState, "checking">;
  health?: UnrealExpressionHealth;
}

interface UnrealExpressionAudit extends UnrealExpressionDiagnostic {
  solverMood?: string;
  solverIntensity?: number;
  controlCount?: number;
  upperFaceValue?: number;
  upperFaceControl?: string;
}

interface UnrealPlayerMessage {
  type?: string;
  audioReady?: boolean;
  mediaReady?: boolean;
}

function playerUrl(value: string, sessionId: string): string {
  const url = new URL(value, window.location.origin);
  url.searchParams.set("AutoConnect", "true");
  url.searchParams.set("AutoPlayVideo", "true");
  // Pixel Streaming's player can otherwise preserve a negotiated peer with a
  // dead video track across an Unreal restart. A unique URL remounts the
  // document and guarantees a fresh WebRTC transport.
  url.searchParams.set("conclaviaSession", sessionId);
  return url.toString();
}

function shotForMessage(
  message: TalkRunMessageResponse,
): UnrealShot {
  if (
    message.sequence === 1 ||
    message.intent === "opening" ||
    message.intent === "moderation" ||
    message.intent === "closing"
  ) {
    return "wide";
  }
  if (message.estimatedAirtimeSeconds <= 5) return "close-up";
  // A direct exchange earns an editorial angle; an independent contribution
  // stays closer to camera. Left/right are two variants of the same shot
  // family, not extra random cuts.
  if (message.targetParticipantIndex === undefined) return "close-up";
  return message.sequence % 2 === 0
    ? "three-quarter-left"
    : "three-quarter-right";
}

function cinematicCuts(
  message: TalkRunMessageResponse,
  durationMs: number,
): CinematicCut[] {
  // Preserve a shot for at least six seconds before changing it, and never
  // cut in the last four seconds of a sentence. This gives longer arguments
  // one motivated push-in while short replies keep a single, calm frame.
  if (durationMs < 14_000) return [];
  const initialShot = shotForMessage(message);
  const atMs = Math.min(
    durationMs - 4_000,
    Math.max(6_000, Math.round(durationMs * 0.48)),
  );
  return [
    {
      atMs,
      shot: initialShot === "wide" ? "three-quarter-left" : "push-in",
    },
  ];
}

function seatId(participantIndex: number | undefined): string {
  return `participant-${(participantIndex ?? 0) + 1}`;
}

export const UnrealStudioStage = forwardRef<StudioStageHandle, StudioStageProps>(
  function UnrealStudioStage(
    {
      talk,
      presentation = "studio",
      onBroadcastStateChange,
    },
    ref,
  ) {
    const { t } = useTranslations();
    const startPromiseRef = useRef<Promise<void> | null>(null);
    const speechPlayerRef = useRef<UnrealSpeechPlayer | null>(null);
    const speechCacheRef = useRef(
      new Map<number, Promise<ArrayBuffer>>(),
    );
    const cameraTimersRef = useRef(new Set<number>());
    const playerFrameRef = useRef<HTMLIFrameElement>(null);
    const mediaReadyRef = useRef(false);
    const mediaReadyWaitersRef = useRef(new Set<() => void>());
    const audioReadyRef = useRef(false);
    const audioReadyWaitersRef = useRef(new Set<() => void>());
    const [state, setState] = useState<UnrealStageState>("idle");
    const [serverStatus, setServerStatus] =
      useState<UnrealServerState>("checking");
    const [streamUrl, setStreamUrl] = useState<string>();
    const [error, setError] = useState<string>();
    const [faceReady, setFaceReady] = useState(false);
    const [expressionAudit, setExpressionAudit] =
      useState<UnrealExpressionAudit>();
    // This profile is deliberately a one-face benchmark. Every programme voice
    // targets the same physical MetaHuman until a continuous 1080p run proves
    // that Unreal can beat the existing LiveAvatar output without hair pops,
    // frozen frames or render hitches.
    const profile = useMemo(() => "lipsync58" as const, []);

    const applyServerStatus = useCallback((payload: UnrealStatusResponse) => {
      setServerStatus(
        payload.serverStatus ?? (payload.available ? "ready" : "unknown"),
      );
    }, []);

    const markMediaReady = useCallback(() => {
      if (mediaReadyRef.current) return;
      mediaReadyRef.current = true;
      for (const resolve of mediaReadyWaitersRef.current) resolve();
      mediaReadyWaitersRef.current.clear();
    }, []);

    const markAudioReady = useCallback(() => {
      if (audioReadyRef.current) return;
      audioReadyRef.current = true;
      for (const resolve of audioReadyWaitersRef.current) resolve();
      audioReadyWaitersRef.current.clear();
    }, []);

    useEffect(() => {
      const onMessage = (event: MessageEvent<UnrealPlayerMessage>) => {
        if (event.source !== playerFrameRef.current?.contentWindow) return;
        if (
          event.data?.type === "conclavia:media-ready" &&
          event.data.mediaReady
        ) {
          markMediaReady();
        }
        if (
          (event.data?.type === "conclavia:audio-state" &&
            event.data.audioReady) ||
          (event.data?.type === "conclavia:media-ready" &&
            event.data.mediaReady &&
            event.data.audioReady)
        ) {
          markAudioReady();
        }
      };
      window.addEventListener("message", onMessage);
      return () => window.removeEventListener("message", onMessage);
    }, [markAudioReady, markMediaReady]);

    const waitForPlayerMedia = useCallback(async (timeoutMs = 35_000) => {
      if (mediaReadyRef.current) return;
      await new Promise<void>((resolve, reject) => {
        const onReady = () => {
          window.clearTimeout(timeout);
          resolve();
        };
        const timeout = window.setTimeout(() => {
          mediaReadyWaitersRef.current.delete(onReady);
          reject(new Error("Il flusso video 3D non ha prodotto un frame valido."));
        }, timeoutMs);
        mediaReadyWaitersRef.current.add(onReady);
      });
    }, []);

    const waitForPlayerAudio = useCallback(async () => {
      if (audioReadyRef.current) return;
      await new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(() => {
          audioReadyWaitersRef.current.delete(onReady);
          reject(
            new Error(
              "Attiva l’audio nel riquadro video per iniziare la diretta.",
            ),
          );
        }, 30_000);
        const onReady = () => {
          window.clearTimeout(timeout);
          resolve();
        };
        audioReadyWaitersRef.current.add(onReady);
      });
    }, []);

    useEffect(() => {
      if (state === "ready") return;
      let active = true;

      const refreshServerStatus = async () => {
        try {
          const response = await fetch("/api/unreal/status", {
            cache: "no-store",
          });
          if (!response.ok) throw new Error("status request failed");
          const payload = (await response.json()) as UnrealStatusResponse;
          if (active) applyServerStatus(payload);
        } catch {
          if (active) setServerStatus("error");
        }
      };

      void refreshServerStatus();
      const timer = window.setInterval(refreshServerStatus, 5_000);
      return () => {
        active = false;
        window.clearInterval(timer);
      };
    }, [applyServerStatus, state]);

    useEffect(() => {
      if (state !== "ready") return;
      let consecutiveFailures = 0;
      const timer = window.setInterval(async () => {
        try {
          const response = await fetch("/api/unreal/status", {
            cache: "no-store",
          });
          const payload = (await response.json()) as UnrealStatusResponse;
          applyServerStatus(payload);
          consecutiveFailures = payload.available ? 0 : consecutiveFailures + 1;
          if (payload.available && payload.health) {
            const health = payload.health;
            setExpressionAudit((current) =>
              current
                ? {
                    ...current,
                    solverMood:
                      health.commercialMood ?? health.performanceMood,
                    solverIntensity:
                      health.commercialMoodIntensity ??
                      health.performanceTargetIntensity,
                    controlCount: health.commercialControlCount,
                    upperFaceValue:
                      health.commercialSpeechPeakUpperFaceControl ??
                      health.commercialMaxUpperFaceControl,
                    upperFaceControl:
                      health.commercialSpeechPeakUpperFaceControlName ??
                      health.commercialMaxUpperFaceControlName,
                  }
                : current,
            );
          }
        } catch {
          consecutiveFailures += 1;
          setServerStatus("error");
        }
        if (consecutiveFailures < 2) return;
        setStreamUrl(undefined);
        setFaceReady(false);
        setState("error");
        setError(
          "Il renderer Unreal si è fermato: la diretta video è stata interrotta.",
        );
        onBroadcastStateChange?.("idle");
        window.clearInterval(timer);
      }, 1_000);
      return () => window.clearInterval(timer);
    }, [applyServerStatus, onBroadcastStateChange, state]);

    const start = useCallback(async () => {
      if (state === "ready") return;
      if (startPromiseRef.current) return startPromiseRef.current;

      const operation = (async () => {
        setState("starting");
        speechPlayerRef.current ??= new UnrealSpeechPlayer();
        await speechPlayerRef.current.activate();
        setError(undefined);
        const response = await fetch("/api/unreal/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ profile }),
        });
        const payload = (await response.json()) as UnrealSessionResponse;
        if (!response.ok || !payload.playerUrl) {
          throw new Error(payload.error || t("unrealStageError"));
        }
        if (!payload.health?.commercialLipSyncReady) {
          throw new Error(t("unrealStageError"));
        }
        setFaceReady(false);
        mediaReadyRef.current = false;
        audioReadyRef.current = false;
        const mountPlayer = () =>
          setStreamUrl(
            playerUrl(
              payload.playerUrl as string,
              `${Date.now()}-${crypto.randomUUID()}`,
            ),
          );
        mountPlayer();
        try {
          await waitForPlayerMedia();
        } catch {
          // One remount recovers the occasional stale WebRTC peer without
          // restarting the expensive, already-warm Unreal renderer.
          mediaReadyRef.current = false;
          mediaReadyWaitersRef.current.clear();
          mountPlayer();
          await waitForPlayerMedia(25_000);
        }
        setFaceReady(true);
        setState("ready");
      })()
        .catch(async (caught: unknown) => {
          const message =
            caught instanceof Error ? caught.message : t("unrealStageError");
          // A failed visual/health gate must not leave the billable renderer
          // running invisibly behind the control room.
          await fetch("/api/unreal/session", { method: "DELETE" }).catch(
            () => undefined,
          );
          setError(message);
          setStreamUrl(undefined);
          mediaReadyRef.current = false;
          mediaReadyWaitersRef.current.clear();
          setFaceReady(false);
          setState("error");
          throw caught;
        })
        .finally(() => {
          startPromiseRef.current = null;
        });

      startPromiseRef.current = operation;
      return operation;
    }, [profile, state, t, waitForPlayerMedia]);

    const prepareSpeaker = useCallback(async () => {
      await start();
    }, [start]);

    const synthesizeMessage = useCallback(
      async (message: TalkRunMessageResponse): Promise<ArrayBuffer> => {
        const participant =
          message.speakerType === "participant" &&
          message.participantIndex !== undefined
            ? talk.participants[message.participantIndex]
            : undefined;
        const sex = participant?.sex ?? "female";
        const voiceIndex =
          message.speakerType === "moderator"
            ? talk.participants.length
            : message.participantIndex ?? 0;
        const voice = getUnrealVoice(sex, voiceIndex);
        const speechResponse = await fetch("/api/unreal/speech", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: message.content,
            voice,
            direction: unrealVoicePrompt(
              participant?.voiceDelivery ?? talk.moderator.voiceDelivery,
            ),
          }),
        });
        if (!speechResponse.ok) {
          const speechError = (await speechResponse.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(speechError.error || t("runnerAudioError"));
        }
        return speechResponse.arrayBuffer();
      },
      [t, talk],
    );

    const preparedSpeech = useCallback(
      (message: TalkRunMessageResponse): Promise<ArrayBuffer> => {
        const existing = speechCacheRef.current.get(message.sequence);
        if (existing) return existing;
        if (speechCacheRef.current.size >= 8) {
          const oldest = speechCacheRef.current.keys().next().value as
            | number
            | undefined;
          if (oldest !== undefined) speechCacheRef.current.delete(oldest);
        }
        const operation = synthesizeMessage(message).catch((caught: unknown) => {
          if (speechCacheRef.current.get(message.sequence) === operation) {
            speechCacheRef.current.delete(message.sequence);
          }
          throw caught;
        });
        speechCacheRef.current.set(message.sequence, operation);
        return operation;
      },
      [synthesizeMessage],
    );

    const prepareMessage = useCallback(
      async (message: TalkRunMessageResponse) => {
        await preparedSpeech(message);
      },
      [preparedSpeech],
    );

    const sendDirectorCue = useCallback(
      async (
        message: TalkRunMessageResponse,
        shot: UnrealShot,
        expectedDurationMs: number,
      ) => {
        const diagnostic = unrealExpressionDiagnostic(message);
        setExpressionAudit((current) =>
          current?.sequence === diagnostic.sequence
            ? current
            : diagnostic,
        );
        const response = await fetch("/api/unreal/cue", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            speakerId: seatId(message.participantIndex),
            targetId:
              message.targetParticipantIndex === undefined
                ? undefined
                : seatId(message.targetParticipantIndex),
            speakerName: message.speakerName,
            targetName: message.targetSpeakerName,
            shot,
            intent: message.intent,
            expectedDurationMs,
            performanceBeats: unrealPerformancePlan(
              message,
              expectedDurationMs,
            ),
          }),
        });
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        if (!response.ok) {
          throw new Error(payload.error || t("unrealStageError"));
        }
      },
      [t],
    );

    const clearCameraTimers = useCallback(() => {
      for (const timer of cameraTimersRef.current) window.clearTimeout(timer);
      cameraTimersRef.current.clear();
    }, []);

    const speak = useCallback(
      async (message: TalkRunMessageResponse) => {
        // Synthesis begins before GPU startup/camera preparation and, for
        // queued turns, while the previous person is still on air.
        const pcmPromise = preparedSpeech(message);
        await start();
        // Do not let Unreal consume the first utterance before the embedded
        // Pixel Streaming peer exists and Chrome has actually unlocked its
        // audio output. The player resolves this handshake automatically when
        // permitted, or immediately after the user presses "Attiva audio".
        await waitForPlayerAudio();
        const pcm = await pcmPromise;
        const expectedDurationMs = Math.max(
          2_000,
          Math.round((pcm.byteLength / 2 / 16_000) * 1_000),
        );
        await sendDirectorCue(
          message,
          shotForMessage(message),
          expectedDurationMs,
        );
        onBroadcastStateChange?.("loading", message);
        clearCameraTimers();
        try {
          await speechPlayerRef.current?.speak(pcm, (durationMs) => {
            onBroadcastStateChange?.("speaking", message);
            for (const cut of cinematicCuts(message, durationMs)) {
              const timer = window.setTimeout(() => {
                cameraTimersRef.current.delete(timer);
                void sendDirectorCue(message, cut.shot, durationMs).catch(
                  () => undefined,
                );
              }, cut.atMs);
              cameraTimersRef.current.add(timer);
            }
          });
        } finally {
          clearCameraTimers();
          speechCacheRef.current.delete(message.sequence);
          onBroadcastStateChange?.("idle");
        }
      },
      [
        clearCameraTimers,
        onBroadcastStateChange,
        preparedSpeech,
        sendDirectorCue,
        start,
        waitForPlayerAudio,
      ],
    );

    const stop = useCallback(async () => {
      startPromiseRef.current = null;
      await fetch("/api/unreal/session", { method: "DELETE" });
      await speechPlayerRef.current?.close();
      speechPlayerRef.current = null;
      clearCameraTimers();
      speechCacheRef.current.clear();
      setStreamUrl(undefined);
      mediaReadyRef.current = false;
      mediaReadyWaitersRef.current.clear();
      audioReadyRef.current = false;
      audioReadyWaitersRef.current.clear();
      setState("idle");
      setError(undefined);
      setFaceReady(false);
      setExpressionAudit(undefined);
    }, [clearCameraTimers]);

    useImperativeHandle(
      ref,
      () => ({
        startLiveStudio: start,
        prepareSpeaker,
        prepareMessage,
        speak,
        stopLiveStudio: stop,
      }),
      [prepareMessage, prepareSpeaker, speak, start, stop],
    );

    const statusLabel =
      state === "starting"
        ? t("unrealStageStarting")
        : state === "ready"
          ? t("unrealStageLive")
          : state === "error"
            ? t("unrealStageError")
            : t("unrealStageIdle");
    const serverStatusLabel =
      serverStatus === "checking"
        ? t("unrealServerChecking")
        : serverStatus === "off"
          ? t("unrealServerOff")
          : serverStatus === "booting"
            ? t("unrealServerBooting")
            : serverStatus === "online"
              ? t("unrealServerOnline")
              : serverStatus === "ready"
                ? t("unrealServerReady")
                : serverStatus === "stopping"
                  ? t("unrealServerStopping")
                  : serverStatus === "error"
                    ? t("unrealServerStatusError")
                    : t("unrealServerUnknown");
    const serverStatusTone =
      serverStatus === "ready"
        ? "border-emerald-300/25 text-emerald-200"
        : serverStatus === "booting" || serverStatus === "online"
          ? "border-amber-300/25 text-amber-200"
          : serverStatus === "stopping" || serverStatus === "error"
            ? "border-red-300/25 text-red-200"
            : "border-slate-300/25 text-slate-200";
    const stageOverlayLabel = state === "idle" ? serverStatusLabel : statusLabel;

    return (
      <div className={presentation === "broadcast" ? "w-full" : "space-y-3"}>
        <div
          className={`relative aspect-video overflow-hidden bg-[#030711] ${
            presentation === "broadcast"
              ? "w-full"
              : "rounded-2xl border border-slate-800 shadow-2xl"
          }`}
        >
          {streamUrl ? (
            <iframe
              ref={playerFrameRef}
              key={`${profile}-${streamUrl}`}
              src={streamUrl}
              title={t("videoModeUnreal")}
              allow="autoplay; fullscreen"
              allowFullScreen
              className={`absolute inset-0 size-full border-0 transition-opacity duration-500 ${
                state === "ready" ? "opacity-100" : "opacity-0"
              }`}
            />
          ) : null}
          {state !== "ready" && (
            <div className="absolute inset-0 flex items-center justify-center bg-[radial-gradient(circle_at_48%_35%,rgba(34,211,238,.16),transparent_34%),linear-gradient(135deg,#050b16,#11162a_55%,#170a25)] px-6 text-center">
              <div>
                <div className="mx-auto flex size-12 items-center justify-center rounded-full border border-cyan-300/30 bg-cyan-300/10 text-xl text-cyan-200">
                  3D
                </div>
                <p className="mt-4 text-sm font-black uppercase tracking-[.16em] text-white">
                  {stageOverlayLabel}
                </p>
                {error && (
                  <p className="mx-auto mt-2 max-w-xl text-xs leading-5 text-red-200">
                    {error}
                  </p>
                )}
              </div>
            </div>
          )}

          {presentation !== "broadcast" && (
            <div className="pointer-events-none absolute left-3 top-3 z-20 flex flex-wrap gap-2 text-[9px] font-black uppercase tracking-[.12em] sm:left-4 sm:top-4">
              <span className="rounded-full border border-cyan-300/25 bg-slate-950/75 px-2.5 py-1.5 text-cyan-200 backdrop-blur-md">
                {t("unrealStageLabBadge")}
              </span>
              <span
                className={`rounded-full border bg-slate-950/75 px-2.5 py-1.5 backdrop-blur-md ${serverStatusTone}`}
              >
                <span className="mr-1.5 inline-block size-1.5 rounded-full bg-current align-middle" />
                {serverStatusLabel}
              </span>
            </div>
          )}

          {presentation !== "broadcast" && expressionAudit && (
            <div className="pointer-events-none absolute bottom-3 right-3 z-20 max-w-[min(88%,26rem)] rounded-lg border border-cyan-300/20 bg-slate-950/82 px-3 py-2 font-mono text-[9px] uppercase leading-4 tracking-[.08em] text-slate-200 shadow-xl backdrop-blur-md sm:bottom-4 sm:right-4 sm:text-[10px]">
              <p className="font-black text-cyan-200">
                Test {expressionAudit.step}/{expressionAudit.total} ·{" "}
                {expressionAudit.mood} · cmd{" "}
                {Math.round(expressionAudit.intensity * 100)}%
              </p>
              <p className="truncate text-slate-400">
                Solver {expressionAudit.solverMood ?? "in attesa"} ·{" "}
                {expressionAudit.solverIntensity === undefined
                  ? "--"
                  : `${Math.round(expressionAudit.solverIntensity * 100)}%`}{" "}
                · upper {expressionAudit.upperFaceControl ?? "--"}{" "}
                {expressionAudit.upperFaceValue === undefined
                  ? ""
                  : expressionAudit.upperFaceValue.toFixed(3)}{" "}
                · controls {expressionAudit.controlCount ?? "--"}
              </p>
            </div>
          )}
        </div>

        {presentation !== "broadcast" && (
          <div className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs text-slate-600 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-0.5">
              <p className="font-semibold text-slate-800">
                {t("unrealStageLabTitle")}
              </p>
              <p className="leading-5">{t("unrealStageHint")}</p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-1.5">
              <span className="rounded-full bg-emerald-50 px-2 py-1 font-semibold text-emerald-700">
                {t("unrealStageAudio")}
              </span>
              <span className="rounded-full bg-amber-50 px-2 py-1 font-semibold text-amber-700">
                {t("unrealStageFaceValidation")}
              </span>
              {faceReady && (
                <span className="rounded-full bg-cyan-50 px-2 py-1 font-semibold text-cyan-700">
                  {t("unrealStageFaceReady")}
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    );
  },
);
