"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { useTranslations } from "@/i18n/I18nProvider";
import type { MeetingCommandEvent, MeetingCommandKind } from "@/types/meeting";

type SerializedCommandEvent = Omit<MeetingCommandEvent, "createdAt"> & { createdAt: string };

const commandMeta: Record<MeetingCommandKind, { icon: string; it: string; en: string }> = {
  remember: { icon: "◆", it: "Ricorda", en: "Remember" },
  summary: { icon: "≡", it: "Riepiloga", en: "Summarize" },
  agenda: { icon: "→", it: "Scaletta", en: "Agenda" },
  ask: { icon: "?", it: "Rispondi", en: "Answer" },
  correct: { icon: "✓", it: "Verifica", en: "Verify" },
  inform: { icon: "!", it: "Informazione", en: "Information" },
};

const selectableCommands: MeetingCommandKind[] = [
  "remember",
  "summary",
  "agenda",
  "ask",
  "correct",
];

export function MeetingAssistantConsole({ meetingId, assistantName, initialHistory }: { meetingId: string; assistantName: string; initialHistory: SerializedCommandEvent[] }) {
  const router = useRouter();
  const { locale } = useTranslations();
  const isItalian = locale === "it";
  const [kind, setKind] = useState<MeetingCommandKind>("remember");
  const [prompt, setPrompt] = useState("");
  const [history, setHistory] = useState(initialHistory);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function execute(commandKind = kind) {
    if (!["summary", "agenda"].includes(commandKind) && !prompt.trim()) return;
    setPending(true);
    setError(undefined);
    try {
      const response = await fetch(`/api/meetings/${meetingId}/commands`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: commandKind, prompt }),
      });
      const payload = (await response.json()) as { response?: string; meeting?: { commandHistory: SerializedCommandEvent[] } };
      if (!response.ok || !payload.meeting || !payload.response) throw new Error();
      setHistory(payload.meeting.commandHistory);
      setPrompt("");
      router.refresh();
    } catch {
      setError(
        isItalian
          ? "Non siamo riusciti a completare la richiesta. Riprova."
          : "We couldn’t complete your request. Please try again.",
      );
    } finally {
      setPending(false);
    }
  }

  const placeholders: Record<MeetingCommandKind, string> = {
    remember: isItalian ? "Es. Ricorda che il lancio è fissato al 15 ottobre" : "E.g. Remember that launch is set for October 15",
    summary: "",
    agenda: "",
    ask: isItalian ? "Fai una domanda sulla memoria della serie" : "Ask a question about series memory",
    correct: isItalian ? "Inserisci l’affermazione da verificare" : "Enter the statement to verify",
    inform: "",
  };
  const recentHistory = [...history].reverse().slice(0, 8);

  return (
    <section className="overflow-hidden rounded-2xl border border-[#183728] bg-[#10251a] text-white shadow-[0_20px_60px_rgba(20,52,35,0.14)]">
      <div className="border-b border-white/10 p-5 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.15em] text-[#bde88d]">{isItalian ? "Assistente" : "Assistant"}</p>
            <h2 className="mt-2 text-xl font-semibold">{isItalian ? `Chiedi a ${assistantName}` : `Ask ${assistantName}`}</h2>
          </div>
          <span className="rounded-full bg-white/8 px-3 py-1 text-xs font-semibold text-white/60">“{assistantName}…”</span>
        </div>
        <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-5">
          {selectableCommands.map((commandKind) => (
            <button key={commandKind} type="button" aria-pressed={kind === commandKind} onClick={() => { setKind(commandKind); if (["summary", "agenda"].includes(commandKind)) void execute(commandKind); }} className={`rounded-xl border px-3 py-3 text-left transition ${kind === commandKind ? "border-[#bde88d]/50 bg-[#bde88d]/12 text-[#dfffb7]" : "border-white/10 bg-white/4 text-white/65 hover:bg-white/8"}`}>
              <span className="mr-2 text-[#bde88d]" aria-hidden="true">{commandMeta[commandKind].icon}</span>
              <span className="text-sm font-semibold">{isItalian ? commandMeta[commandKind].it : commandMeta[commandKind].en}</span>
            </button>
          ))}
        </div>
        {!["summary", "agenda"].includes(kind) && (
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={placeholders[kind]} maxLength={2_000} className="min-h-16 flex-1 resize-none rounded-xl border border-white/12 bg-black/20 px-4 py-3 text-sm text-white outline-none placeholder:text-white/30 focus:border-[#bde88d]/60" />
            <button type="button" onClick={() => execute()} disabled={pending || !prompt.trim()} className="min-w-28 rounded-xl bg-[#bde88d] px-4 py-3 text-sm font-bold text-[#142516] transition hover:bg-[#d7f5ae] disabled:opacity-50">{pending ? "…" : isItalian ? "Invia" : "Send"}</button>
          </div>
        )}
        <p className="mt-3 text-xs leading-5 text-white/45">{isItalian ? "Le risposte si basano sulla memoria di questo meeting e degli appuntamenti collegati." : "Answers are based on this meeting and its connected appointments."}</p>
        {error && <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}
      </div>

      {recentHistory.length > 0 && (
        <div className="p-5 sm:p-7">
          <p className="text-xs font-semibold uppercase tracking-[0.13em] text-white/35">{isItalian ? "Ultima risposta" : "Latest response"}</p>
          <article className="mt-4 rounded-xl bg-white/6 p-4">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-[#bde88d]"><span>{commandMeta[recentHistory[0].kind].icon}</span><span>{isItalian ? commandMeta[recentHistory[0].kind].it : commandMeta[recentHistory[0].kind].en}</span></div>
            {recentHistory[0].prompt && <p className="mt-2 text-sm text-white/55">{recentHistory[0].prompt}</p>}
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-white/85">{recentHistory[0].response}</p>
          </article>
          {recentHistory.length > 1 && (
            <details className="group mt-3">
              <summary className="cursor-pointer list-none py-2 text-sm font-semibold text-[#bde88d]">
                {isItalian ? `Mostra altre ${recentHistory.length - 1} interazioni` : `Show ${recentHistory.length - 1} more interactions`}
              </summary>
              <div className="mt-2 max-h-72 space-y-3 overflow-y-auto pr-1">
                {recentHistory.slice(1).map((event) => (
                  <article key={event.id} className="rounded-xl bg-white/6 p-4">
                    <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-[#bde88d]"><span>{commandMeta[event.kind].icon}</span><span>{isItalian ? commandMeta[event.kind].it : commandMeta[event.kind].en}</span></div>
                    {event.prompt && <p className="mt-2 text-sm text-white/55">{event.prompt}</p>}
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-white/85">{event.response}</p>
                  </article>
                ))}
              </div>
            </details>
          )}
        </div>
      )}
    </section>
  );
}
