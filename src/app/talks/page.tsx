import type { Metadata } from "next";
import Link from "next/link";

import { getRequestLocale } from "@/i18n/server";
import { talkLanguageLabel, translate, type Locale } from "@/i18n/translations";
import { connectToDatabase } from "@/lib/mongodb";
import { serializeTalk } from "@/lib/serialize-talk";
import { TalkModel } from "@/models/Talk";

export const dynamic = "force-dynamic";

function formatDate(value: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === "it" ? "it-IT" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  return { title: translate(locale, "talksTitle") };
}

export default async function TalksPage() {
  const locale = await getRequestLocale();
  const t = (
    key: Parameters<typeof translate>[1],
    values?: Record<string, string | number>,
  ) => translate(locale, key, values);
  await connectToDatabase();
  const documents = await TalkModel.find().sort({ updatedAt: -1 }).exec();
  const talks = documents.map(serializeTalk);

  return (
    <div className="container-page py-10 sm:py-14">
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-2 text-sm font-semibold uppercase tracking-[0.16em] text-[#295c43]">
            {t("library")}
          </p>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{t("talksTitle")}</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600 sm:text-base">
            {t("talksIntro")}
          </p>
        </div>
        <Link href="/talks/new" className="button-primary w-full sm:w-auto">
          {t("createTalk")}
        </Link>
      </div>

      {talks.length === 0 ? (
        <section className="card px-6 py-14 text-center sm:px-10">
          <div className="mx-auto mb-4 flex size-11 items-center justify-center rounded-full bg-[#e4eee7] text-xl text-[#295c43]">
            +
          </div>
          <h2 className="text-lg font-semibold">{t("noTalksTitle")}</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-600">
            {t("noTalksDescription")}
          </p>
          <Link href="/talks/new" className="button-primary mt-6">
            {t("createFirstTalk")}
          </Link>
        </section>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {talks.map((talk) => (
            <li key={talk.id}>
              <Link
                href={`/talks/${talk.id}`}
                className="card block h-full p-5 transition hover:-translate-y-0.5 hover:border-[#a9b9ae] hover:shadow-sm"
              >
                <div className="mb-5 flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-semibold tracking-tight">{talk.title}</h2>
                    <p className="mt-1 line-clamp-2 text-sm leading-6 text-slate-600">
                      {talk.topic}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${
                      talk.status === "ready"
                        ? "bg-emerald-100 text-emerald-800"
                        : "bg-amber-100 text-amber-800"
                    }`}
                  >
                    {t(talk.status === "ready" ? "statusReady" : "statusDraft")}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                  <span>{talkLanguageLabel(locale, talk.language)}</span>
                  <span>
                    {t("castSummary", {
                      ai: talk.participants.filter((item) => item.kind === "ai").length,
                      human: talk.participants.filter((item) => item.kind === "human").length,
                      open: talk.participants.filter((item) => item.kind === "unassigned").length,
                    })}
                  </span>
                  <span>
                    {t(
                      talk.moderator.kind === "ai"
                        ? "moderatorAi"
                        : talk.moderator.kind === "human"
                          ? "moderatorHuman"
                          : "moderatorNone",
                    )}
                  </span>
                  <span>{t("updated")} {formatDate(talk.updatedAt, locale)}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
