"use client";

import { useState } from "react";

import { useTranslations } from "@/i18n/I18nProvider";
import type {
  AudienceMessageResponse,
  AudienceRoomResponse,
} from "@/types/audience";
import type { TalkRunResponse } from "@/types/talk-run";
import type { TalkResponse } from "@/types/talk";

interface AudienceDeskProps {
  talk: TalkResponse;
  run: TalkRunResponse;
  audience: AudienceRoomResponse;
  onAudienceChange: (audience: AudienceRoomResponse) => void;
  onRunChange: (run: TalkRunResponse) => void;
}

interface AudienceApiResponse {
  audience?: AudienceRoomResponse;
  run?: TalkRunResponse;
  error?: string;
}

function statusClass(status: AudienceMessageResponse["status"]): string {
  if (status === "queued") return "bg-amber-100 text-amber-800";
  if (status === "on_air") return "bg-red-100 text-red-700";
  if (status === "used") return "bg-emerald-100 text-emerald-700";
  if (status === "rejected") return "bg-slate-100 text-slate-500";
  if (status === "pending") return "bg-violet-100 text-violet-700";
  return "bg-cyan-100 text-cyan-800";
}

export function AudienceDesk({
  talk,
  run,
  audience,
  onAudienceChange,
  onRunChange,
}: AudienceDeskProps) {
  const { t } = useTranslations();
  const [source, setSource] = useState("");
  const [connectWithReview, setConnectWithReview] = useState(false);
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [pendingAction, setPendingAction] = useState<string>();
  const [error, setError] = useState<string>();

  async function readResponse(response: Response): Promise<AudienceApiResponse> {
    const payload = (await response.json()) as AudienceApiResponse;
    if (!response.ok) throw new Error(payload.error || t("audienceActionError"));
    if (payload.audience) onAudienceChange(payload.audience);
    if (payload.run) onRunChange(payload.run);
    return payload;
  }

  async function connect() {
    if (!source.trim()) return;
    setPendingAction("connect");
    setError(undefined);
    try {
      const response = await fetch(`/api/runs/${run.id}/audience`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: source.trim(),
          moderationEnabled: connectWithReview,
        }),
      });
      await readResponse(response);
      setSource("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("audienceConnectError"));
    } finally {
      setPendingAction(undefined);
    }
  }

  async function disconnect() {
    setPendingAction("disconnect");
    setError(undefined);
    try {
      await readResponse(
        await fetch(`/api/runs/${run.id}/audience`, { method: "DELETE" }),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("audienceActionError"));
    } finally {
      setPendingAction(undefined);
    }
  }

  async function setReview(enabled: boolean) {
    setPendingAction("review");
    setError(undefined);
    try {
      await readResponse(
        await fetch(`/api/runs/${run.id}/audience`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ moderationEnabled: enabled }),
        }),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("audienceActionError"));
    } finally {
      setPendingAction(undefined);
    }
  }

  async function act(
    message: AudienceMessageResponse,
    action: "approve" | "reject" | "on_air" | "host" | "participant" | "prompt",
  ) {
    const actionKey = `${message.id}:${action}`;
    setPendingAction(actionKey);
    setError(undefined);
    try {
      const target = targets[message.id];
      await readResponse(
        await fetch(
          `/api/runs/${run.id}/audience/messages/${encodeURIComponent(message.id)}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action,
              targetParticipantIndex: target === "" || target === undefined
                ? undefined
                : Number(target),
            }),
          },
        ),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("audienceActionError"));
    } finally {
      setPendingAction(undefined);
    }
  }

  const actionableMessages = audience.messages.slice(0, 30);
  const freshCount = audience.messages.filter((message) =>
    message.status === "available" || message.status === "pending",
  ).length;

  return (
    <section className="card overflow-hidden border-[#cfdce8]">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 bg-[linear-gradient(135deg,#f7fbff,#fff)] px-5 py-5 sm:px-6">
        <div>
          <p className="text-xs font-black uppercase tracking-[.16em] text-red-600">
            YouTube Live
          </p>
          <h2 className="mt-1 text-xl font-semibold">{t("audienceDeskTitle")}</h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">
            {t("audienceDeskHelp")}
          </p>
        </div>
        {audience.connected && (
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-red-100 px-2.5 py-1 text-xs font-semibold text-red-700">
              {t("audienceConnected")}
            </span>
            <span className="rounded-full bg-cyan-100 px-2.5 py-1 text-xs font-semibold text-cyan-800">
              {t("audienceNewCount", { count: freshCount })}
            </span>
          </div>
        )}
      </div>

      {!audience.configured && !audience.connected ? (
        <div className="px-5 py-6 sm:px-6">
          <p className="text-sm font-semibold text-amber-800">
            {t("audienceNotConfigured")}
          </p>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            {t("audienceNotConfiguredHelp")}
          </p>
        </div>
      ) : !audience.connected ? (
        <div className="grid gap-4 px-5 py-6 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end sm:px-6">
          <div>
            <label htmlFor="youtube-live-source" className="label">
              {t("audienceSource")}
            </label>
            <input
              id="youtube-live-source"
              value={source}
              onChange={(event) => setSource(event.target.value)}
              className="input"
              placeholder={t("audienceSourcePlaceholder")}
            />
            <label className="mt-3 flex items-start gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={connectWithReview}
                onChange={(event) => setConnectWithReview(event.target.checked)}
                className="mt-1 size-4 accent-[#295c43]"
              />
              <span>
                <strong className="font-semibold text-slate-800">
                  {t("audienceManualReview")}
                </strong>{" "}
                {t("audienceManualReviewHelp")}
              </span>
            </label>
          </div>
          <button
            type="button"
            onClick={() => void connect()}
            disabled={!source.trim() || pendingAction === "connect"}
            className="button-primary"
          >
            {pendingAction === "connect" ? t("audienceConnecting") : t("audienceConnect")}
          </button>
        </div>
      ) : (
        <div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4 sm:px-6">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-800">
                {audience.videoTitle}
              </p>
              <p className="mt-0.5 text-xs text-slate-500">{audience.videoId}</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
                <input
                  type="checkbox"
                  checked={audience.moderationEnabled}
                  disabled={pendingAction === "review"}
                  onChange={(event) => void setReview(event.target.checked)}
                  className="size-4 accent-[#295c43]"
                />
                {t("audienceManualReview")}
              </label>
              <button
                type="button"
                onClick={() => void disconnect()}
                disabled={pendingAction === "disconnect"}
                className="text-xs font-semibold text-slate-500 hover:text-red-700"
              >
                {t("audienceDisconnect")}
              </button>
            </div>
          </div>

          {audience.error && (
            <p className="border-b border-red-100 bg-red-50 px-5 py-3 text-sm text-red-700 sm:px-6">
              {audience.error}
            </p>
          )}
          {actionableMessages.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-slate-500 sm:px-6">
              {t("audienceWaiting")}
            </p>
          ) : (
            <ol className="max-h-[38rem] divide-y divide-slate-100 overflow-y-auto">
              {actionableMessages.map((message) => {
                const target = targets[message.id] ?? "";
                const working = pendingAction?.startsWith(`${message.id}:`) ?? false;
                const canAct = message.status === "available" || message.status === "on_air";
                return (
                  <li key={message.id} className="px-5 py-4 sm:px-6">
                    <div className="flex gap-3">
                      <div
                        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-slate-200 bg-cover bg-center text-xs font-bold uppercase text-slate-600"
                        style={
                          message.authorImageUrl
                            ? { backgroundImage: `url(${JSON.stringify(message.authorImageUrl)})` }
                            : undefined
                        }
                      >
                        {!message.authorImageUrl && message.authorName.slice(0, 1)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-slate-800">
                            {message.authorName}
                          </span>
                          {message.amountDisplayString && (
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800">
                              {message.amountDisplayString}
                            </span>
                          )}
                          {(message.isSponsor || message.isModerator) && (
                            <span className="text-[11px] font-semibold text-slate-500">
                              {message.isModerator ? t("audienceModerator") : t("audienceMember")}
                            </span>
                          )}
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${statusClass(message.status)}`}>
                            {t(`audienceStatus_${message.status}`)}
                          </span>
                        </div>
                        <p className="mt-1.5 text-sm leading-6 text-slate-700">
                          {message.content}
                        </p>

                        {message.status === "pending" ? (
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button type="button" disabled={working} onClick={() => void act(message, "approve")} className="rounded-md bg-[#295c43] px-3 py-1.5 text-xs font-semibold text-white">
                              {t("audienceApprove")}
                            </button>
                            <button type="button" disabled={working} onClick={() => void act(message, "reject")} className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600">
                              {t("audienceReject")}
                            </button>
                          </div>
                        ) : canAct ? (
                          <div className="mt-3 space-y-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <button type="button" disabled={working} onClick={() => void act(message, "on_air")} className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white">
                                {t("audiencePutOnAir")}
                              </button>
                              {talk.moderator.kind !== "none" && (
                                <button type="button" disabled={working || Boolean(run.audienceCue)} onClick={() => void act(message, "host")} className="rounded-md border border-[#9fb9aa] bg-[#f5faf6] px-3 py-1.5 text-xs font-semibold text-[#295c43]">
                                  {t("audienceSendToHost")}
                                </button>
                              )}
                              <button type="button" disabled={working || !target || Boolean(run.audienceCue)} onClick={() => void act(message, "participant")} className="rounded-md border border-cyan-200 bg-cyan-50 px-3 py-1.5 text-xs font-semibold text-cyan-800 disabled:opacity-45">
                                {t("audienceSendToGuest")}
                              </button>
                              <button type="button" disabled={working || Boolean(run.audienceCue)} onClick={() => void act(message, "prompt")} className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600">
                                {t("audienceUseAsPrompt")}
                              </button>
                              <button type="button" disabled={working} onClick={() => void act(message, "reject")} className="px-2 py-1.5 text-xs font-semibold text-slate-400 hover:text-red-700">
                                {t("audienceReject")}
                              </button>
                            </div>
                            <select
                              aria-label={t("audienceTarget")}
                              value={target}
                              onChange={(event) => setTargets((current) => ({ ...current, [message.id]: event.target.value }))}
                              className="input max-w-xs py-1.5 text-xs"
                            >
                              <option value="">{t("audienceTargetAutomatic")}</option>
                              {talk.participants.map((participant, index) => (
                                <option key={index} value={index}>{participant.name}</option>
                              ))}
                            </select>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="border-t border-red-100 bg-red-50 px-5 py-3 text-sm text-red-700 sm:px-6">
          {error}
        </p>
      )}
    </section>
  );
}
