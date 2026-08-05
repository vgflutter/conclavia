import type { Metadata } from "next";

import { TalkForm } from "@/components/TalkForm";
import { getRequestLocale } from "@/i18n/server";
import { translate } from "@/i18n/translations";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  return { title: translate(locale, "createTalkTitle") };
}

export default async function NewTalkPage() {
  const locale = await getRequestLocale();
  const t = (key: Parameters<typeof translate>[1]) => translate(locale, key);

  return (
    <div className="container-page py-10 sm:py-14">
      <div className="mb-8">
        <p className="mb-2 text-sm font-semibold uppercase tracking-[0.16em] text-[#295c43]">
          {t("configuration")}
        </p>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{t("createTalkTitle")}</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600 sm:text-base">
          {t("createTalkIntro")}
        </p>
      </div>
      <TalkForm />
    </div>
  );
}
