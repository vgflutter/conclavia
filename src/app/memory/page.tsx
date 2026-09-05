import type { Metadata } from "next";
import Link from "next/link";

import { getRequestLocale } from "@/i18n/server";
import { formatMeetingDate } from "@/lib/meeting-presentation";
import { connectToDatabase } from "@/lib/mongodb";
import { serializeMeeting } from "@/lib/serialize-meeting";
import { MeetingModel } from "@/models/Meeting";
import type { MeetingResponse } from "@/types/meeting";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  return { title: locale === "it" ? "Memoria" : "Memory" };
}

function MemoryColumn({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return (
    <div>
      <h3 className="text-xs font-bold uppercase tracking-[0.12em] text-slate-400">{title}</h3>
      {items.length ? (
        <ul className="mt-3 space-y-2">
          {items.map((item, index) => (
            <li key={`${item}-${index}`} className="flex gap-2 text-sm leading-6 text-slate-700">
              <span className="mt-2.5 size-1.5 shrink-0 rounded-full bg-[#6fa27e]" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      ) : <p className="mt-3 text-sm text-slate-400">{empty}</p>}
    </div>
  );
}

function MeetingMemoryCard({ meeting, isItalian }: { meeting: MeetingResponse; isItalian: boolean }) {
  const hasMemory = Boolean(
    meeting.summary.overview ||
      meeting.summary.rememberedFacts.length ||
      meeting.summary.decisions.length ||
      meeting.summary.actionItems.length ||
      meeting.summary.openQuestions.length,
  );

  return (
    <article className="card overflow-hidden">
      <div className="flex flex-col gap-4 border-b border-slate-100 p-5 sm:flex-row sm:items-start sm:justify-between sm:p-6">
        <div>
          <p className="text-xs font-semibold text-[#295c43]">{meeting.seriesLabel || (isItalian ? "Meeting singolo" : "Single meeting")}</p>
          <h2 className="mt-1 text-lg font-semibold">{meeting.title}</h2>
          <p className="mt-1 text-xs text-slate-500">{formatMeetingDate(meeting.scheduledStart, isItalian ? "it" : "en", meeting.timezone)}</p>
        </div>
        <Link href={`/meetings/${meeting.id}`} className="button-secondary shrink-0">{isItalian ? "Gestisci memoria" : "Manage memory"}</Link>
      </div>
      {hasMemory ? (
        <div className="p-5 sm:p-6">
          {meeting.summary.overview && <p className="mb-6 rounded-xl bg-[#f4f7f4] p-4 text-sm leading-6 text-slate-700">{meeting.summary.overview}</p>}
          <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
            <MemoryColumn title={isItalian ? "Da ricordare" : "Remembered"} items={meeting.summary.rememberedFacts} empty="—" />
            <MemoryColumn title={isItalian ? "Decisioni" : "Decisions"} items={meeting.summary.decisions} empty="—" />
            <MemoryColumn title={isItalian ? "Attività" : "Actions"} items={meeting.summary.actionItems.map((item) => item.owner ? `${item.description} · ${item.owner}` : item.description)} empty="—" />
            <MemoryColumn title={isItalian ? "Questioni aperte" : "Open questions"} items={meeting.summary.openQuestions} empty="—" />
          </div>
        </div>
      ) : (
        <p className="p-5 text-sm leading-6 text-slate-500 sm:p-6">{isItalian ? "La memoria è ancora vuota. Apri il meeting per aggiungere un fatto o compilare l’esito." : "Memory is empty. Open the meeting to remember a fact or complete its outcome."}</p>
      )}
    </article>
  );
}

export default async function MemoryPage() {
  const locale = await getRequestLocale();
  const isItalian = locale === "it";
  await connectToDatabase();
  const documents = await MeetingModel.find().sort({ scheduledStart: -1 }).exec();
  const meetings = documents.map(serializeMeeting);
  const withMemory = meetings.filter((meeting) =>
    meeting.status === "completed" ||
    meeting.summary.rememberedFacts.length > 0 ||
    meeting.commandHistory.some((event) => event.kind === "remember"),
  );
  const rememberedCount = withMemory.reduce((total, meeting) => total + meeting.summary.rememberedFacts.length, 0);
  const decisionCount = withMemory.reduce((total, meeting) => total + meeting.summary.decisions.length, 0);
  const actionCount = withMemory.reduce((total, meeting) => total + meeting.summary.actionItems.filter((item) => !item.completed).length, 0);

  return (
    <div className="container-page py-10 sm:py-14">
      <header className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#295c43]">{isItalian ? "Memoria dei meeting" : "Meeting memory"}</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">{isItalian ? "Lo storico che continua la conversazione" : "History that continues the conversation"}</h1>
          <p className="mt-3 text-sm leading-6 text-slate-600 sm:text-base">{isItalian ? "Fatti da ricordare, decisioni, attività e questioni aperte restano legati al loro meeting e vengono ripresi nella stessa serie." : "Remembered facts, decisions, actions and open questions remain tied to their meeting and carry into the same series."}</p>
        </div>
        <Link href="/meetings" className="button-secondary shrink-0">{isItalian ? "Vai ai meeting" : "Go to meetings"}</Link>
      </header>

      <section className="mb-8 grid gap-3 sm:grid-cols-3">
        <div className="card p-4"><p className="text-xs uppercase tracking-wide text-slate-400">{isItalian ? "Ricordi" : "Memories"}</p><p className="mt-2 text-2xl font-bold">{rememberedCount}</p></div>
        <div className="card p-4"><p className="text-xs uppercase tracking-wide text-slate-400">{isItalian ? "Decisioni" : "Decisions"}</p><p className="mt-2 text-2xl font-bold">{decisionCount}</p></div>
        <div className="card p-4"><p className="text-xs uppercase tracking-wide text-slate-400">{isItalian ? "Attività aperte" : "Open actions"}</p><p className="mt-2 text-2xl font-bold">{actionCount}</p></div>
      </section>

      <div className="space-y-5">
        {withMemory.length ? withMemory.map((meeting) => <MeetingMemoryCard key={meeting.id} meeting={meeting} isItalian={isItalian} />) : (
          <div className="card border-dashed p-8 text-center"><h2 className="text-lg font-semibold">{isItalian ? "Nessuna memoria ancora" : "No memory yet"}</h2><p className="mt-2 text-sm text-slate-500">{isItalian ? "Usa “Ricorda” dentro un meeting oppure salva il suo esito." : "Use “Remember” inside a meeting or save its outcome."}</p></div>
        )}
      </div>
    </div>
  );
}
