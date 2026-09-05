"use client";

import { type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import { useTranslations } from "@/i18n/I18nProvider";

export function SeriesAppointmentForm({ seriesId }: { seriesId: string }) {
  const router = useRouter();
  const { locale } = useTranslations();
  const isItalian = locale === "it";
  const [label, setLabel] = useState("");
  const [meetingUrl, setMeetingUrl] = useState("");
  const [scheduledStart, setScheduledStart] = useState("");
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(undefined);
    try {
      const response = await fetch(`/api/meeting-series/${seriesId}/appointments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label,
          meetingUrl,
          scheduledStart: new Date(scheduledStart).toISOString(),
          durationMinutes,
        }),
      });
      const payload = (await response.json()) as {
        meeting?: unknown;
      };
      if (!response.ok || !payload.meeting) {
        throw new Error();
      }
      setLabel("");
      setMeetingUrl("");
      setScheduledStart("");
      setDurationMinutes(60);
      router.refresh();
    } catch {
      setError(
        isItalian
          ? "Non siamo riusciti ad aggiungere l’appuntamento. Controlla i dati e riprova."
          : "We couldn’t add the appointment. Check the details and try again.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <label className="label" htmlFor="new-appointment-label">
          {isItalian ? "Nome appuntamento" : "Appointment name"}
          <span className="ml-1 font-normal text-slate-400">
            {isItalian ? "facoltativo" : "optional"}
          </span>
        </label>
        <input
          id="new-appointment-label"
          className="input"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder={isItalian ? "Revisione mensile" : "Monthly review"}
          maxLength={120}
        />
      </div>
      <div className="sm:col-span-2">
        <label className="label" htmlFor="new-appointment-url">
          {isItalian ? "Link Microsoft Teams" : "Microsoft Teams link"}
        </label>
        <input
          id="new-appointment-url"
          type="url"
          className="input"
          value={meetingUrl}
          onChange={(event) => setMeetingUrl(event.target.value)}
          placeholder="https://teams.microsoft.com/l/meetup-join/..."
          required
        />
      </div>
      <div>
        <label className="label" htmlFor="new-appointment-start">
          {isItalian ? "Data e ora" : "Date and time"}
        </label>
        <input
          id="new-appointment-start"
          type="datetime-local"
          className="input"
          value={scheduledStart}
          onChange={(event) => setScheduledStart(event.target.value)}
          required
        />
      </div>
      <div>
        <label className="label" htmlFor="new-appointment-duration">
          {isItalian ? "Durata" : "Duration"}
        </label>
        <select
          id="new-appointment-duration"
          className="input"
          value={durationMinutes}
          onChange={(event) => setDurationMinutes(Number(event.target.value))}
        >
          <option value={30}>30 min</option>
          <option value={45}>45 min</option>
          <option value={60}>60 min</option>
          <option value={90}>90 min</option>
          <option value={120}>120 min</option>
        </select>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-3 sm:col-span-2">
        {error && <span className="text-sm text-red-700">{error}</span>}
        <button type="submit" className="button-primary" disabled={pending}>
          {pending
            ? isItalian
              ? "Aggiunta…"
              : "Adding…"
            : isItalian
              ? "Aggiungi alla serie"
              : "Add to series"}
        </button>
      </div>
    </form>
  );
}
