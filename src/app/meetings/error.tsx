"use client";

import { useTranslations } from "@/i18n/I18nProvider";

export default function MeetingsError({ reset }: { reset: () => void }) {
  const { locale } = useTranslations();
  const isItalian = locale === "it";

  return (
    <div className="container-page py-14">
      <div className="card mx-auto max-w-xl p-7 text-center sm:p-10">
        <h1 className="text-2xl font-bold">
          {isItalian ? "Non riesco a caricare i meeting" : "Meetings could not be loaded"}
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-500">
          {isItalian
            ? "Si è verificato un problema temporaneo. Attendi qualche istante e riprova."
            : "A temporary problem occurred. Wait a moment and try again."}
        </p>
        <button type="button" onClick={reset} className="button-primary mt-6">
          {isItalian ? "Riprova" : "Try again"}
        </button>
      </div>
    </div>
  );
}
