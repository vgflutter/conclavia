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

function escapeSearch(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function meetingsHref(view?: MeetingView, page = 1, search = ""): string {
  const query = new URLSearchParams();
  if (view) query.set("view", view);
  if (page > 1) query.set("page", String(page));
  if (search) query.set("q", search);
  const suffix = query.toString();
  return suffix ? `/meetings?${suffix}` : "/meetings";
}

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

function isPastScheduled(meeting: MeetingResponse, now: number): boolean {
  return meeting.status === "scheduled" && new Date(meeting.scheduledStart).getTime() < now;
}

function dashboardStatusLabel(locale: Locale, meeting: MeetingResponse, now: number): string {
  if (isPastScheduled(meeting, now)) {
    return locale === "it" ? "Data superata" : "Past date";
  }
  return meetingStatusLabel(locale, meeting.status);
}

function dashboardStatusClass(meeting: MeetingResponse, now: number): string {
  return isPastScheduled(meeting, now)
    ? "bg-amber-100 text-amber-800"
    : statusClass(meeting.status);
}

function MeetingCard({ meeting, locale }: { meeting: MeetingResponse; locale: Locale }) {
  const isItalian = locale === "it";

  return (
    <Link
      href={`/meetings/${meeting.id}`}
      className="card group block min-w-0 p-5 transition hover:-translate-y-0.5 hover:border-[#b9cabe] hover:shadow-[0_16px_45px_rgba(34,61,45,0.08)] sm:p-6"
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

function attentionReason(locale: Locale, meeting: MeetingResponse, now: number): string {
  const isItalian = locale === "it";
  if (isPastScheduled(meeting, now)) {
    return isItalian ? "Controlla il meeting non avviato" : "Review the meeting that did not start";
  }
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
  search,
}: {
  title: string;
  description?: string;
  total: number;
  locale: Locale;
  view: MeetingView;
  expanded: boolean;
  hasMore: boolean;
  search: string;
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
          <Link href={meetingsHref(undefined, 1, search)} className="text-sm font-semibold text-[#295c43] hover:underline">
            {isItalian ? "Torna alla panoramica" : "Back to overview"}
          </Link>
        ) : hasMore ? (
          <Link href={meetingsHref(view, 1, search)} className="text-sm font-semibold text-[#295c43] hover:underline">
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
  search,
}: {
  view: MeetingView;
  page: number;
  total: number;
  locale: Locale;
  search: string;
}) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (pages <= 1) return null;
  const isItalian = locale === "it";

  return (
    <nav aria-label={isItalian ? "Paginazione" : "Pagination"} className="mt-5 flex items-center justify-between gap-4">
      {page > 1 ? (
        <Link href={meetingsHref(view, page - 1, search)} className="button-secondary">
          ← {isItalian ? "Precedenti" : "Previous"}
        </Link>
      ) : <span />}
      <span className="text-sm text-slate-500">
        {isItalian ? `Pagina ${page} di ${pages}` : `Page ${page} of ${pages}`}
      </span>
      {page < pages ? (
        <Link href={meetingsHref(view, page + 1, search)} className="button-secondary">
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
  search,
  referenceTime,
}: {
  meetings: MeetingResponse[];
  total: number;
  locale: Locale;
  expanded: boolean;
  page: number;
  search: string;
  referenceTime: number;
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
        search={search}
      />
      {meetings.length ? (
        <div className="card divide-y divide-slate-100 overflow-hidden">
          {meetings.map((meeting) => (
            <Link
              key={meeting.id}
              href={`/meetings/${meeting.id}`}
              className="group grid gap-3 px-5 py-4 transition hover:bg-[#f7faf7] sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-6"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${dashboardStatusClass(meeting, referenceTime)}`}>
                    {dashboardStatusLabel(locale, meeting, referenceTime)}
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
                  {attentionReason(locale, meeting, referenceTime)}
                </span>
                <span className="text-lg text-slate-300 transition group-hover:translate-x-1 group-hover:text-[#295c43]">→</span>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="card border-dashed p-6 text-sm text-slate-500">
          {isItalian ? "Nessun meeting richiede attenzione." : "No meetings need attention."}
        </div>
      )}
      {expanded && <Pagination view="attention" page={page} total={total} locale={locale} search={search} />}
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
  search,
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
  search: string;
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
        search={search}
      />
      {meetings.length ? (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            {meetings.map((meeting) => (
              <MeetingCard key={meeting.id} meeting={meeting} locale={locale} />
            ))}
          </div>
          {expanded && <Pagination view={view} page={page} total={total} locale={locale} search={search} />}
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
  referenceTime,
}: {
  series: MeetingSeriesResponse;
  meetings: MeetingResponse[];
  locale: Locale;
  referenceTime: number;
}) {
  const isItalian = locale === "it";
  const now = referenceTime;
  const nextMeeting = meetings.find(
    (meeting) => meeting.status === "scheduled" && !isPastScheduled(meeting, now),
  );
  const overdueMeeting = [...meetings]
    .reverse()
    .find((meeting) => isPastScheduled(meeting, now));
  const liveMeeting = meetings.find((meeting) =>
    ["joining", "waiting_room", "live", "processing", "failed"].includes(meeting.status),
  );
  const completedCount = meetings.filter((meeting) => meeting.status === "completed").length;
  const highlightedMeeting = liveMeeting || overdueMeeting || nextMeeting;
  const status = highlightedMeeting?.status ?? "completed";

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
              <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${overdueMeeting && !liveMeeting ? "bg-amber-100 text-amber-800" : statusClass(status)}`}>
                {overdueMeeting && !liveMeeting
                  ? isItalian ? "Data superata" : "Past date"
                  : meetingStatusLabel(locale, status)}
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
              : overdueMeeting
                ? isItalian
                  ? "Appuntamento da controllare"
                  : "Appointment to review"
              : nextMeeting
                ? isItalian
                  ? "Prossimo appuntamento"
                  : "Next appointment"
                : isItalian
                  ? "Serie completata"
                  : "Series completed"}
          </p>
          {highlightedMeeting && (
            <p className="mt-1 text-sm font-semibold text-slate-700">
              {formatMeetingDate(
                highlightedMeeting.scheduledStart,
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
    q?: string | string[];
  }>;
}) {
  const [locale, query] = await Promise.all([getRequestLocale(), searchParams]);
  const isItalian = locale === "it";
  const view = selectedMeetingView(firstSearchParam(query.view));
  const page = selectedPage(firstSearchParam(query.page));
  const search = (firstSearchParam(query.q) || "").trim().slice(0, 120);
  const now = new Date();
  const searchExpression = search ? escapeSearch(search) : "";
  const meetingSearchFilter: FilterQuery<MeetingRecord> = searchExpression
    ? {
        $or: [
          { title: { $regex: searchExpression, $options: "i" } },
          { objective: { $regex: searchExpression, $options: "i" } },
          { seriesLabel: { $regex: searchExpression, $options: "i" } },
        ],
      }
    : {};
  const seriesSearchFilter = searchExpression
    ? {
        $or: [
          { title: { $regex: searchExpression, $options: "i" } },
          { objective: { $regex: searchExpression, $options: "i" } },
        ],
      }
    : {};
  const expandedOffset = (page - 1) * PAGE_SIZE;
  const standaloneFilter: FilterQuery<MeetingRecord> = {
    $or: [
      { seriesId: { $exists: false } },
      { seriesId: null },
    ],
  };
  const attentionFilter: FilterQuery<MeetingRecord> = {
    $and: [
      {
        $or: [
          { status: { $in: attentionStatuses } },
          { status: "scheduled", scheduledStart: { $lt: now } },
        ],
      },
      meetingSearchFilter,
    ],
  };
  const upcomingFilter: FilterQuery<MeetingRecord> = {
    $and: [
      standaloneFilter,
      { status: "scheduled", scheduledStart: { $gte: now } },
      meetingSearchFilter,
    ],
  };
  const historyFilter: FilterQuery<MeetingRecord> = {
    $and: [standaloneFilter, { status: { $in: ["completed", "cancelled"] } }, meetingSearchFilter],
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
    MeetingSeriesModel.find(seriesSearchFilter)
      .sort({ updatedAt: -1 })
      .skip(view === "series" ? expandedOffset : 0)
      .limit(view === "series" ? PAGE_SIZE : DASHBOARD_SERIES_LIMIT)
      .exec(),
    MeetingSeriesModel.countDocuments(seriesSearchFilter).exec(),
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
    MeetingModel.countDocuments({ $and: [standaloneFilter, meetingSearchFilter] }).exec(),
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
  const visibleTotal = seriesTotal + standaloneTotal;
  const searchResultTotal = view === "attention"
    ? attentionTotal
    : view === "series"
      ? seriesTotal
      : view === "upcoming"
        ? upcomingTotal
        : view === "history"
          ? historyTotal
          : visibleTotal;

  return (
    <div className="container-page py-8 sm:py-12">
      <header className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-3xl">
          <p className="section-kicker">{isItalian ? "Collega digitale" : "Digital colleague"}</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
            {isItalian ? "Meeting" : "Meetings"}
          </h1>
          <p className="mt-2 text-sm leading-6 text-slate-600 sm:text-base">
            {isItalian
              ? "Prepara gli incontri, segui quelli in corso e ritrova subito ciò che conta."
              : "Prepare conversations, follow active meetings and quickly find what matters."}
          </p>
        </div>
        <Link href="/meetings/new" className="button-primary shrink-0">
          <span aria-hidden="true" className="mr-1">＋</span>
          {isItalian ? "Nuovo meeting" : "New meeting"}
        </Link>
      </header>

      <div className="card mb-9 p-2 sm:flex sm:items-center sm:gap-2">
        <nav aria-label={isItalian ? "Filtra meeting" : "Filter meetings"} className="grid grid-cols-2 gap-1 sm:flex sm:flex-1">
          {[
            { value: undefined, it: "Panoramica", en: "Overview" },
            { value: "attention" as const, it: "Da gestire", en: "Needs action" },
            { value: "series" as const, it: "Serie", en: "Series" },
            { value: "upcoming" as const, it: "Prossimi", en: "Upcoming" },
            { value: "history" as const, it: "Storico", en: "History" },
          ].map((item) => {
            const active = view === item.value;
            return (
              <Link
                key={item.value || "overview"}
                href={meetingsHref(item.value, 1, search)}
                aria-current={active ? "page" : undefined}
                className={`rounded-lg px-3 py-2.5 text-center text-sm font-semibold transition ${active ? "bg-[#e7f0e9] text-[#24563d]" : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"}`}
              >
                {isItalian ? item.it : item.en}
              </Link>
            );
          })}
        </nav>
        <form action="/meetings" className="mt-2 flex gap-2 border-t border-slate-100 pt-2 sm:mt-0 sm:w-80 sm:border-l sm:border-t-0 sm:pl-2 sm:pt-0">
          {view && <input type="hidden" name="view" value={view} />}
          <label className="sr-only" htmlFor="meeting-search">{isItalian ? "Cerca meeting" : "Search meetings"}</label>
          <input id="meeting-search" name="q" type="search" defaultValue={search} className="input min-w-0" placeholder={isItalian ? "Cerca per titolo o obiettivo" : "Search title or objective"} />
          <button type="submit" className="button-secondary shrink-0">
            {isItalian ? "Cerca" : "Search"}
          </button>
        </form>
      </div>

      {search && (
        <div className="mb-7 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[#edf4ef] px-4 py-3 text-sm">
          <p>
            <strong>{searchResultTotal}</strong>{" "}
            {isItalian
              ? `${searchResultTotal === 1 ? "risultato" : "risultati"} per “${search}”`
              : `${searchResultTotal === 1 ? "result" : "results"} for “${search}”`}
          </p>
          <Link href={meetingsHref(view)} className="font-semibold text-[#295c43] hover:underline">{isItalian ? "Azzera ricerca" : "Clear search"}</Link>
        </div>
      )}

      <div className="space-y-10">
        {!view && attentionTotal > 0 && (
          <AttentionSection
            meetings={attention}
            total={attentionTotal}
            locale={locale}
            expanded={false}
            page={1}
            search={search}
            referenceTime={now.getTime()}
          />
        )}

        {view === "attention" && (
          <AttentionSection
            meetings={attention}
            total={attentionTotal}
            locale={locale}
            expanded
            page={page}
            search={search}
            referenceTime={now.getTime()}
          />
        )}

        {((!view && seriesTotal > 0) || view === "series") && (
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
              search={search}
            />
            {series.length ? (
              <div className="grid gap-4 md:grid-cols-2">
                {series.map((item) => (
                  <MeetingSeriesCard
                    key={item.id}
                    series={item}
                  meetings={seriesMeetings.filter((meeting) => meeting.seriesId === item.id)}
                  locale={locale}
                  referenceTime={now.getTime()}
                  />
                ))}
              </div>
            ) : (
              <div className="card border-dashed p-6 text-sm text-slate-500">
                {isItalian ? "Nessuna serie trovata." : "No meeting series found."}
              </div>
            )}
            {view === "series" && (
              <Pagination view="series" page={page} total={seriesTotal} locale={locale} search={search} />
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
              search
                ? isItalian ? "Nessun meeting corrisponde alla ricerca." : "No meetings match your search."
                : isItalian
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
            search={search}
          />
        )}

        {((!view && historyTotal > 0) || view === "history") && (
          <MeetingSection
            title={isItalian ? "Storico" : "History"}
            description={isItalian
              ? "Meeting conclusi e annullati, dal più recente."
              : "Completed and cancelled meetings, newest first."}
            empty={search
              ? isItalian ? "Nessun meeting concluso corrisponde alla ricerca." : "No completed meetings match your search."
              : isItalian ? "Lo storico è ancora vuoto." : "History is empty."}
            meetings={history}
            total={historyTotal}
            locale={locale}
            view="history"
            expanded={view === "history"}
            page={page}
            search={search}
          />
        )}
      </div>
    </div>
  );
}
