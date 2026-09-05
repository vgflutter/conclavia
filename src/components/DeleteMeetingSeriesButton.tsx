"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { useTranslations } from "@/i18n/I18nProvider";

export function DeleteMeetingSeriesButton({
  seriesId,
  title,
  disabled,
}: {
  seriesId: string;
  title: string;
  disabled: boolean;
}) {
  const router = useRouter();
  const { locale } = useTranslations();
  const isItalian = locale === "it";
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function removeSeries() {
    if (
      !window.confirm(
        isItalian
          ? `Eliminare la serie “${title}” e tutti i suoi appuntamenti?`
          : `Delete “${title}” and all its appointments?`,
      )
    ) {
      return;
    }
    setPending(true);
    setError(undefined);
    try {
      const response = await fetch(`/api/meeting-series/${seriesId}`, {
        method: "DELETE",
      });
      const payload = (await response.json()) as { deleted?: boolean };
      if (!response.ok || !payload.deleted) {
        throw new Error();
      }
      router.push("/meetings");
      router.refresh();
    } catch {
      setError(
        isItalian
          ? "Non siamo riusciti a eliminare la serie. Riprova."
          : "We couldn’t delete the series. Please try again.",
      );
      setPending(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={removeSeries}
        disabled={disabled || pending}
        className="rounded-lg px-3 py-2 text-xs font-semibold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {pending
          ? isItalian
            ? "Eliminazione…"
            : "Deleting…"
          : isItalian
            ? "Elimina serie"
            : "Delete series"}
      </button>
      {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
    </div>
  );
}
