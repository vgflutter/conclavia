import type { Metadata } from "next";
import Link from "next/link";

import { getRequestLocale } from "@/i18n/server";
import { formatMeetingDate } from "@/lib/meeting-presentation";
import { connectToDatabase } from "@/lib/mongodb";
import { serializeMeeting } from "@/lib/serialize-meeting";
import { MeetingModel } from "@/models/Meeting";
import type { MeetingResponse } from "@/types/meeting";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 10;

function first(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] || "" : value || "";
}

function safePage(value: string): number {
  const page = Number.parseInt(value || "1", 10);
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

function escapeSearch(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function memoryHref(page: number, search: string): string {
  const query = new URLSearchParams();
  if (page > 1) query.set("page", String(page));
  if (search) query.set("q", search);
  const suffix = query.toString();
  return suffix ? `/memory?${suffix}` : "/memory";
}

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  return { title: locale === "it" ? "Memoria" : "Memory" };
}

function MemoryColumn({ title, items }: { title: string; items: string[] }) {
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
      ) : <p className="mt-3 text-sm text-slate-400">—</p>}
    </div>
  );
}

function MeetingMemoryCard({ meeting, isItalian }: { meeting: MeetingResponse; isItalian: boolean }) {
  const detailCount =
    meeting.summary.rememberedFacts.length +
    meeting.summary.decisions.length +
    meeting.summary.actionItems.length +
    meeting.summary.openQuestions.length;

  return (
    <article className="card overflow-hidden">
      <div className="p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold text-[#295c43]">
              {meeting.seriesLabel || (isItalian ? "Meeting singolo" : "Single meeting")}
            </p>
            <h2 className="mt-1 break-words text-lg font-semibold">{meeting.title}</h2>
            <p className="mt-1 text-xs text-slate-500">
              {formatMeetingDate(meeting.scheduledStart, isItalian ? "it" : "en", meeting.timezone)}
            </p>
          </div>
          <Link href={`/meetings/${meeting.id}`} className="button-secondary shrink-0">
            {isItalian ? "Apri meeting" : "Open meeting"}
          </Link>
        </div>
        <p className="mt-5 rounded-xl bg-[#f4f7f4] p-4 text-sm leading-6 text-slate-700">
          {meeting.summary.overview || meeting.objective || (isItalian
            ? "Il riepilogo di questo meeting non è ancora disponibile."
            : "The summary for this meeting is not available yet.")}
        </p>
      </div>

      {detailCount > 0 && (
        <details className="group border-t border-slate-100">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-sm font-semibold text-[#295c43] hover:bg-[#fafcf9] sm:px-6">
            <span>{isItalian ? "Dettagli della memoria" : "Memory details"}</span>
            <span className="flex items-center gap-3 text-xs text-slate-500">
              {detailCount} {isItalian
                ? detailCount === 1 ? "elemento" : "elementi"
                : detailCount === 1 ? "item" : "items"}
              <span aria-hidden="true" className="text-base transition-transform group-open:rotate-180">⌄</span>
            </span>
          </summary>
          <div className="grid gap-6 border-t border-slate-100 px-5 py-6 sm:grid-cols-2 sm:px-6 xl:grid-cols-4">
            <MemoryColumn title={isItalian ? "Da ricordare" : "Remembered"} items={meeting.summary.rememberedFacts} />
            <MemoryColumn title={isItalian ? "Decisioni" : "Decisions"} items={meeting.summary.decisions} />
            <MemoryColumn
              title={isItalian ? "Attività" : "Actions"}
              items={meeting.summary.actionItems.map((item) => item.owner ? `${item.description} · ${item.owner}` : item.description)}
            />
            <MemoryColumn title={isItalian ? "Questioni aperte" : "Open questions"} items={meeting.summary.openQuestions} />
          </div>
        </details>
      )}
    </article>
  );
}

export default async function MemoryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[]; page?: string | string[] }>;
}) {
  const [locale, query] = await Promise.all([getRequestLocale(), searchParams]);
  const isItalian = locale === "it";
  const search = first(query.q).trim().slice(0, 120);
  const page = safePage(first(query.page));
  const expression = search ? escapeSearch(search) : "";
  const hasMemory = {
    $or: [
      { status: "completed" },
      { "summary.overview": { $exists: true, $ne: "" } },
      { "summary.rememberedFacts.0": { $exists: true } },
      { "summary.decisions.0": { $exists: true } },
      { "summary.actionItems.0": { $exists: true } },
      { "summary.openQuestions.0": { $exists: true } },
    ],
  };
  const searchFilter = expression
    ? {
        $or: [
          { title: { $regex: expression, $options: "i" } },
          { objective: { $regex: expression, $options: "i" } },
          { seriesLabel: { $regex: expression, $options: "i" } },
          { "summary.overview": { $regex: expression, $options: "i" } },
          { "summary.rememberedFacts": { $regex: expression, $options: "i" } },
        ],
      }
    : {};
  const filter = { $and: [hasMemory, searchFilter] };

  await connectToDatabase();
  const [documents, total] = await Promise.all([
    MeetingModel.find(filter)
      .sort({ scheduledStart: -1 })
      .skip((page - 1) * PAGE_SIZE)
      .limit(PAGE_SIZE)
      .exec(),
    MeetingModel.countDocuments(filter).exec(),
  ]);
  const meetings = documents.map(serializeMeeting);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="container-page py-8 sm:py-12">
      <header className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-3xl">
          <p className="section-kicker">{isItalian ? "Memoria dei meeting" : "Meeting memory"}</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
            {isItalian ? "Decisioni e contesto, sempre disponibili" : "Decisions and context, always available"}
          </h1>
          <p className="mt-2 text-sm leading-6 text-slate-600 sm:text-base">
            {isItalian
              ? `${total} ${total === 1 ? "meeting salvato" : "meeting salvati"}. Il riepilogo resta in primo piano; i dettagli si aprono solo quando servono.`
              : `${total} ${total === 1 ? "saved meeting" : "saved meetings"}. Summaries stay prominent; details open only when needed.`}
          </p>
        </div>
        <Link href="/meetings" className="button-secondary shrink-0">{isItalian ? "Vai ai meeting" : "Go to meetings"}</Link>
      </header>

      <form action="/memory" className="card mb-7 flex gap-2 p-2">
        <label className="sr-only" htmlFor="memory-search">{isItalian ? "Cerca nella memoria" : "Search memory"}</label>
        <input
          id="memory-search"
          name="q"
          type="search"
          defaultValue={search}
          className="input min-w-0 flex-1 border-transparent!"
          placeholder={isItalian ? "Cerca un meeting, una decisione o un fatto" : "Search a meeting, decision or fact"}
        />
        <button type="submit" className="button-primary shrink-0">{isItalian ? "Cerca" : "Search"}</button>
      </form>

      {search && (
        <div className="mb-5 flex items-center justify-between gap-3 text-sm text-slate-600">
          <span>
            {total}{" "}
            {isItalian
              ? `${total === 1 ? "risultato" : "risultati"} per “${search}”`
              : `${total === 1 ? "result" : "results"} for “${search}”`}
          </span>
          <Link href="/memory" className="font-semibold text-[#295c43] hover:underline">{isItalian ? "Azzera ricerca" : "Clear search"}</Link>
        </div>
      )}

      <div className="space-y-4">
        {meetings.length ? meetings.map((meeting) => (
          <MeetingMemoryCard key={meeting.id} meeting={meeting} isItalian={isItalian} />
        )) : (
          <div className="card border-dashed p-8 text-center">
            <h2 className="text-lg font-semibold">{isItalian ? "Nessun risultato" : "No results"}</h2>
            <p className="mt-2 text-sm text-slate-500">
              {search
                ? isItalian ? "Prova con un titolo, una decisione o una parola diversa." : "Try another title, decision or keyword."
                : isItalian ? "I riepiloghi compariranno qui al termine dei meeting." : "Meeting summaries will appear here after meetings end."}
            </p>
          </div>
        )}
      </div>

      {pageCount > 1 && (
        <nav aria-label={isItalian ? "Paginazione memoria" : "Memory pagination"} className="mt-6 flex items-center justify-between gap-4">
          {page > 1 ? <Link href={memoryHref(page - 1, search)} className="button-secondary">← {isItalian ? "Precedenti" : "Previous"}</Link> : <span />}
          <span className="text-sm text-slate-500">{isItalian ? `Pagina ${page} di ${pageCount}` : `Page ${page} of ${pageCount}`}</span>
          {page < pageCount ? <Link href={memoryHref(page + 1, search)} className="button-secondary">{isItalian ? "Successivi" : "Next"} →</Link> : <span />}
        </nav>
      )}
    </div>
  );
}
