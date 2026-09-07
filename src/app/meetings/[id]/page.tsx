import type { Metadata } from "next";
import Link from "next/link";
import { Types } from "mongoose";
import { notFound } from "next/navigation";

import { DeleteMeetingButton } from "@/components/DeleteMeetingButton";
import { MeetingAgendaManager } from "@/components/MeetingAgendaManager";
import { MeetingAssistantConsole } from "@/components/MeetingAssistantConsole";
import { MeetingOutcomeForm } from "@/components/MeetingOutcomeForm";
import { MeetingSessionControls } from "@/components/MeetingSessionControls";
import { getRequestLocale } from "@/i18n/server";
import type { Locale } from "@/i18n/locale";
import { buildMeetingContinuity } from "@/lib/meeting-continuity";
import { getMeetingAutomationPublicConfig } from "@/lib/meeting-bot-config";
import {
  formatMeetingDate,
  meetingPlatformLabel,
  meetingStatusLabel,
} from "@/lib/meeting-presentation";
import { connectToDatabase } from "@/lib/mongodb";
import { serializeMeeting } from "@/lib/serialize-meeting";
import { MeetingModel } from "@/models/Meeting";
import type { MeetingContinuityBriefing, MeetingResponse } from "@/types/meeting";

export const dynamic = "force-dynamic";

interface MeetingPageProps {
  params: Promise<{ id: string }>;
}

function statusClass(status: MeetingResponse["status"]): string {
  if (status === "live" || status === "joining") {
    return "bg-emerald-100 text-emerald-800";
  }
  if (status === "waiting_room" || status === "processing" || status === "failed") {
    return "bg-amber-100 text-amber-800";
  }
  if (status === "cancelled") return "bg-red-50 text-red-700";
  return "bg-slate-100 text-slate-700";
}

function MemoryList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">
        {title}
      </h3>
      {items.length ? (
        <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-700">
          {items.map((item) => (
            <li key={item} className="flex gap-2">
              <span className="mt-2 size-1.5 shrink-0 rounded-full bg-[#6fa27e]" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-slate-400">—</p>
      )}
    </div>
  );
}

function ContinuityCard({
  briefing,
  locale,
}: {
  briefing: MeetingContinuityBriefing;
  locale: Locale;
}) {
  const isItalian = locale === "it";
  const hasMemory = briefing.previousMeetingIds.length > 0;

  return (
    <section className="card p-5 sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.15em] text-[#295c43]">
            {isItalian ? "Memoria di continuità" : "Continuity memory"}
          </p>
          <h2 className="mt-2 text-xl font-semibold">
            {hasMemory
              ? isItalian
                ? "Briefing dai meeting precedenti"
                : "Briefing from previous meetings"
              : isItalian
                ? "Primo incontro di questa serie"
                : "First meeting in this series"}
          </h2>
        </div>
        <span className="rounded-full bg-[#edf4ef] px-2.5 py-1 text-xs font-semibold text-[#295c43]">
          {briefing.previousMeetingIds.length}{" "}
          {isItalian
            ? briefing.previousMeetingIds.length === 1
              ? "meeting collegato"
              : "meeting collegati"
            : briefing.previousMeetingIds.length === 1
              ? "linked meeting"
              : "linked meetings"}
        </span>
      </div>

      {hasMemory ? (
        <>
          {briefing.overview && (
            <p className="mt-5 rounded-xl bg-[#f4f7f4] p-4 text-sm leading-6 text-slate-700">
              {briefing.overview}
            </p>
          )}
          <div className="mt-6 grid gap-6 md:grid-cols-2 xl:grid-cols-4">
            <MemoryList
              title={isItalian ? "Fatti da ricordare" : "Remembered facts"}
              items={briefing.rememberedFacts}
            />
            <MemoryList
              title={isItalian ? "Decisioni già prese" : "Previous decisions"}
              items={briefing.decisions}
            />
            <MemoryList
              title={isItalian ? "Attività ancora aperte" : "Open action items"}
              items={briefing.actionItems.map((item) =>
                item.owner ? `${item.description} · ${item.owner}` : item.description,
              )}
            />
            <MemoryList
              title={isItalian ? "Questioni da riprendere" : "Questions to revisit"}
              items={briefing.openQuestions}
            />
          </div>
        </>
      ) : (
        <p className="mt-4 text-sm leading-6 text-slate-500">
          {isItalian
            ? "Quando concluderai un meeting della stessa serie, decisioni, attività e questioni aperte verranno preparate qui per il collega digitale."
            : "After a meeting in this series is completed, decisions, actions and open questions will be prepared here for the digital colleague."}
        </p>
      )}
    </section>
  );
}

export async function generateMetadata({ params }: MeetingPageProps): Promise<Metadata> {
  const { id } = await params;
  if (!Types.ObjectId.isValid(id)) return { title: "Meeting" };
  await connectToDatabase();
  const meeting = await MeetingModel.findById(id).select("title").exec();
  return { title: meeting?.title || "Meeting" };
}

export default async function MeetingPage({ params }: MeetingPageProps) {
  const { id } = await params;
  const locale = await getRequestLocale();
  const isItalian = locale === "it";
  if (!Types.ObjectId.isValid(id)) notFound();

  await connectToDatabase();
  const document = await MeetingModel.findById(id).exec();
  if (!document) notFound();

  const [meeting, briefing] = [serializeMeeting(document), await buildMeetingContinuity(document)];
  const automation = getMeetingAutomationPublicConfig();
  const durationMinutes = Math.round(
    (new Date(meeting.scheduledEnd).getTime() -
      new Date(meeting.scheduledStart).getTime()) /
      60_000,
  );

  return (
    <div className="container-page py-10 sm:py-14">
      <Link
        href={meeting.seriesId ? `/meetings/series/${meeting.seriesId}` : "/meetings"}
        className="mb-6 inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-950"
      >
        <span aria-hidden="true">←</span>
        {meeting.seriesId
          ? isItalian
            ? "Torna alla serie"
            : "Back to series"
          : isItalian
            ? "Tutti i meeting"
            : "All meetings"}
      </Link>

      <header className="card mb-6 overflow-hidden">
        <div className="grid lg:grid-cols-[minmax(0,1fr)_19rem]">
          <div className="p-5 sm:p-7">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusClass(meeting.status)}`}>
                {meetingStatusLabel(locale, meeting.status)}
              </span>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                {meetingPlatformLabel(meeting.platform, locale)}
              </span>
              {meeting.autoJoin && (
                <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${["scheduling", "scheduled"].includes(meeting.bot.status) ? "bg-[#edf4ef] text-[#295c43]" : "bg-amber-50 text-amber-800"}`}>
                  {["scheduling", "scheduled"].includes(meeting.bot.status)
                    ? meeting.bot.status === "scheduling"
                      ? isItalian
                        ? "Programmazione ingresso"
                        : "Scheduling entry"
                      : isItalian
                        ? "Ingresso programmato"
                        : "Join scheduled"
                    : isItalian
                      ? "Accesso da controllare"
                      : "Entry needs attention"}
                </span>
              )}
              {meeting.seriesId && (
                <Link
                  href={`/meetings/series/${meeting.seriesId}`}
                  className="rounded-full bg-[#eef5f0] px-2.5 py-1 text-xs font-medium text-[#295c43] hover:bg-[#dfede3]"
                >
                  {isItalian ? "Memoria della serie" : "Series memory"}
                </Link>
              )}
            </div>
            <h1 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">
              {meeting.title}
            </h1>
            <p className="mt-3 text-base font-semibold text-slate-700">
              {formatMeetingDate(meeting.scheduledStart, locale, meeting.timezone)}
              <span className="ml-2 font-normal text-slate-400">· {durationMinutes} min</span>
            </p>
            {meeting.objective && (
              <p className="mt-5 max-w-3xl whitespace-pre-wrap text-sm leading-6 text-slate-600">
                {meeting.objective}
              </p>
            )}
          </div>

          <aside className="border-t border-slate-100 bg-[#f8faf8] p-5 lg:border-l lg:border-t-0 sm:p-6">
            <MeetingSessionControls
              meetingId={meeting.id}
              status={meeting.status}
              autoJoin={meeting.autoJoin}
              bot={meeting.bot}
              automation={automation}
            />
            <a
              href={meeting.meetingUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-4 block break-all text-xs font-medium leading-5 text-[#295c43] hover:underline"
            >
              {isItalian ? "Entra nel meeting ↗" : "Join meeting ↗"}
            </a>
            <div className="mt-4 border-t border-slate-200 pt-3">
              <DeleteMeetingButton
                meetingId={meeting.id}
                meetingTitle={meeting.title}
                disabled={["joining", "waiting_room", "live", "processing"].includes(meeting.status)}
                returnHref={
                  meeting.seriesId ? `/meetings/series/${meeting.seriesId}` : "/meetings"
                }
              />
            </div>
          </aside>
        </div>
      </header>

      <div className="space-y-6">
        <ContinuityCard briefing={briefing} locale={locale} />

        <MeetingAgendaManager meetingId={meeting.id} initialAgenda={meeting.agenda} />

        {meeting.pendingIntervention && (
            <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 sm:p-6">
              <p className="text-xs font-semibold uppercase tracking-[0.15em] text-amber-800">
                {isItalian ? "Ha alzato la mano" : "Hand raised"}
              </p>
              <h2 className="mt-2 text-lg font-semibold text-amber-950">
                {meeting.pendingIntervention.type === "correction"
                  ? isItalian ? "Ha rilevato una possibile correzione importante" : "It found a possible important correction"
                  : isItalian ? "Ha un’informazione rilevante" : "It has relevant information"}
              </h2>
              <p className="mt-2 text-sm leading-6 text-amber-900/75">
                {isItalian
                  ? `Per ascoltarlo, dì nel meeting: “${meeting.assistant.wakeWord}, vai pure”.`
                  : `To hear it, say in the meeting: “${meeting.assistant.wakeWord}, go ahead”.`}
              </p>
            </section>
          )}

        <MeetingAssistantConsole
          meetingId={meeting.id}
          assistantName={meeting.assistant.wakeWord}
          initialHistory={meeting.commandHistory}
        />

        <section className="card p-5 sm:p-7">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.15em] text-[#295c43]">
                {isItalian ? "Esito del meeting" : "Meeting outcome"}
              </p>
              <h2 className="mt-2 text-xl font-semibold">
                {isItalian ? "Ciò che resterà nello storico" : "What remains in history"}
              </h2>
            </div>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-500">
              {meeting.summary.generatedAt
                ? isItalian
                  ? "Memoria salvata"
                  : "Memory saved"
                : isItalian
                  ? "In attesa"
                  : "Pending"}
            </span>
          </div>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-500">
            {isItalian
                ? "Queste informazioni resteranno disponibili nei prossimi appuntamenti della stessa serie e potrai modificarle in qualsiasi momento."
                : "This information will remain available in future appointments in the same series, and you can edit it at any time."}
          </p>
          <div className="mt-6 border-t border-slate-100 pt-6">
            <MeetingOutcomeForm meeting={meeting} />
          </div>
        </section>

        <div className="grid gap-6 lg:grid-cols-2">
          <section className="card p-5 sm:p-7">
            <p className="text-xs font-semibold uppercase tracking-[0.15em] text-[#295c43]">
              {isItalian ? "Trascrizione" : "Transcript"}
            </p>
            <h2 className="mt-2 text-xl font-semibold">
              {meeting.transcript.length
                ? `${meeting.transcript.length} ${isItalian ? (meeting.transcript.length === 1 ? "intervento" : "interventi") : (meeting.transcript.length === 1 ? "segment" : "segments")}`
                : isItalian
                  ? "Nessun intervento ancora"
                  : "No segments yet"}
            </h2>
            {meeting.transcript.length ? (
              <div className="mt-5 max-h-96 space-y-4 overflow-y-auto pr-2">
                {meeting.transcript.map((segment) => (
                  <div key={segment.sequence}>
                    <p className="text-xs font-semibold text-[#295c43]">{segment.speakerName}</p>
                    <p className="mt-1 text-sm leading-6 text-slate-600">{segment.text}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-sm leading-6 text-slate-500">
                {isItalian
                  ? "La trascrizione comparirà qui durante il meeting."
                  : "The transcript will appear here during the meeting."}
              </p>
            )}
          </section>

          <section className="card p-5 sm:p-7">
            <p className="text-xs font-semibold uppercase tracking-[0.15em] text-[#295c43]">
              {isItalian ? "Modalità assistente" : "Assistant behavior"}
            </p>
            <h2 className="mt-2 text-xl font-semibold">
              {isItalian ? "Comandi semplici, interventi misurati" : "Simple commands, measured interventions"}
            </h2>
            <dl className="mt-5 divide-y divide-slate-100 text-sm">
              <div className="flex items-center justify-between gap-4 py-3 first:pt-0">
                <dt className="text-slate-500">{isItalian ? "Per chiamarlo" : "Call phrase"}</dt>
                <dd className="font-semibold">{meeting.assistant.wakeWord}</dd>
              </div>
              <div className="flex items-center justify-between gap-4 py-3">
                <dt className="text-slate-500">{isItalian ? "Voce" : "Voice"}</dt>
                <dd className="text-right font-semibold">
                  {isItalian ? "Naturale e bilingue" : "Natural and bilingual"}
                </dd>
              </div>
              <div className="flex items-start justify-between gap-4 py-3">
                <dt className="text-slate-500">{isItalian ? "Domande" : "Questions"}</dt>
                <dd className="max-w-sm text-right font-semibold">
                  {isItalian
                    ? `Pronuncia “${meeting.assistant.wakeWord}” e fai la domanda.`
                    : `Say “${meeting.assistant.wakeWord}” and ask the question.`}
                </dd>
              </div>
              <div className="flex items-start justify-between gap-4 py-3">
                <dt className="text-slate-500">{isItalian ? "Interventi spontanei" : "Proactive contributions"}</dt>
                <dd className="max-w-sm text-right font-semibold">
                  {meeting.assistant.correctionPolicy === "important_only"
                    ? isItalian
                      ? `Alza la mano e attende “${meeting.assistant.wakeWord}, vai pure”.`
                      : `Raises its hand and waits for “${meeting.assistant.wakeWord}, go ahead”.`
                    : isItalian ? "Non attivi" : "Not enabled"}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4 py-3">
                <dt className="text-slate-500">{isItalian ? "Correzioni" : "Corrections"}</dt>
                <dd className="text-right font-semibold">
                  {meeting.assistant.correctionPolicy === "important_only"
                    ? isItalian ? "Solo inesattezze importanti" : "Important inaccuracies only"
                    : meeting.assistant.correctionPolicy === "on_request"
                      ? isItalian ? "Solo su richiesta" : "On request only"
                      : isItalian ? "Disattive" : "Disabled"}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4 py-3 last:pb-0">
                <dt className="text-slate-500">{isItalian ? "Registrazione audio" : "Audio recording"}</dt>
                <dd className="font-semibold">{meeting.retention.storeAudio ? (isItalian ? "Attiva" : "Enabled") : (isItalian ? "Disattiva" : "Disabled")}</dd>
              </div>
            </dl>
          </section>
        </div>
      </div>
    </div>
  );
}
