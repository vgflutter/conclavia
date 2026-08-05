import Link from "next/link";

import { getRequestLocale } from "@/i18n/server";
import { translate } from "@/i18n/translations";

export default async function TalkNotFound() {
  const locale = await getRequestLocale();
  const t = (key: Parameters<typeof translate>[1]) => translate(locale, key);

  return (
    <div className="container-page py-14">
      <section className="card mx-auto max-w-xl px-6 py-12 text-center">
        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[#295c43]">404</p>
        <h1 className="mt-2 text-2xl font-bold">{t("notFoundTitle")}</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          {t("notFoundDescription")}
        </p>
        <Link href="/talks" className="button-primary mt-6">
          {t("backToTalks")}
        </Link>
      </section>
    </div>
  );
}
