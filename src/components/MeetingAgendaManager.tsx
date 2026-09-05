"use client";

import { useState } from "react";

import { useTranslations } from "@/i18n/I18nProvider";
import type { AgendaItemStatus, MeetingAgendaItem } from "@/types/meeting";

export function MeetingAgendaManager({ meetingId, initialAgenda }: { meetingId: string; initialAgenda: MeetingAgendaItem[] }) {
  const { locale } = useTranslations();
  const isItalian = locale === "it";
  const [agenda, setAgenda] = useState(initialAgenda);
  const [pendingId, setPendingId] = useState<string>();
  const [error, setError] = useState<string>();
  const covered = agenda.filter((item) => item.status === "covered").length;
  const mandatoryOpen = agenda.filter((item) => item.mandatory && item.status !== "covered").length;

  async function updateItem(itemId: string, status: AgendaItemStatus) {
    setPendingId(itemId);
    setError(undefined);
    try {
      const response = await fetch(`/api/meetings/${meetingId}/agenda`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId, status }),
      });
      const payload = (await response.json()) as { meeting?: { agenda: MeetingAgendaItem[] } };
      if (!response.ok || !payload.meeting) throw new Error();
      setAgenda(payload.meeting.agenda);
    } catch {
      setError(
        isItalian
          ? "Non siamo riusciti ad aggiornare la scaletta. Riprova."
          : "We couldn’t update the agenda. Please try again.",
      );
    } finally {
      setPendingId(undefined);
    }
  }

  return (
    <section className="card p-5 sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.15em] text-[#295c43]">{isItalian ? "Scaletta" : "Agenda"}</p>
          <h2 className="mt-2 text-xl font-semibold">{isItalian ? "Guida il meeting verso l’obiettivo" : "Guide the meeting toward its objective"}</h2>
        </div>
        <div className="text-right">
          <p className="text-sm font-semibold">
            {covered} {isItalian ? "di" : "of"} {agenda.length || 0}{" "}
            {isItalian
              ? agenda.length === 1
                ? "punto completato"
                : "punti completati"
              : agenda.length === 1
                ? "item complete"
                : "items complete"}
          </p>
          <p className={`mt-1 text-xs ${mandatoryOpen ? "text-amber-700" : "text-emerald-700"}`}>
            {mandatoryOpen
              ? isItalian
                ? `${mandatoryOpen} ${mandatoryOpen === 1 ? "punto obbligatorio aperto" : "punti obbligatori aperti"}`
                : `${mandatoryOpen} mandatory ${mandatoryOpen === 1 ? "item" : "items"} open`
              : isItalian
                ? "Tutti i punti obbligatori sono completati"
                : "All mandatory items are complete"}
          </p>
        </div>
      </div>

      {agenda.length ? (
        <ol className="mt-6 space-y-3">
          {agenda.map((item, index) => (
            <li key={item.id} className={`rounded-xl border p-4 ${item.status === "covered" ? "border-emerald-200 bg-emerald-50/60" : item.status === "skipped" ? "border-slate-200 bg-slate-50 opacity-70" : "border-slate-200"}`}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-white text-xs font-bold text-[#295c43] shadow-sm">{index + 1}</span>
                  <div>
                    <p className={`text-sm font-semibold ${item.status === "covered" ? "line-through decoration-emerald-400" : ""}`}>{item.title}</p>
                    <span className={`mt-1 inline-flex text-[11px] font-bold uppercase tracking-wide ${item.mandatory ? "text-amber-700" : "text-slate-400"}`}>{item.mandatory ? (isItalian ? "Obbligatorio" : "Mandatory") : (isItalian ? "Facoltativo" : "Optional")}</span>
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button type="button" disabled={pendingId === item.id} onClick={() => updateItem(item.id, item.status === "covered" ? "pending" : "covered")} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold hover:bg-slate-50 disabled:opacity-50">{item.status === "covered" ? (isItalian ? "Riapri" : "Reopen") : (isItalian ? "Coperto" : "Covered")}</button>
                  {!item.mandatory && item.status !== "covered" && (
                    <button type="button" disabled={pendingId === item.id} onClick={() => updateItem(item.id, item.status === "skipped" ? "pending" : "skipped")} className="rounded-lg px-3 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-100 disabled:opacity-50">{item.status === "skipped" ? (isItalian ? "Ripristina" : "Restore") : (isItalian ? "Salta" : "Skip")}</button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-5 rounded-xl bg-slate-50 p-4 text-sm leading-6 text-slate-500">{isItalian ? "Nessun punto in scaletta. Puoi aggiungerli quando crei il prossimo meeting." : "No agenda items. Add them when creating the next meeting."}</p>
      )}
      {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    </section>
  );
}
