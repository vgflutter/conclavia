"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { useTranslations } from "@/i18n/I18nProvider";
import type { MeetingResponse, MeetingStatus } from "@/types/meeting";
import type { MeetingAutomationPublicConfig } from "@/types/meeting-automation";

export function MeetingSessionControls({
  meetingId,
  status,
  autoJoin,
  bot,
  automation,
}: {
  meetingId: string;
  status: MeetingStatus;
  autoJoin: boolean;
  bot: MeetingResponse["bot"];
  automation: MeetingAutomationPublicConfig;
}) {
  const router = useRouter();
  const { locale } = useTranslations();
  const isItalian = locale === "it";
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!["scheduling", "scheduled", "joining", "waiting_room", "joined"].includes(bot.status)) {
      return;
    }
    const timer = window.setInterval(() => router.refresh(), 5_000);
    return () => window.clearInterval(timer);
  }, [bot.status, router]);

  async function runAction(action: "join" | "schedule" | "leave") {
    setPending(true);
    setError(undefined);
    try {
      const response = await fetch(`/api/meetings/${meetingId}/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const payload = (await response.json()) as { meeting?: unknown };
      if (!response.ok || !payload.meeting) throw new Error();
      router.refresh();
    } catch {
      setError(
        isItalian
          ? "Non siamo riusciti ad aggiornare l’ingresso. Riprova."
          : "We couldn’t update the meeting entry. Please try again.",
      );
    } finally {
      setPending(false);
    }
  }

  const liveIntegration = automation.state === "ready";
  const active = ["joining", "waiting_room", "joined"].includes(bot.status);
  const scheduled = bot.status === "scheduled" || bot.status === "scheduling";
  const failed = bot.status === "failed" || status === "failed";

  if (!liveIntegration) return null;

  return (
    <div className="space-y-3">
      <>
          {active ? (
            <button
              type="button"
              onClick={() => runAction("leave")}
              disabled={pending}
              className="button-primary w-full bg-[#9a3d24]! hover:bg-[#7c2f1c]!"
            >
              {pending
                ? isItalian
                  ? "Uscita in corso…"
                  : "Leaving…"
                : isItalian
                  ? "Fai uscire dal meeting"
                  : "Remove from meeting"}
            </button>
          ) : scheduled ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-900">
              {bot.status === "scheduling"
                ? isItalian
                  ? "Programmazione dell’ingresso…"
                  : "Scheduling automatic entry…"
                : isItalian
                  ? "Ingresso automatico programmato"
                  : "Automatic entry scheduled"}
            </div>
          ) : autoJoin && (failed || bot.status === "not_scheduled") ? (
            <button
              type="button"
              onClick={() => runAction("schedule")}
              disabled={pending}
              className="button-primary w-full"
            >
              {pending
                ? isItalian
                  ? "Programmazione…"
                  : "Scheduling…"
                : isItalian
                  ? "Riprova programmazione"
                  : "Retry scheduling"}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => runAction("join")}
              disabled={pending || status === "completed" || status === "cancelled"}
              className="button-primary w-full"
            >
              {pending
                ? isItalian
                  ? "Accesso in corso…"
                  : "Joining…"
                : isItalian
                  ? "Fai entrare ora"
                  : "Join now"}
            </button>
          )}

          {bot.accountEmail && (
            <p className="break-all text-xs font-medium leading-5 text-[#295c43]">
              {isItalian ? "Identità: " : "Identity: "}
              {bot.accountEmail}
            </p>
          )}
          {bot.status === "waiting_room" && (
            <p className="rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-900">
              {isItalian
                ? "Il collega digitale è nella sala d’attesa. Un partecipante deve ammetterlo."
                : "The digital colleague is in the waiting room. A participant must admit it."}
            </p>
          )}
      </>

      {(bot.lastError || error) && (
        <p className="rounded-xl bg-red-50 p-3 text-xs leading-5 text-red-800">
          {error || bot.lastError}
        </p>
      )}
    </div>
  );
}
