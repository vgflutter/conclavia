import type { Metadata } from "next";
import Link from "next/link";
import { Types } from "mongoose";
import { notFound } from "next/navigation";

import { DeleteMeetingSeriesButton } from "@/components/DeleteMeetingSeriesButton";
import { SeriesAppointmentForm } from "@/components/SeriesAppointmentForm";
import { getRequestLocale } from "@/i18n/server";
import {
  formatMeetingDate,
  meetingPlatformLabel,
  meetingStatusLabel,
} from "@/lib/meeting-presentation";
import { buildMeetingSeriesContinuity } from "@/lib/meeting-continuity";
import { meetingSeriesKey } from "@/lib/meeting-validation";
import { connectToDatabase } from "@/lib/mongodb";
import { serializeMeeting } from "@/lib/serialize-meeting";
import { serializeMeetingSeries } from "@/lib/serialize-meeting-series";
import { MeetingModel } from "@/models/Meeting";
import { MeetingSeriesModel } from "@/models/MeetingSeries";

export const dynamic = "force-dynamic";

interface SeriesPageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: SeriesPageProps): Promise<Metadata> {
  const { id } = await params;
  if (!Types.ObjectId.isValid(id)) return { title: "Serie meeting" };
  await connectToDatabase();
  const series = await MeetingSeriesModel.findById(id).select("title").exec();
  return { title: series?.title || "Serie meeting" };
}

export default async function MeetingSeriesPage({ params }: SeriesPageProps) {
  const { id } = await params;
  const locale = await getRequestLocale();
  const isItalian = locale === "it";
  if (!Types.ObjectId.isValid(id)) notFound();

  await connectToDatabase();
  const document = await MeetingSeriesModel.findById(id).exec();
  if (!document) notFound();
  const meetingDocuments = await MeetingModel.find({ seriesId: document._id })
    .sort({ scheduledStart: 1 })
    .exec();
  const series = serializeMeetingSeries(document);
  const meetings = meetingDocuments.map(serializeMeeting);
  const briefing = await buildMeetingSeriesContinuity(
    series.id,
    meetingSeriesKey(series.title, series.title),
  );
  const active = meetings.some((meeting) =>
    ["joining", "waiting_room", "live", "processing"].includes(meeting.status),
  );

  return (
    <div className="container-page py-10 sm:py-14">
      <Link
        href="/meetings"
        className="mb-6 inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-950"
      >
        <span aria-hidden="true">←</span>
        {isItalian ? "Tutti i meeting" : "All meetings"}
      </Link>

      <header className="card mb-6 p-5 sm:p-7">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-3xl">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-[#e4eee7] px-2.5 py-1 text-xs font-semibold text-[#295c43]">
                {isItalian ? "Serie di meeting" : "Meeting series"}
              </span>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
                {meetings.length} {isItalian ? (meetings.length === 1 ? "appuntamento" : "appuntamenti") : (meetings.length === 1 ? "appointment" : "appointments")}
              </span>
            </div>
            <h1 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">{series.title}</h1>
            {series.objective && (
              <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-slate-600">
                {series.objective}
              </p>
            )}
          </div>
          <DeleteMeetingSeriesButton
            seriesId={series.id}
            title={series.title}
            disabled={active}
          />
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <div className="space-y-6">
          <section className="card p-5 sm:p-7">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.15em] text-[#295c43]">
                  {isItalian ? "Calendario della serie" : "Series schedule"}
                </p>
                <h2 className="mt-2 text-xl font-semibold">
                  {isItalian ? "Tutti gli appuntamenti" : "All appointments"}
                </h2>
              </div>
              <span className="text-xs text-slate-500">
                {isItalian ? "I link Teams possono cambiare" : "Teams links may change"}
              </span>
            </div>
            <div className="mt-6 space-y-3">
              {meetings.map((meeting, index) => (
                <Link
                  key={meeting.id}
                  href={`/meetings/${meeting.id}`}
                  className="flex flex-col gap-3 rounded-xl border border-slate-200 p-4 transition hover:border-[#9fbea9] hover:bg-[#fafcf9] sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#edf4ef] text-xs font-bold text-[#295c43]">
                      {index + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{meeting.title}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {formatMeetingDate(meeting.scheduledStart, locale, meeting.timezone)} · {meetingPlatformLabel(meeting.platform, locale)}
                      </p>
                    </div>
                  </div>
                  <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
                    {meetingStatusLabel(locale, meeting.status)}
                  </span>
                </Link>
              ))}
            </div>
          </section>

          <details className="card group overflow-hidden">
            <summary className="flex cursor-pointer list-none items-center justify-between p-5 sm:p-6">
              <div>
                <h2 className="font-semibold">
                  {isItalian ? "Aggiungi un altro appuntamento" : "Add another appointment"}
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  {isItalian ? "Resterà nella stessa memoria, anche con un link diverso." : "It will share the same memory, even with a different link."}
                </p>
              </div>
              <span className="text-slate-400 transition group-open:rotate-180" aria-hidden="true">⌄</span>
            </summary>
            <div className="border-t border-slate-100 p-5 sm:p-6">
              <SeriesAppointmentForm seriesId={series.id} />
            </div>
          </details>

          <section className="card p-5 sm:p-7">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.15em] text-[#295c43]">{isItalian ? "Scaletta condivisa" : "Shared agenda"}</p>
                <h2 className="mt-2 text-xl font-semibold">{isItalian ? "Struttura di ogni appuntamento" : "Structure for every appointment"}</h2>
              </div>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                {series.agenda.filter((item) => item.mandatory).length}{" "}
                {isItalian
                  ? series.agenda.filter((item) => item.mandatory).length === 1
                    ? "obbligatorio"
                    : "obbligatori"
                  : "mandatory"}
              </span>
            </div>
            {series.agenda.length ? (
              <ol className="mt-6 space-y-3">
                {series.agenda.map((item, index) => (
                  <li key={`${item.title}-${index}`} className="flex items-center gap-3 rounded-xl border border-slate-200 p-4">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#edf4ef] text-xs font-bold text-[#295c43]">{index + 1}</span>
                    <span className="min-w-0 flex-1 text-sm font-semibold">{item.title}</span>
                    <span className={`text-[11px] font-bold uppercase tracking-wide ${item.mandatory ? "text-amber-700" : "text-slate-400"}`}>{item.mandatory ? (isItalian ? "Obbligatorio" : "Mandatory") : (isItalian ? "Facoltativo" : "Optional")}</span>
                  </li>
                ))}
              </ol>
            ) : <p className="mt-5 text-sm text-slate-500">{isItalian ? "La serie non ha ancora una scaletta." : "This series does not have an agenda yet."}</p>}
          </section>
        </div>

        <aside className="space-y-6">
          <section className="card p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.15em] text-[#295c43]">
              {isItalian ? "Memoria condivisa" : "Shared memory"}
            </p>
            <p className="mt-3 text-3xl font-bold">{briefing.previousMeetingIds.length}</p>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              {isItalian ? "meeting conclusi inclusi nella memoria" : "completed meetings included in memory"}
            </p>
            <dl className="mt-5 divide-y divide-slate-100 text-sm">
              <div className="flex justify-between gap-3 py-2.5">
                <dt className="text-slate-500">{isItalian ? "Ricordi" : "Memories"}</dt>
                <dd className="font-semibold">{briefing.rememberedFacts.length}</dd>
              </div>
              <div className="flex justify-between gap-3 py-2.5">
                <dt className="text-slate-500">{isItalian ? "Decisioni" : "Decisions"}</dt>
                <dd className="font-semibold">{briefing.decisions.length}</dd>
              </div>
              <div className="flex justify-between gap-3 py-2.5">
                <dt className="text-slate-500">{isItalian ? "Attività aperte" : "Open actions"}</dt>
                <dd className="font-semibold">{briefing.actionItems.length}</dd>
              </div>
              <div className="flex justify-between gap-3 py-2.5">
                <dt className="text-slate-500">{isItalian ? "Domande" : "Questions"}</dt>
                <dd className="font-semibold">{briefing.openQuestions.length}</dd>
              </div>
            </dl>
          </section>

          <section className="rounded-2xl border border-[#bfd5c5] bg-[#eef5f0] p-5">
            <p className="text-sm font-semibold text-[#204d36]">
              {isItalian ? "Come entra nel meeting" : "How it joins the meeting"}
            </p>
            <p className="mt-2 text-xs leading-5 text-slate-600">
              {isItalian
                ? "All’orario stabilito il collega digitale usa il link dell’appuntamento e compare tra i partecipanti. Se la riunione è protetta o ha una sala d’attesa, dovrà essere invitato o ammesso."
                : "At the scheduled time, the digital colleague uses the appointment link and appears among the participants. For protected meetings or waiting rooms, it must be invited or admitted."}
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}
