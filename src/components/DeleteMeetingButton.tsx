"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { useTranslations } from "@/i18n/I18nProvider";

export function DeleteMeetingButton({
  meetingId,
  meetingTitle,
  disabled,
  returnHref = "/meetings",
}: {
  meetingId: string;
  meetingTitle: string;
  disabled: boolean;
  returnHref?: string;
}) {
  const router = useRouter();
  const { locale } = useTranslations();
  const isItalian = locale === "it";
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function removeMeeting() {
    const confirmed = window.confirm(
      isItalian
        ? `Eliminare “${meetingTitle}” e il relativo storico?`
        : `Delete “${meetingTitle}” and its saved history?`,
    );
    if (!confirmed) return;

    setPending(true);
    setError(undefined);
    try {
      const response = await fetch(`/api/meetings/${meetingId}`, { method: "DELETE" });
      if (!response.ok) throw new Error();
      router.push(returnHref);
      router.refresh();
    } catch {
      setError(
        isItalian
          ? "Non siamo riusciti a eliminare il meeting. Riprova."
          : "We couldn’t delete the meeting. Please try again.",
      );
      setPending(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={removeMeeting}
        disabled={disabled || pending}
        className="w-full rounded-lg px-3 py-2 text-xs font-semibold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {pending
          ? isItalian
            ? "Eliminazione…"
            : "Deleting…"
          : isItalian
            ? "Elimina meeting"
            : "Delete meeting"}
      </button>
      {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
    </div>
  );
}
