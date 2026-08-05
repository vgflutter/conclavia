"use client";

import { useTranslations } from "@/i18n/I18nProvider";

export default function TalksError({ reset }: { reset: () => void }) {
  const { t } = useTranslations();

  return (
    <div className="container-page py-14">
      <section className="card mx-auto max-w-xl px-6 py-12 text-center">
        <h1 className="text-2xl font-bold">{t("loadErrorTitle")}</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          {t("loadErrorDescription")}
        </p>
        <button type="button" onClick={reset} className="button-primary mt-6">
          {t("tryAgain")}
        </button>
      </section>
    </div>
  );
}
