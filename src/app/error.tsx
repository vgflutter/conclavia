"use client";

import { useTranslations } from "@/i18n/I18nProvider";

export default function AppError({ retry }: { retry: () => void }) {
  const { locale } = useTranslations();
  const isItalian = locale === "it";

  return (
    <div className="container-page py-16">
      <section className="card mx-auto max-w-xl p-8 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#295c43]">
          {isItalian ? "Qualcosa non ha funzionato" : "Something went wrong"}
        </p>
        <h1 className="mt-3 text-2xl font-bold">
          {isItalian ? "Non riusciamo a caricare questa schermata" : "We can’t load this page"}
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          {isItalian
            ? "I tuoi dati non sono stati modificati. Attendi qualche istante e riprova."
            : "Your data has not been changed. Wait a moment and try again."}
        </p>
        <button type="button" onClick={() => retry()} className="button-primary mt-6">
          {isItalian ? "Riprova" : "Try again"}
        </button>
      </section>
    </div>
  );
}
