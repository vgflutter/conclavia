import type { Metadata } from "next";
import Link from "next/link";
import { Types } from "mongoose";
import { notFound } from "next/navigation";

import { getRequestLocale } from "@/i18n/server";
import {
  talkLanguageLabel,
  translate,
  type Locale,
  type TranslationKey,
} from "@/i18n/translations";
import { connectToDatabase } from "@/lib/mongodb";
import { serializeTalk } from "@/lib/serialize-talk";
import { TalkModel } from "@/models/Talk";

export const dynamic = "force-dynamic";

interface TalkPageProps {
  params: Promise<{ id: string }>;
}

function formatDate(value: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === "it" ? "it-IT" : "en-US", {
    dateStyle: "long",
    timeStyle: "short",
  }).format(new Date(value));
}

export async function generateMetadata({ params }: TalkPageProps): Promise<Metadata> {
  const { id } = await params;
  const locale = await getRequestLocale();

  if (!Types.ObjectId.isValid(id)) {
    return { title: translate(locale, "notFoundTitle") };
  }

  await connectToDatabase();
  const talk = await TalkModel.findById(id).select("title").exec();
  return { title: talk?.title ?? translate(locale, "notFoundTitle") };
}

export default async function TalkPage({ params }: TalkPageProps) {
  const { id } = await params;
  const locale = await getRequestLocale();
  const t = (key: TranslationKey) => translate(locale, key);

  if (!Types.ObjectId.isValid(id)) {
    notFound();
  }

  await connectToDatabase();
  const document = await TalkModel.findById(id).exec();

  if (!document) {
    notFound();
  }

  const talk = serializeTalk(document);

  return (
    <div className="container-page py-10 sm:py-14">
      <Link
        href="/talks"
        className="mb-6 inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-950"
      >
        <span aria-hidden="true">←</span> {t("allTalks")}
      </Link>

      <header className="card mb-6 p-5 sm:p-7">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-3xl">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${
                  talk.status === "ready"
                    ? "bg-emerald-100 text-emerald-800"
                    : "bg-amber-100 text-amber-800"
                }`}
              >
                {t(talk.status === "ready" ? "statusReady" : "statusDraft")}
              </span>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                {talkLanguageLabel(locale, talk.language)}
              </span>
            </div>
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{talk.title}</h1>
            <p className="mt-4 text-base font-medium leading-7 text-slate-800">{talk.topic}</p>
            {talk.description && (
              <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-600">
                {talk.description}
              </p>
            )}
          </div>
        </div>
        <dl className="mt-6 flex flex-wrap gap-x-6 gap-y-2 border-t border-slate-100 pt-5 text-xs text-slate-500">
          <div className="flex gap-1">
            <dt>{t("created")}</dt>
            <dd className="font-medium text-slate-700">{formatDate(talk.createdAt, locale)}</dd>
          </div>
          <div className="flex gap-1">
            <dt>{t("updated")}</dt>
            <dd className="font-medium text-slate-700">{formatDate(talk.updatedAt, locale)}</dd>
          </div>
        </dl>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start">
        <section>
          <div className="mb-4 flex items-baseline justify-between">
            <h2 className="text-xl font-semibold">{t("participants")}</h2>
            <span className="text-sm text-slate-500">{t("exactlyFive")}</span>
          </div>
          <div className="space-y-4">
            {talk.participants.map((participant, index) => (
              <article key={`${participant.name}-${index}`} className="card p-5 sm:p-6">
                <div className="flex items-start gap-3">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#e4eee7] text-sm font-bold text-[#295c43]">
                    {index + 1}
                  </span>
                  <div>
                    <h3 className="font-semibold">{participant.name}</h3>
                    <p className="mt-0.5 text-sm text-slate-500">{participant.role}</p>
                  </div>
                </div>

                <dl className="mt-5 space-y-4">
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      {t("perspective")}
                    </dt>
                    <dd className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                      {participant.perspectivePrompt}
                    </dd>
                  </div>
                  {participant.speakingStylePrompt && (
                    <div>
                      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        {t("speakingStyle")}
                      </dt>
                      <dd className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                        {participant.speakingStylePrompt}
                      </dd>
                    </div>
                  )}
                </dl>

                <dl className="mt-5 grid grid-cols-2 gap-3 border-t border-slate-100 pt-5 sm:grid-cols-4">
                  {[
                    [t("assertiveness"), participant.assertiveness],
                    [t("patience"), participant.patience],
                    [t("interruptiveness"), participant.interruptiveness],
                    [t("baselineTension"), participant.baselineTension],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-lg bg-slate-50 px-3 py-2.5">
                      <dt className="text-[11px] leading-4 text-slate-500">{label}</dt>
                      <dd className="mt-0.5 text-lg font-semibold text-slate-800">{value}</dd>
                    </div>
                  ))}
                </dl>
              </article>
            ))}
          </div>
        </section>

        <aside className="card p-5 lg:sticky lg:top-6">
          <h2 className="text-lg font-semibold">{t("talkSettings")}</h2>
          <dl className="mt-5 divide-y divide-slate-100 text-sm">
            <div className="flex items-center justify-between gap-4 py-3 first:pt-0">
              <dt className="text-slate-500">{t("maximumTurns")}</dt>
              <dd className="font-semibold">{talk.settings.maxTurns}</dd>
            </div>
            <div className="flex items-center justify-between gap-4 py-3">
              <dt className="text-slate-500">{t("interruptions")}</dt>
              <dd className="font-semibold">
                {talk.settings.allowInterruptions ? t("allowed") : t("disabled")}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4 py-3 last:pb-0">
              <dt className="text-slate-500">{t("commonGround")}</dt>
              <dd className="font-semibold">
                {talk.settings.seekCommonGround ? t("sought") : t("notRequired")}
              </dd>
            </div>
          </dl>
        </aside>
      </div>
    </div>
  );
}
