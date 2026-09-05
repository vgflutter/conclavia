"use client";

import { type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import { useTranslations } from "@/i18n/I18nProvider";
import type { MeetingResponse } from "@/types/meeting";

function lines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim().replace(/^[-*]\s*/, ""))
    .filter(Boolean);
}

export function MeetingOutcomeForm({ meeting }: { meeting: MeetingResponse }) {
  const router = useRouter();
  const { locale } = useTranslations();
  const isItalian = locale === "it";
  const [overview, setOverview] = useState(meeting.summary.overview);
  const [decisions, setDecisions] = useState(meeting.summary.decisions.join("\n"));
  const [rememberedFacts, setRememberedFacts] = useState(
    meeting.summary.rememberedFacts.join("\n"),
  );
  const [openQuestions, setOpenQuestions] = useState(
    meeting.summary.openQuestions.join("\n"),
  );
  const [actions, setActions] = useState(
    meeting.summary.actionItems
      .map((item) => `${item.description}${item.owner ? ` | ${item.owner}` : ""}`)
      .join("\n"),
  );
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string>();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setSaved(false);
    setError(undefined);

    try {
      const actionItems = lines(actions).map((line) => {
        const [description, owner] = line.split("|").map((value) => value.trim());
        return { description, owner: owner || undefined, completed: false };
      });
      const response = await fetch(`/api/meetings/${meeting.id}/outcome`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          overview,
          rememberedFacts: lines(rememberedFacts),
          decisions: lines(decisions),
          actionItems,
          openQuestions: lines(openQuestions),
        }),
      });
      const payload = (await response.json()) as { meeting?: unknown };
      if (!response.ok || !payload.meeting) {
        throw new Error();
      }
      setSaved(true);
      router.refresh();
    } catch {
      setError(
        isItalian
          ? "Non siamo riusciti a salvare il riepilogo. Riprova."
          : "We couldn’t save the summary. Please try again.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <label className="label" htmlFor="outcome-overview">
          {isItalian ? "Riepilogo" : "Summary"}
        </label>
        <textarea
          id="outcome-overview"
          className="input min-h-28 resize-y"
          value={overview}
          onChange={(event) => setOverview(event.target.value)}
          placeholder={
            isItalian
              ? "Che cosa è successo e qual è il contesto da ricordare?"
              : "What happened and what context should be remembered?"
          }
          required
        />
      </div>
      <div className="grid gap-5 md:grid-cols-2">
        <div>
          <label className="label" htmlFor="outcome-facts">
            {isItalian ? "Da ricordare · uno per riga" : "Remember · one per line"}
          </label>
          <textarea
            id="outcome-facts"
            className="input min-h-32 resize-y"
            value={rememberedFacts}
            onChange={(event) => setRememberedFacts(event.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="outcome-decisions">
            {isItalian ? "Decisioni · una per riga" : "Decisions · one per line"}
          </label>
          <textarea
            id="outcome-decisions"
            className="input min-h-32 resize-y"
            value={decisions}
            onChange={(event) => setDecisions(event.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="outcome-actions">
            {isItalian ? "Attività · testo | responsabile" : "Actions · text | owner"}
          </label>
          <textarea
            id="outcome-actions"
            className="input min-h-32 resize-y"
            value={actions}
            onChange={(event) => setActions(event.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="outcome-questions">
            {isItalian ? "Questioni aperte · una per riga" : "Open questions · one per line"}
          </label>
          <textarea
            id="outcome-questions"
            className="input min-h-32 resize-y"
            value={openQuestions}
            onChange={(event) => setOpenQuestions(event.target.value)}
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-3">
        {saved && (
          <span className="text-sm font-medium text-emerald-700">
            {isItalian ? "Memoria aggiornata." : "Memory updated."}
          </span>
        )}
        {error && <span className="text-sm text-red-700">{error}</span>}
        <button type="submit" className="button-primary" disabled={pending}>
          {pending
            ? isItalian
              ? "Salvataggio…"
              : "Saving…"
            : isItalian
              ? "Salva nella memoria"
              : "Save to memory"}
        </button>
      </div>
    </form>
  );
}
