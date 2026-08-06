"use client";

import { useEffect, useRef, useState } from "react";

import { useTranslations } from "@/i18n/I18nProvider";
import type { TranslationKey } from "@/i18n/translations";
import { getLlmModel } from "@/lib/llm-models";
import {
  getTalkRunBlockCode,
} from "@/lib/talk-run-compatibility";
import {
  StudioStage,
  type BroadcastAudioState,
  type StudioStageHandle,
} from "@/components/StudioStage";
import type { TalkResponse } from "@/types/talk";
import type {
  TalkRunArcPhase,
  TalkRunConclusionKind,
  TalkRunConclusionReadiness,
  TalkRunDiscussionState,
  TalkRunIntent,
  TalkRunMessageResponse,
  TalkRunPreparationMode,
  TalkRunResponse,
  TalkRunTurnPlan,
} from "@/types/talk-run";

const ARC_PHASES: TalkRunArcPhase[] = [
  "positions",
  "conflict",
  "examination",
  "synthesis",
  "conclusion",
];

interface TalkRunnerProps {
  talk: TalkResponse;
  initialRun: TalkRunResponse | null;
}

interface RunApiResponse {
  run?: TalkRunResponse | null;
  error?: string;
  code?: string;
}

function intentTranslationKey(intent: TalkRunIntent): TranslationKey {
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

function relationTranslationKey(
  intent: TalkRunIntent,
  preparationMode: TalkRunPreparationMode,
  hasTarget: boolean,
): TranslationKey | undefined {
  if (preparationMode === "prepared") return "runnerRelationPrepared";
  if (!hasTarget) return undefined;

  const keys: Partial<Record<TalkRunIntent, TranslationKey>> = {
    reply: "runnerRelationReply",
    challenge: "runnerRelationChallenge",
    question: "runnerRelationQuestion",
    answer: "runnerRelationAnswer",
    clarification: "runnerRelationClarification",
    partial_agreement: "runnerRelationAgreement",
    interruption: "runnerRelationInterruption",
    moderation: "runnerRelationModeration",
  };
  return keys[intent] ?? "runnerAddresses";
}

function arcTranslationKey(phase: TalkRunArcPhase): TranslationKey {
  const keys: Record<TalkRunArcPhase, TranslationKey> = {
    positions: "runnerArcPositions",
    conflict: "runnerArcConflict",
    examination: "runnerArcExamination",
    synthesis: "runnerArcSynthesis",
    conclusion: "runnerArcConclusion",
  };
  return keys[phase];
}

function readinessTranslationKey(
  readiness: TalkRunConclusionReadiness,
): TranslationKey {
  const keys: Record<TalkRunConclusionReadiness, TranslationKey> = {
    not_ready: "runnerConclusionNotReady",
    developing: "runnerConclusionDeveloping",
    ready: "runnerConclusionReady",
    forced: "runnerConclusionForced",
  };
  return keys[readiness];
}

function conclusionKindTranslationKey(
  kind: TalkRunConclusionKind,
): TranslationKey {
  const keys: Record<TalkRunConclusionKind, TranslationKey> = {
    agreement: "runnerConclusionAgreement",
    conditional_agreement: "runnerConclusionConditional",
    clarified_disagreement: "runnerConclusionDisagreement",
    open: "runnerConclusionOpen",
  };
  return keys[kind];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function TalkRunner({ talk, initialRun }: TalkRunnerProps) {
  const { t } = useTranslations();
  const [run, setRun] = useState(initialRun);
  const [requestPending, setRequestPending] = useState(false);
  const [autoRunning, setAutoRunning] = useState(false);
  const [streamingPlan, setStreamingPlan] = useState<TalkRunTurnPlan | null>(null);
  const [streamingContent, setStreamingContent] = useState("");
  const [preparingPlan, setPreparingPlan] = useState<TalkRunTurnPlan | null>(null);
  const [preparationReady, setPreparationReady] = useState(false);
  const [reviewingEditorial, setReviewingEditorial] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"viewer" | "control">("viewer");
  const [humanContent, setHumanContent] = useState("");
  const [humanIntent, setHumanIntent] = useState<TalkRunIntent | "">("");
  const [humanTarget, setHumanTarget] = useState("");
  const [humanThread, setHumanThread] = useState("");
  const [broadcastAudioState, setBroadcastAudioState] =
    useState<BroadcastAudioState>("idle");
  const [narratingMessage, setNarratingMessage] =
    useState<TalkRunMessageResponse | null>(null);
  const [startRequest, setStartRequest] = useState<"new" | "resume" | null>(null);
  const stopRequested = useRef(false);
  const activeRequest = useRef<AbortController | null>(null);
  const studioRef = useRef<StudioStageHandle | null>(null);
  const liveTalk = run?.talkSnapshot ?? talk;
  const blockCode = getTalkRunBlockCode(liveTalk);

  useEffect(() => {
    if (run?.status !== "generating" || requestPending) return;

    const interval = window.setInterval(async () => {
      try {
        const response = await fetch(`/api/runs/${run.id}`);
        const payload = (await response.json()) as RunApiResponse;
        if (response.ok && payload.run) setRun(payload.run);
      } catch {
        // The next poll can recover from a transient network failure.
      }
    }, 2000);

    return () => window.clearInterval(interval);
  }, [requestPending, run?.id, run?.status]);

  useEffect(() => {
    if (!startRequest) return;

    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setStartRequest(null);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [startRequest]);

  function handleBroadcastStateChange(
    state: BroadcastAudioState,
    message?: TalkRunMessageResponse,
  ) {
    setBroadcastAudioState(state);
    if (message) setNarratingMessage(message);
    else if (state === "idle" || state === "error") setNarratingMessage(null);
  }

  async function playMessage(message: TalkRunMessageResponse): Promise<void> {
    if (stopRequested.current) return;
    try {
      if (!studioRef.current) throw new Error("LiveAvatar studio unavailable");
      await studioRef.current.speak(message);
    } catch {
      if (stopRequested.current) return;
      stopRequested.current = true;
      setBroadcastAudioState("error");
      setNarratingMessage(null);
      setError(t("runnerAudioError"));
    }
  }

  async function createRun(): Promise<TalkRunResponse | undefined> {
    setRequestPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/talks/${liveTalk.id}/runs`, { method: "POST" });
      const payload = (await response.json()) as RunApiResponse;
      if (!response.ok || !payload.run) {
        setError(t("runnerStartError"));
        return undefined;
      }
      setRun(payload.run);
      return payload.run;
    } catch {
      setError(t("networkError"));
      return undefined;
    } finally {
      setRequestPending(false);
    }
  }

  async function generateNext(
    currentRun: TalkRunResponse,
    prepareNext = false,
  ): Promise<TalkRunResponse | undefined> {
    setRequestPending(true);
    setStreamingPlan(null);
    setStreamingContent("");
    setPreparingPlan(null);
    setPreparationReady(false);
    setReviewingEditorial(false);
    setError(null);

    try {
      const query = prepareNext ? "?prepareNext=1" : "";
      const controller = new AbortController();
      activeRequest.current = controller;
      const response = await fetch(
        `/api/runs/${currentRun.id}/next/stream${query}`,
        { method: "POST", signal: controller.signal },
      );
      if (!response.ok || !response.body) {
        const payload = (await response.json()) as RunApiResponse;
        if (payload.run) setRun(payload.run);
        setError(payload.error || t("runnerGenerationError"));
        return undefined;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const lastSequence = currentRun.messages.at(-1)?.sequence ?? 0;
      let buffer = "";
      let finalRun: TalkRunResponse | undefined;
      let streamError: string | undefined;
      let speechPromise: Promise<void> | undefined;

      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const blocks = buffer.split(/\r?\n\r?\n/u);
        buffer = blocks.pop() ?? "";

        for (const block of blocks) {
          const data = block
            .split(/\r?\n/u)
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trimStart())
            .join("\n");
          if (!data) continue;

          let event: unknown;
          try {
            event = JSON.parse(data) as unknown;
          } catch {
            continue;
          }
          if (!isRecord(event) || typeof event.type !== "string") continue;

          if (event.type === "plan" && isRecord(event.plan)) {
            const plan = event.plan as unknown as TalkRunTurnPlan;
            setStreamingPlan(plan);
            void studioRef.current?.prepareSpeaker(plan).catch(() => undefined);
            setRun((current) =>
              current?.id === currentRun.id
                ? { ...current, status: "generating", activeTurn: plan }
                : current,
            );
          } else if (event.type === "delta" && typeof event.delta === "string") {
            setStreamingContent((content) => content + event.delta);
          } else if (event.type === "preparing" && isRecord(event.plan)) {
            const plan = event.plan as unknown as TalkRunTurnPlan;
            setPreparingPlan(plan);
            void studioRef.current?.prepareSpeaker(plan).catch(() => undefined);
            setPreparationReady(false);
          } else if (event.type === "prepared") {
            setPreparationReady(true);
          } else if (event.type === "editorial_review_started") {
            setReviewingEditorial(true);
          } else if (
            event.type === "editorial_review_completed" &&
            isRecord(event.discussionState)
          ) {
            const discussionState =
              event.discussionState as unknown as TalkRunDiscussionState;
            setRun((current) =>
              current?.id === currentRun.id
                ? { ...current, discussionState }
                : current,
            );
            setReviewingEditorial(false);
          } else if (event.type === "speech_ready" && isRecord(event.message)) {
            const message = event.message as unknown as TalkRunMessageResponse;
            if (!speechPromise && !stopRequested.current) {
              speechPromise = playMessage(message);
            }
          } else if (event.type === "turn_complete" && isRecord(event.run)) {
            const savedRun = event.run as unknown as TalkRunResponse;
            setRun(savedRun);
            setStreamingPlan(null);
            setStreamingContent("");
            const message = savedRun.messages.find(
              (candidate) =>
                candidate.sequence > lastSequence && candidate.origin !== "human",
            );
            if (message && !speechPromise && !stopRequested.current) {
              speechPromise = playMessage(message);
            }
          } else if (event.type === "complete" && isRecord(event.run)) {
            finalRun = event.run as unknown as TalkRunResponse;
            setRun(finalRun);
          } else if (event.type === "error") {
            streamError =
              typeof event.error === "string"
                ? event.error
                : t("runnerGenerationError");
            if (isRecord(event.run)) {
              setRun(event.run as unknown as TalkRunResponse);
            }
          }
        }

        if (done) break;
      }

      if (streamError) {
        await speechPromise;
        setError(streamError);
        return undefined;
      }
      if (!finalRun) {
        setError(t("runnerGenerationError"));
        return undefined;
      }

      if (!speechPromise) {
        const message = finalRun.messages.find(
          (candidate) =>
            candidate.sequence > lastSequence && candidate.origin !== "human",
        );
        if (message && !stopRequested.current) {
          speechPromise = playMessage(message);
        }
      }
      await speechPromise;
      return finalRun;
    } catch (caught) {
      if (!(caught instanceof DOMException && caught.name === "AbortError")) {
        setError(t("networkError"));
      } else {
        try {
          const response = await fetch(`/api/runs/${currentRun.id}`);
          const payload = (await response.json()) as RunApiResponse;
          if (payload.run) setRun(payload.run);
        } catch {
          // The regular recovery poll will refresh a still-running server request.
        }
      }
      return undefined;
    } finally {
      activeRequest.current = null;
      setRequestPending(false);
      setStreamingPlan(null);
      setStreamingContent("");
      setPreparingPlan(null);
      setPreparationReady(false);
      setReviewingEditorial(false);
    }
  }

  async function runAutomatically(startingRun: TalkRunResponse | null = run) {
    if (!startingRun || startingRun.status === "completed") return;
    if (!studioRef.current) {
      setError(t("runnerAudioError"));
      return;
    }

    stopRequested.current = false;
    setAutoRunning(true);
    let current: TalkRunResponse | undefined = startingRun;
    const studioReady = studioRef.current
      .startLiveStudio()
      .then(() => true)
      .catch(() => {
        stopRequested.current = true;
        activeRequest.current?.abort();
        setError(t("runnerAudioError"));
        return false;
      });

    try {
      while (current && current.status !== "completed" && !stopRequested.current) {
        current = await generateNext(current, true);
        if (!(await studioReady)) break;
        if (
          !current ||
          current.status === "failed" ||
          current.status === "waiting_for_human"
        ) break;
      }
    } finally {
      setAutoRunning(false);
      if (
        !current ||
        current.status === "completed" ||
        current.status === "failed" ||
        stopRequested.current
      ) {
        await studioRef.current?.stopLiveStudio();
      }
    }
  }

  async function startNewBroadcast() {
    const created = await createRun();
    if (created) await runAutomatically(created);
  }

  async function confirmStartRequest() {
    const request = startRequest;
    setStartRequest(null);
    if (request === "new") await startNewBroadcast();
    if (request === "resume") await runAutomatically();
  }

  function pauseAutomaticRun() {
    stopRequested.current = true;
    activeRequest.current?.abort();
    handleBroadcastStateChange("idle");
    void studioRef.current?.stopLiveStudio();
  }

  async function submitHumanTurn() {
    if (!run || run.status !== "waiting_for_human" || !humanContent.trim()) return;
    setRequestPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/runs/${run.id}/human-turn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: humanContent,
          intent: humanIntent || undefined,
          targetParticipantIndex:
            humanTarget === "" ? undefined : Number(humanTarget),
          threadLabel: humanThread || undefined,
        }),
      });
      const payload = (await response.json()) as RunApiResponse;
      if (!response.ok || !payload.run) {
        setError(payload.error || t("runnerHumanSaveError"));
        return;
      }
      setRun(payload.run);
      setHumanContent("");
      setHumanIntent("");
      setHumanTarget("");
      setHumanThread("");
    } catch {
      setError(t("networkError"));
    } finally {
      setRequestPending(false);
    }
  }

  const avatarCount =
    liveTalk.participants.filter((participant) => participant.kind === "ai").length +
    (liveTalk.moderator.kind === "ai" ? 1 : 0);
  const startConfirmation = startRequest ? (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-950/60 p-4 backdrop-blur-sm sm:items-center"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) setStartRequest(null);
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="live-confirmation-title"
        className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl sm:p-7"
      >
        <div className="flex size-11 items-center justify-center rounded-full bg-[#e4eee7] text-lg text-[#295c43]">
          ▶
        </div>
        <h2 id="live-confirmation-title" className="mt-4 text-xl font-semibold">
          {t("runnerConfirmTitle")}
        </h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          {t("runnerAutoConfirm", {
            avatars: avatarCount,
            duration: liveTalk.settings.targetDurationMinutes,
            credits: avatarCount * liveTalk.settings.targetDurationMinutes * 2,
          })}
        </p>
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={() => setStartRequest(null)}
            className="button-secondary"
          >
            {t("cancel")}
          </button>
          <button
            type="button"
            onClick={() => void confirmStartRequest()}
            className="button-primary"
          >
            {t("runnerConfirmStart")}
          </button>
        </div>
      </section>
    </div>
  ) : null;

  if (blockCode) {
    return (
      <section className="card p-6 text-center sm:p-8">
        <div className="mx-auto flex size-11 items-center justify-center rounded-full bg-amber-100 text-lg text-amber-800">!</div>
        <h2 className="mt-4 text-lg font-semibold">{t("runnerUnavailable")}</h2>
        <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-600">
          {t("runnerUnassignedBlocked")}
        </p>
      </section>
    );
  }

  if (!run) {
    return (
      <>
        <div className="space-y-5">
          <StudioStage
            ref={studioRef}
            talk={liveTalk}
            run={null}
            broadcastAudioState={broadcastAudioState}
            broadcastMessage={narratingMessage ?? undefined}
            runControlActive={autoRunning || requestPending}
            onPauseRun={pauseAutomaticRun}
            onBroadcastStateChange={handleBroadcastStateChange}
          />
          <section className="card p-6 text-center sm:p-10">
            <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-[#e4eee7] text-xl text-[#295c43]">
              ▶
            </div>
            <h2 className="mt-4 text-xl font-semibold">{t("runnerReadyTitle")}</h2>
            <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-600">
              {t("runnerReadyDescription", { turns: liveTalk.settings.maxTurns })}
            </p>
            <p className="mx-auto mt-2 max-w-xl text-xs leading-5 text-slate-500">
              {t("runnerEditorialCostNote")}
            </p>
            <button
              type="button"
              onClick={() => setStartRequest("new")}
              disabled={requestPending}
              className="button-primary mt-6"
            >
              {requestPending ? t("runnerCreating") : t("runnerRunAutomatically")}
            </button>
          </section>
        </div>
        {startConfirmation}
      </>
    );
  }

  const completed = run.status === "completed";
  const visiblePlan = streamingPlan ?? run.activeTurn;
  const visibleArcPhase =
    visiblePlan?.arcPhase ?? run.discussionState.arcPhase;
  const visibleArcIndex = ARC_PHASES.indexOf(visibleArcPhase);
  const visibleRelationKey = visiblePlan
    ? relationTranslationKey(
        visiblePlan.intent,
        visiblePlan.preparationMode,
        Boolean(visiblePlan.targetSpeakerName),
      )
    : undefined;
  const waitingForHuman = run.status === "waiting_for_human";
  const elapsedMinutes = Math.floor(run.estimatedAirtimeSeconds / 60);
  const elapsedSeconds = run.estimatedAirtimeSeconds % 60;

  return (
    <>
      <div className="space-y-5">
      <StudioStage
        ref={studioRef}
        talk={liveTalk}
        run={run}
        activePlan={visiblePlan}
        streamingContent={streamingContent}
        broadcastAudioState={broadcastAudioState}
        broadcastMessage={narratingMessage ?? undefined}
        runControlActive={
          autoRunning || requestPending || run.status === "generating"
        }
        onPauseRun={pauseAutomaticRun}
        onBroadcastStateChange={handleBroadcastStateChange}
      />

      <section className="card p-5 sm:p-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${completed ? "bg-emerald-100 text-emerald-800" : run.status === "failed" ? "bg-red-100 text-red-800" : "bg-[#edf4ef] text-[#295c43]"}`}>
                {t(completed ? "runnerStatusCompleted" : run.status === "failed" ? "runnerStatusFailed" : waitingForHuman ? "runnerStatusWaitingHuman" : "runnerStatusActive")}
              </span>
              {!completed && (
                <span className="text-xs text-slate-500">
                  {visiblePlan
                    ? visibleRelationKey
                      ? t(visibleRelationKey, {
                          speaker: visiblePlan.speakerName,
                          target: visiblePlan.targetSpeakerName ?? "",
                        })
                      : visiblePlan.speakerName
                    : run.hasPreparedTurn
                      ? t("runnerPreparedReady")
                    : t("runnerDirectorChoosing")}
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-2 sm:max-w-sm sm:justify-end">
            {autoRunning || broadcastAudioState === "loading" || broadcastAudioState === "speaking" ? (
              <button
                type="button"
                onClick={pauseAutomaticRun}
                className="rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-red-500"
              >
                {t("runnerPause")}
              </button>
            ) : completed ? (
              <button type="button" onClick={() => setStartRequest("new")} disabled={requestPending} className="button-primary">{t("runnerNewSession")}</button>
            ) : waitingForHuman ? null : (
              <button type="button" onClick={() => setStartRequest("resume")} disabled={requestPending || run.status === "generating" || waitingForHuman} className="button-primary flex-1 sm:flex-none">
                {requestPending || run.status === "generating" ? t("runnerGenerating") : run.status === "failed" ? t("runnerRetry") : t("runnerRunAutomatically")}
              </button>
            )}
          </div>
        </div>
        <div className="mt-5 border-t border-slate-100 pt-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
              {t("runnerArcTitle")}
            </h2>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
              <span>
                {t("runnerAirtime", {
                  elapsed: `${elapsedMinutes}:${String(elapsedSeconds).padStart(2, "0")}`,
                  total: run.targetDurationMinutes,
                })}
              </span>
              {viewMode === "control" && (
                <span>{t("runnerTurnLimit", { current: run.participantTurnCount, total: run.maxTurns })}</span>
              )}
            </div>
          </div>
          <ol className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
            {ARC_PHASES.map((phase, index) => {
              const active = phase === visibleArcPhase;
              const passed = completed || index < visibleArcIndex;
              return (
                <li
                  key={phase}
                  className={`rounded-lg border px-3 py-2 text-xs font-medium ${
                    active
                      ? "border-[#295c43] bg-[#edf4ef] text-[#295c43]"
                      : passed
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                        : "border-slate-200 bg-white text-slate-400"
                  }`}
                >
                  <span className="mr-1.5" aria-hidden="true">
                    {passed && !active ? "✓" : index + 1}
                  </span>
                  {t(arcTranslationKey(phase))}
                </li>
              );
            })}
          </ol>
        </div>
        {broadcastAudioState === "loading" && narratingMessage ? (
          <p className="mt-3 text-xs font-medium text-cyan-700" role="status">
            {t("runnerAudioPreparing", { name: narratingMessage.speakerName })}
          </p>
        ) : broadcastAudioState === "speaking" && narratingMessage ? (
          <p className="mt-3 text-xs font-medium text-emerald-700" role="status">
            {t("runnerAudioSpeaking", { name: narratingMessage.speakerName })}
          </p>
        ) : autoRunning ? (
          <p className="mt-3 text-xs text-slate-500">{t("runnerPauseHelp")}</p>
        ) : !completed ? (
          <p className="mt-3 text-xs text-slate-500">{t("runnerAudioHelp")}</p>
        ) : null}
        <p className="mt-2 text-xs text-slate-400">
          {t("runnerAiVoiceDisclosure")}
        </p>
        <div className="mt-4 flex justify-end border-t border-slate-100 pt-4">
          <div className="inline-flex rounded-lg border border-[#dfe4dc] bg-white p-1">
            {(["viewer", "control"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                aria-pressed={viewMode === mode}
                onClick={() => setViewMode(mode)}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${viewMode === mode ? "bg-[#295c43] text-white" : "text-slate-500 hover:text-slate-900"}`}
              >
                {t(mode === "viewer" ? "runnerViewerMode" : "runnerControlMode")}
              </button>
            ))}
          </div>
        </div>
      </section>

      {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}

      {waitingForHuman && visiblePlan && (
        <section className="card border-amber-200 bg-amber-50/60 p-5 sm:p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-800">
            {t(visiblePlan.speakerType === "moderator" ? "runnerHumanHostDesk" : "runnerHumanTurn")}
          </p>
          <h2 className="mt-1 text-xl font-semibold">
            {t("runnerFloorTo", { name: visiblePlan.speakerName })}
          </h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            {t("runnerHumanTurnHelp")}
          </p>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="human-intent" className="label">{t("runnerHumanIntent")}</label>
              <select
                id="human-intent"
                value={humanIntent || visiblePlan.intent}
                onChange={(event) => setHumanIntent(event.target.value as TalkRunIntent)}
                className="input"
              >
                {(visiblePlan.speakerType === "moderator"
                  ? visiblePlan.intent === "opening" || visiblePlan.intent === "closing"
                    ? ([visiblePlan.intent] as TalkRunIntent[])
                    : (["question", "moderation"] as TalkRunIntent[])
                  : (["argument", "reply", "challenge", "question", "answer", "clarification", "partial_agreement", "interruption"] as TalkRunIntent[])
                ).map((intent) => (
                  <option key={intent} value={intent}>{t(intentTranslationKey(intent))}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="human-target" className="label">{t("runnerHumanTarget")}</label>
              <select
                id="human-target"
                value={humanTarget}
                onChange={(event) => setHumanTarget(event.target.value)}
                className="input"
              >
                <option value="">{t("runnerHumanNoTarget")}</option>
                {liveTalk.participants.map((participant, index) =>
                  index === visiblePlan.participantIndex ? null : (
                    <option key={index} value={index}>{participant.name}</option>
                  ),
                )}
              </select>
            </div>
            {visiblePlan.speakerType === "moderator" && (
              <div className="sm:col-span-2">
                <label htmlFor="human-thread" className="label">{t("runnerHumanFocus")}</label>
                <input
                  id="human-thread"
                  value={humanThread}
                  onChange={(event) => setHumanThread(event.target.value)}
                  className="input"
                  placeholder={visiblePlan.threadLabel}
                />
              </div>
            )}
            <div className="sm:col-span-2">
              <label htmlFor="human-content" className="label">{t("runnerHumanIntervention")}</label>
              <textarea
                id="human-content"
                rows={5}
                value={humanContent}
                onChange={(event) => setHumanContent(event.target.value)}
                className="input resize-y"
                placeholder={t("runnerHumanInterventionPlaceholder")}
              />
            </div>
          </div>
          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={submitHumanTurn}
              disabled={requestPending || !humanContent.trim()}
              className="button-primary"
            >
              {requestPending ? t("saving") : t("runnerHumanSend")}
            </button>
          </div>
        </section>
      )}

      {run.discussionState.conclusion &&
        (completed || run.discussionState.arcPhase === "conclusion") && (
          <section className="card overflow-hidden border-[#9fb9aa]">
            <div className="bg-[#edf4ef] px-5 py-5 sm:px-6">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-semibold text-[#183a2a]">
                  {t("runnerConclusionTitle")}
                </h2>
                <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-[#295c43]">
                  {t(
                    conclusionKindTranslationKey(
                      run.discussionState.conclusion.kind,
                    ),
                  )}
                </span>
              </div>
              <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-[#5f7d6c]">
                {t("runnerConclusionAnswer")}
              </p>
              <p className="mt-3 max-w-4xl text-sm leading-7 text-slate-700 sm:text-base">
                {run.discussionState.conclusion.answer}
              </p>
            </div>
            <div className="grid gap-5 p-5 sm:grid-cols-2 sm:p-6">
              {[
                {
                  title: t("runnerConclusionAgreements"),
                  items: run.discussionState.conclusion.agreements,
                },
                {
                  title: t("runnerConclusionDisagreements"),
                  items: run.discussionState.conclusion.disagreements,
                },
                {
                  title: t("runnerConclusionConditions"),
                  items: run.discussionState.conclusion.conditions,
                },
                {
                  title: t("runnerConclusionOpenQuestions"),
                  items: run.discussionState.conclusion.openQuestions,
                },
              ].map((section) => (
                <div key={section.title}>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                    {section.title}
                  </h3>
                  {section.items.length > 0 ? (
                    <ul className="mt-2 space-y-2 text-sm leading-6 text-slate-600">
                      {section.items.map((item) => (
                        <li key={item} className="flex gap-2">
                          <span className="text-[#5f8a70]">•</span>
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-2 text-sm text-slate-400">—</p>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

      <div className={viewMode === "control" ? "grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start" : "mx-auto max-w-4xl"}>
        <section aria-live="polite">
          <div className="mb-4 flex items-baseline justify-between gap-4">
            <h2 className="text-xl font-semibold">{t("runnerTranscript")}</h2>
            <span className="text-xs text-slate-500">{t("runnerSavedAutomatically")}</span>
          </div>

          {run.messages.length === 0 && !requestPending && run.status !== "generating" ? (
            <div className="card px-5 py-10 text-center text-sm text-slate-500">{t("runnerEmptyTranscript")}</div>
          ) : (
            <ol className="space-y-4">
              {run.messages.map((message) => {
                const model = message.model ? getLlmModel(message.model) : undefined;
                const relationKey = relationTranslationKey(
                  message.intent,
                  message.preparationMode,
                  Boolean(message.targetSpeakerName),
                );
                return (
                  <li key={message.sequence} className={`card p-5 sm:p-6 ${message.speakerType === "moderator" ? "border-[#9fb9aa] bg-[#f5faf6]" : ""}`}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="flex size-7 items-center justify-center rounded-full bg-[#e4eee7] text-xs font-bold text-[#295c43]">{message.sequence}</span>
                          <h3 className="font-semibold">{message.speakerName}</h3>
                          {message.speakerType === "moderator" && <span className="rounded-full bg-[#dceadf] px-2 py-0.5 text-[11px] font-semibold text-[#295c43]">{t("moderation")}</span>}
                        </div>
                        {message.speakerRole && <p className="ml-9 mt-0.5 text-xs text-slate-500">{message.speakerRole}</p>}
                      </div>
                      {(viewMode === "control" || message.origin === "human") && (
                        <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-500">
                          {message.origin === "human" ? t("runnerHumanBadge") : model?.label}
                        </span>
                      )}
                    </div>
                    {relationKey && <p className="mt-3 text-sm font-medium text-[#295c43]">{t(relationKey, { speaker: message.speakerName, target: message.targetSpeakerName ?? "" })}</p>}
                    {viewMode === "control" && <div className="mt-3 flex flex-wrap gap-1.5">
                      <span className="rounded-full border border-[#c8dbce] bg-white px-2 py-1 text-[11px] font-semibold text-[#295c43]">{t(arcTranslationKey(message.arcPhase))}</span>
                      <span className="rounded-full bg-[#edf4ef] px-2 py-1 text-[11px] font-semibold text-[#295c43]">{t(intentTranslationKey(message.intent))}</span>
                      <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] text-slate-600">{t(message.preparationMode === "prepared" ? "runnerPreparationPrepared" : "runnerPreparationReactive")}</span>
                      {message.threadLabel && <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] text-slate-600">{t("runnerThread", { thread: message.threadLabel })}</span>}
                      {message.wordCount > 0 && <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] text-slate-500">{t("runnerWordCount", { count: message.wordCount })}</span>}
                    </div>}
                    <p className="mt-4 whitespace-pre-wrap text-sm leading-7 text-slate-700 sm:text-base">{message.content}</p>
                    {viewMode === "control" && (message.inputTokens !== undefined || message.outputTokens !== undefined) && <p className="mt-4 border-t border-slate-100 pt-3 text-[11px] text-slate-400">{t("runnerTokenUsage", { input: message.inputTokens ?? "—", output: message.outputTokens ?? "—" })}</p>}
                  </li>
                );
              })}
            </ol>
          )}

          {(requestPending || run.status === "generating") &&
            (visiblePlan || !preparingPlan) && (
            <article className="card mt-4 border-[#9fb9aa] p-5 sm:p-6">
              {visiblePlan ? (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="size-2 animate-pulse rounded-full bg-[#295c43]" />
                    <h3 className="font-semibold">{visiblePlan.speakerName}</h3>
                    {viewMode === "control" && <span className="rounded-full border border-[#c8dbce] bg-white px-2 py-1 text-[11px] font-semibold text-[#295c43]">{t(arcTranslationKey(visiblePlan.arcPhase))}</span>}
                    {viewMode === "control" && <span className="rounded-full bg-[#edf4ef] px-2 py-1 text-[11px] font-semibold text-[#295c43]">{t(intentTranslationKey(visiblePlan.intent))}</span>}
                  </div>
                  {visibleRelationKey && <p className="mt-2 text-sm font-medium text-[#295c43]">{t(visibleRelationKey, { speaker: visiblePlan.speakerName, target: visiblePlan.targetSpeakerName ?? "" })}</p>}
                  {viewMode === "control" && <p className="mt-2 text-xs text-slate-500">{t("runnerThread", { thread: visiblePlan.threadLabel })}</p>}
                  {streamingContent ? (
                    <p className="mt-4 whitespace-pre-wrap text-sm leading-7 text-slate-700 sm:text-base">{streamingContent}<span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-[#295c43] align-middle" /></p>
                  ) : (
                    <p className="mt-4 flex items-center gap-3 text-sm text-slate-500"><span className="size-4 animate-spin rounded-full border-2 border-[#295c43] border-t-transparent" />{t("runnerGeneratingFor", { name: visiblePlan.speakerName })}</p>
                  )}
                </>
              ) : (
                <p className="flex items-center gap-3 text-sm text-slate-500"><span className="size-4 animate-spin rounded-full border-2 border-[#295c43] border-t-transparent" />{t("runnerDirectorChoosing")}</p>
              )}
            </article>
          )}

          {reviewingEditorial && (
            <article className="mt-4 rounded-xl border border-violet-200 bg-violet-50 px-5 py-4" aria-live="polite">
              <p className="flex items-center gap-3 text-sm font-medium text-violet-800">
                <span className="size-4 animate-spin rounded-full border-2 border-violet-700 border-t-transparent" />
                {t("runnerEditorialReviewing")}
              </p>
            </article>
          )}

          {viewMode === "control" && preparingPlan && (
            <article className="mt-4 rounded-xl border border-dashed border-[#9fb9aa] bg-[#f5faf6] px-5 py-4" aria-live="polite">
              <div className="flex items-center gap-3 text-sm text-[#295c43]">
                {preparationReady ? (
                  <span className="flex size-5 items-center justify-center rounded-full bg-[#295c43] text-xs text-white">✓</span>
                ) : (
                  <span className="size-4 animate-pulse rounded-full bg-[#6f9b82]" />
                )}
                <span className="font-medium">
                  {preparationReady
                    ? t("runnerPreparedReady")
                    : t("runnerPreparingWhileListening", { name: preparingPlan.speakerName })}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5 pl-8">
                <span className="rounded-full bg-white px-2 py-1 text-[11px] font-semibold text-[#295c43]">{t(intentTranslationKey(preparingPlan.intent))}</span>
                <span className="rounded-full bg-white px-2 py-1 text-[11px] text-slate-600">{t(preparingPlan.preparationMode === "prepared" ? "runnerPreparationPrepared" : "runnerPreparationReactive")}</span>
              </div>
            </article>
          )}
        </section>

        {viewMode === "control" && <aside className="card p-5 lg:sticky lg:top-6">
          <h2 className="text-sm font-semibold">{t("runnerSharedState")}</h2>
          <dl className="mt-4 space-y-4 text-xs">
            <div>
              <dt className="font-semibold uppercase tracking-wide text-slate-400">{t("runnerPhaseObjective")}</dt>
              <dd className="mt-1 leading-5 text-slate-700">{run.discussionState.phaseObjective}</dd>
            </div>
            <div className="border-t border-slate-100 pt-4">
              <dt className="font-semibold uppercase tracking-wide text-slate-400">{t("runnerCurrentFocus")}</dt>
              <dd className="mt-1 leading-5 text-slate-700">{run.discussionState.currentFocus || liveTalk.topic}</dd>
            </div>
            <div className="border-t border-slate-100 pt-4">
              <dt className="font-semibold uppercase tracking-wide text-slate-400">{t("runnerCorePositions")}</dt>
              <dd className="mt-2">
                {run.discussionState.corePositions.length > 0 ? (
                  <ul className="space-y-2 text-slate-600">
                    {run.discussionState.corePositions.map((position) => (
                      <li key={position.participantIndex}>
                        <span className="font-semibold text-slate-700">{liveTalk.participants[position.participantIndex]?.name}: </span>
                        {position.summary}
                      </li>
                    ))}
                  </ul>
                ) : <span className="text-slate-400">—</span>}
              </dd>
            </div>
            <div className="border-t border-slate-100 pt-4">
              <dt className="font-semibold uppercase tracking-wide text-slate-400">{t("runnerKeyConflict")}</dt>
              <dd className="mt-1 leading-5 text-slate-700">{run.discussionState.keyConflict || "—"}</dd>
            </div>
            {run.discussionState.turningPoints.length > 0 && (
              <div className="border-t border-slate-100 pt-4">
                <dt className="font-semibold uppercase tracking-wide text-slate-400">{t("runnerTurningPoints")}</dt>
                <dd className="mt-2">
                  <ul className="space-y-2 text-slate-600">
                    {run.discussionState.turningPoints.slice(-3).map((point) => (
                      <li key={`${point.participantIndex}-${point.summary}`}>
                        <span className="font-semibold text-slate-700">{liveTalk.participants[point.participantIndex]?.name}: </span>
                        {point.summary}
                      </li>
                    ))}
                  </ul>
                </dd>
              </div>
            )}
            <div className="border-t border-slate-100 pt-4">
              <dt className="font-semibold uppercase tracking-wide text-slate-400">{t("runnerConclusionStatus")}</dt>
              <dd className="mt-1 font-medium leading-5 text-[#295c43]">{t(readinessTranslationKey(run.discussionState.conclusionReadiness))}</dd>
              {run.discussionState.conclusionReason && <dd className="mt-1 leading-5 text-slate-500">{run.discussionState.conclusionReason}</dd>}
            </div>
            <div className="border-t border-slate-100 pt-4 text-slate-400">
              {t("runnerEditorialReviews", { count: run.discussionState.editorialReviewCount })}
            </div>
            {run.discussionState.floorQueue.length > 0 && (
              <div className="border-t border-slate-100 pt-4">
                <dt className="font-semibold uppercase tracking-wide text-slate-400">{t("runnerFloorQueue")}</dt>
                <dd className="mt-2 space-y-2">
                  {run.discussionState.floorQueue.slice(0, 3).map((request) => (
                    <p key={`${request.participantIndex}-${request.reason}`} className="leading-5 text-slate-600">
                      <span className="font-semibold text-slate-700">{liveTalk.participants[request.participantIndex]?.name}: </span>
                      {request.reason}
                    </p>
                  ))}
                </dd>
              </div>
            )}
          </dl>
        </aside>}
      </div>
      </div>
      {startConfirmation}
    </>
  );
}
