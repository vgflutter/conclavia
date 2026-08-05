"use client";

import { useEffect, useRef, useState } from "react";

import { useTranslations } from "@/i18n/I18nProvider";
import { getLlmModel } from "@/lib/llm-models";
import {
  getTalkRunBlockCode,
  type TalkRunBlockCode,
} from "@/lib/talk-run-compatibility";
import type { TalkResponse } from "@/types/talk";
import type { TalkRunResponse } from "@/types/talk-run";

interface TalkRunnerProps {
  talk: TalkResponse;
  initialRun: TalkRunResponse | null;
}

interface RunApiResponse {
  run?: TalkRunResponse | null;
  error?: string;
  code?: string;
}

function blockTranslationKey(code: TalkRunBlockCode) {
  if (code === "human_participants") return "runnerHumanParticipantsBlocked" as const;
  if (code === "human_moderator") return "runnerHumanModeratorBlocked" as const;
  return "runnerUnassignedBlocked" as const;
}

export function TalkRunner({ talk, initialRun }: TalkRunnerProps) {
  const { t } = useTranslations();
  const [run, setRun] = useState(initialRun);
  const [requestPending, setRequestPending] = useState(false);
  const [autoRunning, setAutoRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stopRequested = useRef(false);
  const blockCode = getTalkRunBlockCode(talk);

  useEffect(() => {
    if (run?.status !== "generating") return;

    const interval = window.setInterval(async () => {
      try {
        const response = await fetch(`/api/runs/${run.id}`);
        const payload = (await response.json()) as RunApiResponse;
        if (response.ok && payload.run) {
          setRun(payload.run);
        }
      } catch {
        // The next poll can recover from a transient network failure.
      }
    }, 2000);

    return () => window.clearInterval(interval);
  }, [run?.id, run?.status]);

  async function createRun(): Promise<TalkRunResponse | undefined> {
    setRequestPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/talks/${talk.id}/runs`, {
        method: "POST",
      });
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
  ): Promise<TalkRunResponse | undefined> {
    setRequestPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/runs/${currentRun.id}/next`, {
        method: "POST",
      });
      const payload = (await response.json()) as RunApiResponse;
      if (payload.run) {
        setRun(payload.run);
      }
      if (!response.ok || !payload.run) {
        setError(payload.error || t("runnerGenerationError"));
        return undefined;
      }
      return payload.run;
    } catch {
      setError(t("networkError"));
      return undefined;
    } finally {
      setRequestPending(false);
    }
  }

  async function runAutomatically() {
    if (!run || run.status === "completed") return;
    if (!window.confirm(t("runnerAutoConfirm"))) return;

    stopRequested.current = false;
    setAutoRunning(true);
    let current: TalkRunResponse | undefined = run;

    try {
      while (
        current &&
        current.status !== "completed" &&
        !stopRequested.current
      ) {
        current = await generateNext(current);
        if (!current || current.status === "failed") break;
      }
    } finally {
      setAutoRunning(false);
    }
  }

  function pauseAutomaticRun() {
    stopRequested.current = true;
  }

  function nextSpeakerLabel(currentRun: TalkRunResponse): string {
    if (currentRun.phase === "opening" || currentRun.phase === "closing") {
      return talk.moderator.name || t("moderation");
    }
    return talk.participants[currentRun.nextParticipantIndex]?.name ?? "";
  }

  if (blockCode) {
    return (
      <section className="card p-6 text-center sm:p-8">
        <div className="mx-auto flex size-11 items-center justify-center rounded-full bg-amber-100 text-lg text-amber-800">
          !
        </div>
        <h2 className="mt-4 text-lg font-semibold">{t("runnerUnavailable")}</h2>
        <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-600">
          {t(blockTranslationKey(blockCode))}
        </p>
      </section>
    );
  }

  if (!run) {
    return (
      <section className="card p-6 text-center sm:p-10">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-[#e4eee7] text-xl text-[#295c43]">
          ▶
        </div>
        <h2 className="mt-4 text-xl font-semibold">{t("runnerReadyTitle")}</h2>
        <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-600">
          {t("runnerReadyDescription", { turns: talk.settings.maxTurns })}
        </p>
        <button
          type="button"
          onClick={createRun}
          disabled={requestPending}
          className="button-primary mt-6"
        >
          {requestPending ? t("runnerCreating") : t("runnerCreateSession")}
        </button>
      </section>
    );
  }

  const progress = Math.min(
    100,
    Math.round((run.participantTurnCount / run.maxTurns) * 100),
  );
  const completed = run.status === "completed";

  return (
    <div className="space-y-5">
      <section className="card p-5 sm:p-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                  completed
                    ? "bg-emerald-100 text-emerald-800"
                    : run.status === "failed"
                      ? "bg-red-100 text-red-800"
                      : "bg-[#edf4ef] text-[#295c43]"
                }`}
              >
                {t(
                  completed
                    ? "runnerStatusCompleted"
                    : run.status === "failed"
                      ? "runnerStatusFailed"
                      : "runnerStatusActive",
                )}
              </span>
              {!completed && (
                <span className="text-xs text-slate-500">
                  {t("runnerNextSpeaker", { name: nextSpeakerLabel(run) })}
                </span>
              )}
            </div>
            <div className="mt-4 flex items-center justify-between gap-4 text-xs text-slate-500">
              <span>
                {t("runnerProgress", {
                  current: run.participantTurnCount,
                  total: run.maxTurns,
                })}
              </span>
              <span>{progress}%</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-[#295c43] transition-[width]"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-2 sm:max-w-sm sm:justify-end">
            {completed ? (
              <button
                type="button"
                onClick={createRun}
                disabled={requestPending}
                className="button-primary"
              >
                {t("runnerNewSession")}
              </button>
            ) : autoRunning ? (
              <button
                type="button"
                onClick={pauseAutomaticRun}
                className="button-secondary"
              >
                {t("runnerPause")}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => generateNext(run)}
                  disabled={requestPending || run.status === "generating"}
                  className="button-secondary flex-1 sm:flex-none"
                >
                  {requestPending || run.status === "generating"
                    ? t("runnerGenerating")
                    : run.status === "failed"
                      ? t("runnerRetry")
                      : t("runnerNextTurn")}
                </button>
                <button
                  type="button"
                  onClick={runAutomatically}
                  disabled={requestPending || run.status === "generating"}
                  className="button-primary flex-1 sm:flex-none"
                >
                  {t("runnerRunAutomatically")}
                </button>
              </>
            )}
          </div>
        </div>
        {autoRunning && (
          <p className="mt-3 text-xs text-slate-500">
            {t("runnerPauseHelp")}
          </p>
        )}
      </section>

      {error && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          {error}
        </div>
      )}

      <section aria-live="polite">
        <div className="mb-4 flex items-baseline justify-between gap-4">
          <h2 className="text-xl font-semibold">{t("runnerTranscript")}</h2>
          <span className="text-xs text-slate-500">
            {t("runnerSavedAutomatically")}
          </span>
        </div>

        {run.messages.length === 0 ? (
          <div className="card px-5 py-10 text-center text-sm text-slate-500">
            {t("runnerEmptyTranscript")}
          </div>
        ) : (
          <ol className="space-y-4">
            {run.messages.map((message) => {
              const model = getLlmModel(message.model);
              return (
                <li
                  key={message.sequence}
                  className={`card p-5 sm:p-6 ${
                    message.speakerType === "moderator"
                      ? "border-[#9fb9aa] bg-[#f5faf6]"
                      : ""
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="flex size-7 items-center justify-center rounded-full bg-[#e4eee7] text-xs font-bold text-[#295c43]">
                          {message.sequence}
                        </span>
                        <h3 className="font-semibold">{message.speakerName}</h3>
                        {message.speakerType === "moderator" && (
                          <span className="rounded-full bg-[#dceadf] px-2 py-0.5 text-[11px] font-semibold text-[#295c43]">
                            {t("moderation")}
                          </span>
                        )}
                      </div>
                      {message.speakerRole && (
                        <p className="ml-9 mt-0.5 text-xs text-slate-500">
                          {message.speakerRole}
                        </p>
                      )}
                    </div>
                    <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-500">
                      {model.label}
                    </span>
                  </div>
                  <p className="mt-4 whitespace-pre-wrap text-sm leading-7 text-slate-700 sm:text-base">
                    {message.content}
                  </p>
                  {(message.inputTokens !== undefined ||
                    message.outputTokens !== undefined) && (
                    <p className="mt-4 border-t border-slate-100 pt-3 text-[11px] text-slate-400">
                      {t("runnerTokenUsage", {
                        input: message.inputTokens ?? "—",
                        output: message.outputTokens ?? "—",
                      })}
                    </p>
                  )}
                </li>
              );
            })}
          </ol>
        )}

        {(requestPending || run.status === "generating") && (
          <div className="card mt-4 flex items-center gap-3 px-5 py-4 text-sm text-slate-500">
            <span className="size-4 animate-spin rounded-full border-2 border-[#295c43] border-t-transparent" />
            {t("runnerGeneratingFor", { name: nextSpeakerLabel(run) })}
          </div>
        )}
      </section>
    </div>
  );
}
