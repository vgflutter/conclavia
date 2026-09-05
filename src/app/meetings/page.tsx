import type { Metadata } from "next";
import Link from "next/link";

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
import type { MeetingResponse, MeetingSeriesResponse } from "@/types/meeting";

export const dynamic = "force-dynamic";

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

function MeetingSection({
  title,
  empty,
  meetings,
  locale,
}: {
  title: string;
  empty: string;
  meetings: MeetingResponse[];
  locale: Locale;
}) {
  return (
    <section>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
        <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-slate-500">
          {meetings.length}
        </span>
      </div>
      {meetings.length ? (
        <div className="grid gap-4 md:grid-cols-2">
          {meetings.map((meeting) => (
            <MeetingCard key={meeting.id} meeting={meeting} locale={locale} />
          ))}
        </div>
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

export default async function MeetingsPage() {
  const locale = await getRequestLocale();
  const isItalian = locale === "it";
  await connectToDatabase();
  const [documents, seriesDocuments] = await Promise.all([
    MeetingModel.find().sort({ scheduledStart: 1 }).exec(),
    MeetingSeriesModel.find().sort({ updatedAt: -1 }).exec(),
  ]);
  const meetings = documents.map(serializeMeeting);
  const series = seriesDocuments.map(serializeMeetingSeries);
  const standaloneMeetings = meetings.filter((meeting) => !meeting.seriesId);

  const active = standaloneMeetings.filter((meeting) =>
    ["joining", "waiting_room", "live", "processing", "failed"].includes(meeting.status),
  );
  const upcoming = standaloneMeetings.filter((meeting) => meeting.status === "scheduled");
  const past = standaloneMeetings
    .filter((meeting) => ["completed", "cancelled"].includes(meeting.status))
    .sort(
      (left, right) =>
        new Date(right.scheduledStart).getTime() - new Date(left.scheduledStart).getTime(),
    );

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
            {series.length + standaloneMeetings.length}{" "}
            {isItalian
              ? series.length + standaloneMeetings.length === 1
                ? "contesto"
                : "contesti"
              : series.length + standaloneMeetings.length === 1
                ? "context"
                : "contexts"}
          </p>
          <Link href="/memory" className="mt-1 inline-flex text-xs font-medium text-[#295c43] hover:underline">{isItalian ? "Apri memoria →" : "Open memory →"}</Link>
        </div>
      </section>

      <div className="space-y-10">
        {series.length > 0 && (
          <section>
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold tracking-tight">
                  {isItalian ? "Serie di meeting" : "Meeting series"}
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  {isItalian ? "Più appuntamenti che condividono la stessa memoria." : "Several appointments sharing one memory."}
                </p>
              </div>
              <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-slate-500">{series.length}</span>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {series.map((item) => (
                <MeetingSeriesCard
                  key={item.id}
                  series={item}
                  meetings={meetings.filter((meeting) => meeting.seriesId === item.id)}
                  locale={locale}
                />
              ))}
            </div>
          </section>
        )}
        {active.length > 0 && (
          <MeetingSection
            title={isItalian ? "Richiedono attenzione" : "Needs attention"}
            empty=""
            meetings={active}
            locale={locale}
          />
        )}
        <MeetingSection
          title={isItalian ? "Meeting singoli" : "Single meetings"}
          empty={
            isItalian
              ? series.length
                ? "Non ci sono meeting singoli programmati."
                : "Non hai ancora programmato meeting. Puoi creare un incontro singolo oppure una serie."
              : series.length
                ? "No single meetings are scheduled."
                : "No meetings are scheduled yet. Create a single meeting or a series."
          }
          meetings={upcoming}
          locale={locale}
        />
        {past.length > 0 && (
          <MeetingSection
            title={isItalian ? "Storico" : "History"}
            empty=""
            meetings={past}
            locale={locale}
          />
        )}
      </div>
    </div>
  );
}
