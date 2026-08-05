"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { useTranslations } from "@/i18n/I18nProvider";

interface DeleteTalkButtonProps {
  talkId: string;
  talkTitle: string;
}

interface DeleteTalkResponse {
  error?: string;
  code?: string;
}

export function DeleteTalkButton({ talkId, talkTitle }: DeleteTalkButtonProps) {
  const router = useRouter();
  const { t } = useTranslations();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function deleteTalk() {
    if (!window.confirm(t("deleteTalkConfirm", { title: talkTitle }))) {
      return;
    }

    setDeleting(true);
    setError(null);

    try {
      const response = await fetch(`/api/talks/${talkId}`, {
        method: "DELETE",
      });
      const payload = (await response.json()) as DeleteTalkResponse;

      if (!response.ok) {
        setError(
          payload.code === "active_run"
            ? t("deleteTalkActiveRun")
            : t("deleteTalkError"),
        );
        return;
      }

      router.push("/talks");
      router.refresh();
    } catch {
      setError(t("networkError"));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex flex-col items-stretch gap-2 sm:items-end">
      <button
        type="button"
        onClick={deleteTalk}
        disabled={deleting}
        className="inline-flex min-h-10 items-center justify-center rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-700 transition hover:border-red-300 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {deleting ? t("deletingTalk") : t("deleteTalk")}
      </button>
      {error && (
        <p role="alert" className="max-w-64 text-xs leading-5 text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
