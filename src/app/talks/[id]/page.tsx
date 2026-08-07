import type { Metadata } from "next";
import Link from "next/link";
import { Types } from "mongoose";
import { notFound } from "next/navigation";

import { DeleteTalkButton } from "@/components/DeleteTalkButton";
import { getRequestLocale } from "@/i18n/server";
import {
  talkLanguageLabel,
  translate,
  type Locale,
  type TranslationKey,
} from "@/i18n/translations";
import { connectToDatabase } from "@/lib/mongodb";
import { getLlmModel, type LlmModelId } from "@/lib/llm-models";
import { serializeTalk } from "@/lib/serialize-talk";
import type { StudioThemeId } from "@/lib/studio-themes";
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

function formatModel(modelId: LlmModelId, locale: Locale): string {
  const model = getLlmModel(modelId);
  const provider = translate(
    locale,
    model.provider === "openai" ? "providerOpenAI" : "providerGemini",
  );

  return `${provider} · ${model.label}`;
}

function studioThemeKey(theme: StudioThemeId): TranslationKey {
  const keys: Record<StudioThemeId, TranslationKey> = {
    after_hours: "studioThemeAfterHours",
    color_block_club: "studioThemeColorBlock",
    electric_commons: "studioThemeElectric",
    soft_social: "studioThemeSoftSocial",
    broadcast_panel: "studioThemeBroadcast",
    pop_garage: "studioThemeGarage",
    pulp_podcast: "studioThemePulp",
    rooftop_hangout: "studioThemeRooftop",
    late_night: "studioThemeLateNight",
    neon_playground: "studioThemeNeon",
  };
  return keys[theme];
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
  const t = (
    key: TranslationKey,
    values?: Record<string, string | number>,
  ) => translate(locale, key, values);

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
          <div className="flex shrink-0 flex-col gap-2 sm:w-72">
            <Link
              href={`/talks/${talk.id}/run`}
              className="rounded-xl bg-[#295c43] px-4 py-3.5 text-white transition hover:bg-[#1e4934]"
            >
              <span className="block text-sm font-bold">{t("runTalk")}</span>
              <span className="mt-1 block text-xs leading-5 text-emerald-100/80">
                {t("controlRoomHelp")}
              </span>
            </Link>
            <Link
              href={`/talks/${talk.id}/broadcast`}
              target="_blank"
              className="rounded-xl bg-[#07101d] px-4 py-3.5 text-cyan-100 transition hover:bg-[#10233a]"
            >
              <span className="block text-sm font-bold">{t("openBroadcast")}</span>
              <span className="mt-1 block text-xs leading-5 text-slate-400">
                {t("broadcastOutputHelp")}
              </span>
            </Link>
            <Link href={`/talks/${talk.id}/edit`} className="button-secondary text-center">
              {t("editTalk")}
            </Link>
            <Link
              href={`/talks/${talk.id}/edit?duplicate=1`}
              className="button-secondary text-center"
            >
              {t("duplicateTalk")}
            </Link>
            <DeleteTalkButton talkId={talk.id} talkTitle={talk.title} />
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
              <details
                key={`${participant.kind}-${participant.name}-${index}`}
                className="card group overflow-hidden"
              >
                <summary className="flex cursor-pointer list-none items-start gap-3 p-5 sm:p-6">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#e4eee7] text-sm font-bold text-[#295c43]">
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold">
                        {participant.name || t("seatNumber", { number: index + 1 })}
                      </h3>
                      <span className="rounded-full bg-[#edf4ef] px-2 py-0.5 text-[11px] font-semibold text-[#295c43]">
                        {participant.kind === "human"
                          ? t("typeHuman")
                          : participant.kind === "unassigned"
                            ? t("typeUnassigned")
                            : t("typeAi")}
                      </span>
                      {participant.kind !== "unassigned" && (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                          {t(
                            participant.sex === "male"
                              ? "participantMale"
                              : "participantFemale",
                          )}
                        </span>
                      )}
                    </div>
                    {participant.role && (
                      <p className="mt-0.5 text-sm text-slate-500">{participant.role}</p>
                    )}
                    {participant.kind === "ai" && (
                      <p className="mt-1 text-xs font-medium text-slate-500">
                        {t("participantModel", {
                          model: formatModel(
                            participant.modelOverride ?? talk.settings.defaultModel,
                            locale,
                          ),
                        })}
                      </p>
                    )}
                  </div>
                  <span
                    aria-hidden="true"
                    className="mt-1 text-slate-400 transition group-open:rotate-180"
                  >
                    ⌄
                  </span>
                </summary>

                <div className="border-t border-slate-100 px-5 pb-5 sm:px-6 sm:pb-6">

                {participant.kind === "unassigned" ? (
                  <p className="mt-5 rounded-lg bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-500">
                    {t("unassignedDescription")}
                  </p>
                ) : (
                <dl className="mt-5 space-y-4">
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      {participant.kind === "human"
                        ? t("humanBrief")
                        : participant.perspectiveMode === "automatic"
                          ? t("automaticGuidance")
                          : participant.perspectiveMode === "random"
                            ? t("randomConstraints")
                            : t("perspective")}
                    </dt>
                    {participant.perspectivePrompt ? (
                      <dd className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                        {participant.perspectivePrompt}
                      </dd>
                    ) : (
                      <dd className="mt-1 text-sm italic leading-6 text-slate-500">
                        {participant.kind === "human"
                          ? t("notRequired")
                          : participant.perspectiveMode === "random"
                            ? t("randomFreedom")
                            : t("automaticFreedom")}
                      </dd>
                    )}
                  </div>
                  {participant.kind === "ai" && participant.speakingStylePrompt && (
                    <div>
                      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        {t("speakingStyle")}
                      </dt>
                      <dd className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                        {participant.speakingStylePrompt}
                      </dd>
                    </div>
                  )}
                  {participant.kind === "ai" && participant.goals && (
                    <div>
                      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        {t("participantGoals")}
                      </dt>
                      <dd className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                        {participant.goals}
                      </dd>
                    </div>
                  )}
                  {participant.kind === "ai" && participant.nonNegotiables && (
                    <div>
                      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        {t("participantNonNegotiables")}
                      </dt>
                      <dd className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                        {participant.nonNegotiables}
                      </dd>
                    </div>
                  )}
                </dl>
                )}

                {participant.kind === "ai" && (
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
                )}
                </div>
              </details>
            ))}
          </div>
        </section>

        <aside className="space-y-4 lg:sticky lg:top-6">
          <section className="card p-5">
            <h2 className="text-lg font-semibold">{t("talkSettings")}</h2>
            <dl className="mt-5 divide-y divide-slate-100 text-sm">
            <div className="flex items-center justify-between gap-4 py-3 first:pt-0">
              <dt className="text-slate-500">{t("maximumTurns")}</dt>
              <dd className="font-semibold">{talk.settings.maxTurns}</dd>
            </div>
            <div className="flex items-center justify-between gap-4 py-3">
              <dt className="text-slate-500">{t("targetDuration")}</dt>
              <dd className="font-semibold">
                {talk.settings.targetDurationMinutes} {t("minutes")}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4 py-3">
              <dt className="text-slate-500">{t("studioTheme")}</dt>
              <dd className="max-w-40 text-right font-semibold">
                {t(studioThemeKey(talk.settings.studioTheme))}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4 py-3">
              <dt className="text-slate-500">{t("defaultModel")}</dt>
              <dd
                className="max-w-40 text-right font-semibold"
                title={talk.settings.defaultModel}
              >
                {formatModel(talk.settings.defaultModel, locale)}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4 py-3">
              <dt className="text-slate-500">{t("talkPace")}</dt>
              <dd className="font-semibold">
                {t(
                  talk.settings.pace === "fast"
                    ? "paceFast"
                    : talk.settings.pace === "deep"
                      ? "paceDeep"
                      : "paceBalanced",
                )}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4 py-3 last:pb-0">
              <dt className="text-slate-500">{t("turnDynamics")}</dt>
              <dd className="font-semibold">
                {talk.settings.allowInterruptions
                  ? t("openExchange")
                  : t("orderedTurns")}
              </dd>
            </div>
            </dl>
          </section>

          <section className="card p-5">
            <h2 className="text-lg font-semibold">{t("moderation")}</h2>
            {talk.moderator.kind === "none" ? (
              <p className="mt-3 text-sm leading-6 text-slate-500">
                {t("moderatorNoneHelp")}
              </p>
            ) : (
              <div className="mt-4">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold">{talk.moderator.name}</h3>
                  <span className="rounded-full bg-[#edf4ef] px-2 py-0.5 text-[11px] font-semibold text-[#295c43]">
                    {talk.moderator.kind === "ai"
                      ? t("moderatorAi")
                      : t("moderatorHuman")}
                  </span>
                </div>
                {talk.moderator.role && (
                  <p className="mt-1 text-sm text-slate-500">{talk.moderator.role}</p>
                )}
                <dl className="mt-4 divide-y divide-slate-100 text-sm">
                  <div className="flex items-center justify-between gap-4 py-2 first:pt-0">
                    <dt className="text-slate-500">{t("moderatorStyle")}</dt>
                    <dd className="font-semibold">
                      {t(
                        talk.moderator.style === "challenging"
                          ? "styleChallenging"
                          : talk.moderator.style === "facilitating"
                            ? "styleFacilitating"
                            : "styleNeutral",
                      )}
                    </dd>
                  </div>
                  {talk.moderator.kind === "ai" && (
                    <div className="py-2">
                      <dt className="text-slate-500">{t("moderatorModel")}</dt>
                      <dd className="mt-1 font-semibold">
                        {formatModel(
                          talk.moderator.modelOverride ?? talk.settings.defaultModel,
                          locale,
                        )}
                      </dd>
                    </div>
                  )}
                </dl>
                {talk.moderator.instructions && (
                  <div className="mt-4 border-t border-slate-100 pt-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      {t("moderatorInstructions")}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                      {talk.moderator.instructions}
                    </p>
                  </div>
                )}
                <div className="mt-4 flex flex-wrap gap-1.5 border-t border-slate-100 pt-4">
                  {talk.moderator.canInterrupt && (
                    <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-600">
                      {t("moderatorCanInterrupt")}
                    </span>
                  )}
                  {talk.moderator.manageTime && (
                    <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-600">
                      {t("moderatorManageTime")}
                    </span>
                  )}
                  {talk.moderator.summarizeAtEnd && (
                    <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-600">
                      {t("moderatorSummarize")}
                    </span>
                  )}
                </div>
              </div>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
