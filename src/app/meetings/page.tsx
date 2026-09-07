import type { Metadata } from "next";
import Link from "next/link";
import type { FilterQuery } from "mongoose";

import { getRequestLocale } from "@/i18n/server";
import type { Locale } from "@/i18n/locale";
import {
  formatMeetingDate,
  meetingPlatformLabel,
  meetingStatusLabel,
} from "@/lib/meeting-presentation";
import { connectToDatabase } from "@/lib/mongodb";
import { serializeMeeting } from "@/lib/serialize-meeting";
import { serializeMeetingSeries } from "@/lib/serialize-meeting-series";
import { MeetingModel } from "@/models/Meeting";
import { MeetingSeriesModel } from "@/models/MeetingSeries";
import type {
  MeetingRecord,
  MeetingResponse,
  MeetingSeriesResponse,
  MeetingStatus,
} from "@/types/meeting";

export const dynamic = "force-dynamic";

const DASHBOARD_ATTENTION_LIMIT = 3;
const DASHBOARD_MEETING_LIMIT = 6;
const DASHBOARD_SERIES_LIMIT = 4;
const PAGE_SIZE = 20;
const attentionStatuses: MeetingStatus[] = [
  "joining",
  "waiting_room",
  "live",
  "processing",
  "failed",
];

type MeetingView = "attention" | "series" | "upcoming" | "history";

function firstSearchParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function selectedMeetingView(value: string | undefined): MeetingView | undefined {
  return value === "attention" ||
    value === "series" ||
    value === "upcoming" ||
    value === "history"
    ? value
    : undefined;
}

function selectedPage(value: string | undefined): number {
  const page = Number.parseInt(value || "1", 10);
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  return { title: locale === "it" ? "Meeting" : "Meetings" };
}

function statusClass(status: MeetingResponse["status"]): string {
  if (status === "live" || status === "joining") {
    return "bg-emerald-100 text-emerald-800";
  }
  if (status === "waiting_room" || status === "processing" || status === "failed") {
    return "bg-amber-100 text-amber-800";
  }
  if (status === "completed") return "bg-slate-100 text-slate-700";
  if (status === "cancelled") return "bg-red-50 text-red-700";
  return "bg-[#e4eee7] text-[#295c43]";
}

function MeetingCard({ meeting, locale }: { meeting: MeetingResponse; locale: Locale }) {
  const isItalian = locale === "it";

  return (
    <Link
      href={`/meetings/${meeting.id}`}
      className="card group block p-5 transition hover:-translate-y-0.5 hover:border-[#b9cabe] hover:shadow-[0_16px_45px_rgba(34,61,45,0.08)] sm:p-6"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${statusClass(meeting.status)}`}
            >
              {meetingStatusLabel(locale, meeting.status)}
            </span>
            <span className="text-xs font-medium text-slate-500">
              {meetingPlatformLabel(meeting.platform, locale)}
            </span>
          </div>
          <h3 className="mt-3 truncate text-lg font-semibold tracking-tight group-hover:text-[#295c43]">
            {meeting.title}
          </h3>
          <p className="mt-1 text-sm font-medium text-slate-600">
            {formatMeetingDate(meeting.scheduledStart, locale, meeting.timezone)}
          </p>
        </div>
        <span className="mt-1 text-lg text-slate-300 transition group-hover:translate-x-1 group-hover:text-[#295c43]">
          →
        </span>
      </div>
      {meeting.objective && (
        <p className="mt-4 line-clamp-2 text-sm leading-6 text-slate-500">
          {meeting.objective}
        </p>
      )}
      <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-slate-100 pt-4 text-xs text-slate-500">
        <span>
          {meeting.agenda.length}{" "}
          {isItalian
            ? meeting.agenda.length === 1
              ? "punto in scaletta"
              : "punti in scaletta"
            : meeting.agenda.length === 1
              ? "agenda item"
              : "agenda items"}
        </span>
        <span>•</span>
        <span>
          {meeting.summary.rememberedFacts.length}{" "}
          {isItalian
            ? meeting.summary.rememberedFacts.length === 1
              ? "ricordo"
              : "ricordi"
            : meeting.summary.rememberedFacts.length === 1
              ? "memory"
              : "memories"}
        </span>
      </div>
    </Link>
  );
}

function attentionReason(locale: Locale, meeting: MeetingResponse): string {
  const isItalian = locale === "it";
  if (meeting.status === "joining") {
    return isItalian ? "Sta entrando nel meeting" : "Joining the meeting";
  }
  if (meeting.status === "waiting_room") {
    return isItalian ? "Ammettilo dalla sala d’attesa" : "Admit it from the waiting room";
  }
  if (meeting.status === "live") {
    return isItalian ? "Meeting in corso" : "Meeting in progress";
  }
  if (meeting.status === "processing") {
    return isItalian ? "Rivedi e salva il riepilogo" : "Review and save the summary";
  }
  return isItalian ? "Controlla l’ingresso al meeting" : "Check the meeting entry";
}

function CollectionHeading({
  title,
  description,
  total,
  locale,
  view,
  expanded,
  hasMore,
}: {
  title: string;
  description?: string;
  total: number;
  locale: Locale;
  view: MeetingView;
  expanded: boolean;
  hasMore: boolean;
}) {
  const isItalian = locale === "it";

  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
        {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
      </div>
      <div className="flex items-center gap-3">
        <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-slate-500">
          {total}
        </span>
        {expanded ? (
          <Link href="/meetings" className="text-sm font-semibold text-[#295c43] hover:underline">
            {isItalian ? "Torna alla panoramica" : "Back to overview"}
          </Link>
        ) : hasMore ? (
          <Link href={`/meetings?view=${view}`} className="text-sm font-semibold text-[#295c43] hover:underline">
            {isItalian ? "Vedi tutti" : "View all"}
          </Link>
        ) : null}
      </div>
    </div>
  );
}

function Pagination({
  view,
  page,
  total,
  locale,
}: {
  view: MeetingView;
  page: number;
  total: number;
  locale: Locale;
}) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (pages <= 1) return null;
  const isItalian = locale === "it";

  return (
    <nav aria-label={isItalian ? "Paginazione" : "Pagination"} className="mt-5 flex items-center justify-between gap-4">
      {page > 1 ? (
        <Link href={`/meetings?view=${view}&page=${page - 1}`} className="button-secondary">
          ← {isItalian ? "Precedenti" : "Previous"}
        </Link>
      ) : <span />}
      <span className="text-sm text-slate-500">
        {isItalian ? `Pagina ${page} di ${pages}` : `Page ${page} of ${pages}`}
      </span>
      {page < pages ? (
        <Link href={`/meetings?view=${view}&page=${page + 1}`} className="button-secondary">
          {isItalian ? "Successivi" : "Next"} →
        </Link>
      ) : <span />}
    </nav>
  );
}

function AttentionSection({
  meetings,
  total,
  locale,
  expanded,
  page,
}: {
  meetings: MeetingResponse[];
  total: number;
  locale: Locale;
  expanded: boolean;
  page: number;
}) {
  const isItalian = locale === "it";

  return (
    <section>
      <CollectionHeading
        title={isItalian ? "Da gestire" : "Needs action"}
        description={isItalian
          ? "Solo gli appuntamenti per cui serve una tua azione."
          : "Only appointments that currently need your action."}
        total={total}
        locale={locale}
        view="attention"
        expanded={expanded}
        hasMore={!expanded && total > DASHBOARD_ATTENTION_LIMIT}
      />
      <div className="card divide-y divide-slate-100 overflow-hidden">
        {meetings.map((meeting) => (
          <Link
            key={meeting.id}
            href={`/meetings/${meeting.id}`}
            className="group grid gap-3 px-5 py-4 transition hover:bg-[#f7faf7] sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-6"
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${statusClass(meeting.status)}`}>
                  {meetingStatusLabel(locale, meeting.status)}
                </span>
                {meeting.seriesLabel && (
                  <span className="truncate text-xs font-medium text-slate-400">
                    {meeting.seriesLabel}
                  </span>
                )}
              </div>
              <h3 className="mt-2 truncate text-base font-semibold group-hover:text-[#295c43]">
                {meeting.title}
              </h3>
              <p className="mt-1 text-sm text-slate-500">
                {formatMeetingDate(meeting.scheduledStart, locale, meeting.timezone)}
              </p>
            </div>
            <div className="flex items-center justify-between gap-4 sm:justify-end">
              <span className="text-sm font-medium text-amber-800">
                {attentionReason(locale, meeting)}
              </span>
              <span className="text-lg text-slate-300 transition group-hover:translate-x-1 group-hover:text-[#295c43]">→</span>
            </div>
          </Link>
        ))}
      </div>
      {expanded && <Pagination view="attention" page={page} total={total} locale={locale} />}
    </section>
  );
}

function MeetingSection({
  title,
  description,
  empty,
  meetings,
  total,
  locale,
  view,
  expanded,
  page,
}: {
  title: string;
  description?: string;
  empty: string;
  meetings: MeetingResponse[];
  total: number;
  locale: Locale;
  view: Extract<MeetingView, "upcoming" | "history">;
  expanded: boolean;
  page: number;
}) {
  return (
    <section>
      <CollectionHeading
        title={title}
        description={description}
        total={total}
        locale={locale}
        view={view}
        expanded={expanded}
        hasMore={!expanded && total > DASHBOARD_MEETING_LIMIT}
      />
      {meetings.length ? (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            {meetings.map((meeting) => (
              <MeetingCard key={meeting.id} meeting={meeting} locale={locale} />
            ))}
          </div>
          {expanded && <Pagination view={view} page={page} total={total} locale={locale} />}
        </>
      ) : (
        <div className="card border-dashed p-6 text-sm leading-6 text-slate-500">{empty}</div>
      )}
    </section>
  );
}

function MeetingSeriesCard({
  series,
  meetings,
  locale,
}: {
  series: MeetingSeriesResponse;
  meetings: MeetingResponse[];
  locale: Locale;
}) {
  const isItalian = locale === "it";
  const nextMeeting = meetings.find((meeting) => meeting.status === "scheduled");
  const liveMeeting = meetings.find((meeting) =>
    ["joining", "waiting_room", "live", "processing", "failed"].includes(meeting.status),
  );
  const completedCount = meetings.filter((meeting) => meeting.status === "completed").length;
  const status = liveMeeting?.status ?? nextMeeting?.status ?? "completed";

  return (
    <Link
      href={`/meetings/series/${series.id}`}
      className="card group block overflow-hidden transition hover:-translate-y-0.5 hover:border-[#9fbbaa] hover:shadow-[0_18px_50px_rgba(34,61,45,0.09)]"
    >
      <div className="h-1.5 bg-gradient-to-r from-[#295c43] via-[#76aa84] to-[#bde88d]" />
      <div className="p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-[#e4eee7] px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-[#295c43]">
                {isItalian ? "Serie" : "Series"}
              </span>
              <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${statusClass(status)}`}>
                {meetingStatusLabel(locale, status)}
              </span>
            </div>
            <h3 className="mt-3 truncate text-lg font-semibold tracking-tight group-hover:text-[#295c43]">
              {series.title}
            </h3>
          </div>
          <span className="mt-1 text-lg text-slate-300 transition group-hover:translate-x-1 group-hover:text-[#295c43]">→</span>
        </div>
        {series.objective && (
          <p className="mt-3 line-clamp-2 text-sm leading-6 text-slate-500">{series.objective}</p>
        )}
        <div className="mt-5 rounded-xl bg-[#f5f8f5] p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            {liveMeeting
              ? isItalian
                ? "Da gestire ora"
                : "Needs attention now"
              : nextMeeting
                ? isItalian
                  ? "Prossimo appuntamento"
                  : "Next appointment"
                : isItalian
                  ? "Serie completata"
                  : "Series completed"}
          </p>
          {(liveMeeting || nextMeeting) && (
            <p className="mt-1 text-sm font-semibold text-slate-700">
              {formatMeetingDate(
                (liveMeeting || nextMeeting)!.scheduledStart,
                locale,
                series.timezone,
              )}
            </p>
          )}
        </div>
        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-xs text-slate-500">
          <span>{meetings.length} {isItalian ? (meetings.length === 1 ? "appuntamento" : "appuntamenti") : (meetings.length === 1 ? "appointment" : "appointments")}</span>
          <span>•</span>
          <span>{completedCount} {isItalian ? "nella memoria" : "in memory"}</span>
        </div>
      </div>
    </Link>
  );
}

export default async function MeetingsPage({
  searchParams,
}: {
  searchParams: Promise<{
    view?: string | string[];
    page?: string | string[];
  }>;
}) {
  const [locale, query] = await Promise.all([getRequestLocale(), searchParams]);
  const isItalian = locale === "it";
  const view = selectedMeetingView(firstSearchParam(query.view));
  const page = selectedPage(firstSearchParam(query.page));
  const expandedOffset = (page - 1) * PAGE_SIZE;
  const standaloneFilter: FilterQuery<MeetingRecord> = {
    $or: [
      { seriesId: { $exists: false } },
      { seriesId: null },
    ],
  };
  const attentionFilter: FilterQuery<MeetingRecord> = {
    status: { $in: attentionStatuses },
  };
  const upcomingFilter: FilterQuery<MeetingRecord> = {
    $and: [standaloneFilter, { status: "scheduled" }],
  };
  const historyFilter: FilterQuery<MeetingRecord> = {
    $and: [standaloneFilter, { status: { $in: ["completed", "cancelled"] } }],
  };

  await connectToDatabase();
  const [
    attentionDocuments,
    attentionTotal,
    seriesDocuments,
    seriesTotal,
    upcomingDocuments,
    upcomingTotal,
    historyDocuments,
    historyTotal,
    standaloneTotal,
  ] = await Promise.all([
    MeetingModel.find(attentionFilter)
      .sort({ updatedAt: -1 })
      .skip(view === "attention" ? expandedOffset : 0)
      .limit(view === "attention" ? PAGE_SIZE : DASHBOARD_ATTENTION_LIMIT)
      .exec(),
    MeetingModel.countDocuments(attentionFilter).exec(),
    MeetingSeriesModel.find()
      .sort({ updatedAt: -1 })
      .skip(view === "series" ? expandedOffset : 0)
      .limit(view === "series" ? PAGE_SIZE : DASHBOARD_SERIES_LIMIT)
      .exec(),
    MeetingSeriesModel.countDocuments().exec(),
    MeetingModel.find(upcomingFilter)
      .sort({ scheduledStart: 1 })
      .skip(view === "upcoming" ? expandedOffset : 0)
      .limit(view === "upcoming" ? PAGE_SIZE : DASHBOARD_MEETING_LIMIT)
      .exec(),
    MeetingModel.countDocuments(upcomingFilter).exec(),
    MeetingModel.find(historyFilter)
      .sort({ scheduledStart: -1 })
      .skip(view === "history" ? expandedOffset : 0)
      .limit(view === "history" ? PAGE_SIZE : DASHBOARD_MEETING_LIMIT)
      .exec(),
    MeetingModel.countDocuments(historyFilter).exec(),
    MeetingModel.countDocuments(standaloneFilter).exec(),
  ]);
  const seriesIds = seriesDocuments.map((document) => document._id);
  const seriesMeetingDocuments = seriesIds.length
    ? await MeetingModel.find({ seriesId: { $in: seriesIds } })
        .sort({ scheduledStart: 1 })
        .exec()
    : [];

  const attention = attentionDocuments.map(serializeMeeting);
  const series = seriesDocuments.map(serializeMeetingSeries);
  const seriesMeetings = seriesMeetingDocuments.map(serializeMeeting);
  const upcoming = upcomingDocuments.map(serializeMeeting);
  const history = historyDocuments.map(serializeMeeting);
  const contextTotal = seriesTotal + standaloneTotal;

  return (
    <div className="container-page py-10 sm:py-14">
      <header className="relative mb-10 overflow-hidden rounded-[2rem] bg-[#13251b] px-6 py-8 text-white shadow-[0_25px_80px_rgba(24,56,38,0.16)] sm:px-9 sm:py-10">
        <div className="absolute -right-16 -top-24 size-72 rounded-full bg-[#8ccaa0]/15 blur-3xl" />
        <div className="relative flex flex-col gap-7 md:flex-row md:items-end md:justify-between">
          <div className="max-w-3xl">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#bde88d]">
              {isItalian ? "Collega digitale" : "Digital colleague"}
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-[-0.035em] sm:text-5xl">
              {isItalian ? "I tuoi meeting, con memoria." : "Your meetings, with memory."}
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-white/65 sm:text-base sm:leading-7">
              {isItalian
                ? "Programma dove deve entrare, conserva ciò che conta e prepara automaticamente il contesto per l’incontro successivo."
                : "Schedule where it should join, retain what matters and prepare context for the next conversation."}
            </p>
          </div>
          <Link href="/meetings/new" className="button-primary shrink-0 bg-[#bde88d]! text-[#13251b]! hover:bg-[#d2f2aa]!">
            {isItalian ? "Aggiungi meeting" : "Add meeting"}
          </Link>
        </div>
      </header>

      <section className="mb-10 grid gap-3 sm:grid-cols-3">
        <div className="card p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            {isItalian ? "Funzioni" : "Functions"}
          </p>
          <p className="mt-2 text-sm font-semibold">
            {isItalian ? "4 comandi essenziali" : "4 essential commands"}
          </p>
          <p className="mt-1 text-xs text-slate-500">{isItalian ? "ricorda · riepiloga · rispondi · verifica" : "remember · summarize · answer · verify"}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            {isItalian ? "Voce" : "Voice"}
          </p>
          <p className="mt-2 text-sm font-semibold">{isItalian ? "Naturale e bilingue" : "Natural and bilingual"}</p>
          <p className="mt-1 text-xs text-slate-500">{isItalian ? "Italiano e inglese, con pronuncia curata" : "Italian and English, with clear pronunciation"}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            {isItalian ? "Memoria" : "Memory"}
          </p>
          <p className="mt-2 text-sm font-semibold">
            {contextTotal}{" "}
            {isItalian
              ? contextTotal === 1
                ? "contesto"
                : "contesti"
              : contextTotal === 1
                ? "context"
                : "contexts"}
          </p>
          <Link href="/memory" className="mt-1 inline-flex text-xs font-medium text-[#295c43] hover:underline">{isItalian ? "Apri memoria →" : "Open memory →"}</Link>
        </div>
      </section>

      <div className="space-y-10">
        {!view && attentionTotal > 0 && (
          <AttentionSection
            meetings={attention}
            total={attentionTotal}
            locale={locale}
            expanded={false}
            page={1}
          />
        )}

        {view === "attention" && (
          <AttentionSection
            meetings={attention}
            total={attentionTotal}
            locale={locale}
            expanded
            page={page}
          />
        )}

        {(!view || view === "series") && seriesTotal > 0 && (
          <section>
            <CollectionHeading
              title={isItalian ? "Serie di meeting" : "Meeting series"}
              description={isItalian
                ? "Più appuntamenti che condividono la stessa memoria."
                : "Several appointments sharing one memory."}
              total={seriesTotal}
              locale={locale}
              view="series"
              expanded={view === "series"}
              hasMore={!view && seriesTotal > DASHBOARD_SERIES_LIMIT}
            />
            <div className="grid gap-4 md:grid-cols-2">
              {series.map((item) => (
                <MeetingSeriesCard
                  key={item.id}
                  series={item}
                  meetings={seriesMeetings.filter((meeting) => meeting.seriesId === item.id)}
                  locale={locale}
                />
              ))}
            </div>
            {view === "series" && (
              <Pagination view="series" page={page} total={seriesTotal} locale={locale} />
            )}
          </section>
        )}

        {(!view || view === "upcoming") && (
          <MeetingSection
            title={isItalian ? "Prossimi meeting" : "Upcoming meetings"}
            description={isItalian
              ? "Gli appuntamenti singoli già programmati."
              : "Scheduled standalone appointments."}
            empty={
              isItalian
                ? seriesTotal
                  ? "Non ci sono meeting singoli programmati."
                  : "Non hai ancora programmato meeting. Puoi creare un incontro singolo oppure una serie."
                : seriesTotal
                  ? "No single meetings are scheduled."
                  : "No meetings are scheduled yet. Create a single meeting or a series."
            }
            meetings={upcoming}
            total={upcomingTotal}
            locale={locale}
            view="upcoming"
            expanded={view === "upcoming"}
            page={page}
          />
        )}

        {(!view || view === "history") && historyTotal > 0 && (
          <MeetingSection
            title={isItalian ? "Storico" : "History"}
            description={isItalian
              ? "Meeting conclusi e annullati, dal più recente."
              : "Completed and cancelled meetings, newest first."}
            empty=""
            meetings={history}
            total={historyTotal}
            locale={locale}
            view="history"
            expanded={view === "history"}
            page={page}
          />
        )}
      </div>
    </div>
  );
}
