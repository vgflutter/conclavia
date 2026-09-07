"use client";

import { type FormEvent, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { useTranslations } from "@/i18n/I18nProvider";
import type { CorrectionPolicy, MeetingLanguage } from "@/types/meeting";
import type { MeetingAutomationPublicConfig } from "@/types/meeting-automation";

type MeetingMode = "single" | "series";
type MeetingTiming = "now" | "scheduled";

type AppointmentDraft = {
  key: string;
  label: string;
  meetingUrl: string;
  scheduledStart: string;
  durationMinutes: number;
};

type AgendaDraft = {
  key: string;
  title: string;
  mandatory: boolean;
};

function initialAppointment(key: string): AppointmentDraft {
  return {
    key,
    label: "",
    meetingUrl: "",
    scheduledStart: "",
    durationMinutes: 60,
  };
}

export function MeetingCreateForm({
  automation,
  assistantName,
}: {
  automation: MeetingAutomationPublicConfig;
  assistantName: string;
}) {
  const router = useRouter();
  const { locale } = useTranslations();
  const isItalian = locale === "it";
  const nextAppointmentKey = useRef(2);
  const nextAgendaKey = useRef(2);
  const automaticEntryReady = automation.state === "ready";
  const [mode, setMode] = useState<MeetingMode>("single");
  const [timing, setTiming] = useState<MeetingTiming>(
    automaticEntryReady ? "now" : "scheduled",
  );
  const [title, setTitle] = useState("");
  const [objective, setObjective] = useState("");
  const [appointments, setAppointments] = useState<AppointmentDraft[]>([
    initialAppointment("appointment-1"),
  ]);
  const [language, setLanguage] = useState<MeetingLanguage>("auto");
  const [autoJoin, setAutoJoin] = useState(automaticEntryReady);
  const [agenda, setAgenda] = useState<AgendaDraft[]>([
    { key: "agenda-1", title: "", mandatory: true },
  ]);
  const [correctionPolicy, setCorrectionPolicy] =
    useState<CorrectionPolicy>("important_only");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const timezone = "Europe/Rome";

  function selectMode(nextMode: MeetingMode) {
    setMode(nextMode);
    setTiming(
      nextMode === "series" || !automaticEntryReady ? "scheduled" : "now",
    );
    if (nextMode === "single" && appointments.length > 1) {
      setAppointments([appointments[0]]);
    }
  }

  function updateAppointment(
    key: string,
    field: keyof Omit<AppointmentDraft, "key">,
    value: string | number,
  ) {
    setAppointments((current) =>
      current.map((appointment) =>
        appointment.key === key ? { ...appointment, [field]: value } : appointment,
      ),
    );
  }

  function addAppointment() {
    const key = `appointment-${nextAppointmentKey.current}`;
    nextAppointmentKey.current += 1;
    setAppointments((current) => [...current, initialAppointment(key)]);
  }

  function removeAppointment(key: string) {
    setAppointments((current) => current.filter((appointment) => appointment.key !== key));
  }

  function addAgendaItem() {
    const key = `agenda-${nextAgendaKey.current}`;
    nextAgendaKey.current += 1;
    setAgenda((current) => [...current, { key, title: "", mandatory: false }]);
  }

  function updateAgendaItem(key: string, value: Partial<Omit<AgendaDraft, "key">>) {
    setAgenda((current) =>
      current.map((item) => (item.key === key ? { ...item, ...value } : item)),
    );
  }

  function removeAgendaItem(key: string) {
    setAgenda((current) => current.filter((item) => item.key !== key));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(undefined);

    try {
      const joiningNow = mode === "single" && timing === "now";
      const automaticEntry = joiningNow ? true : autoJoin;
      const immediateStart = new Date(Date.now() + 30_000).toISOString();
      const normalizedAppointments = appointments.map((appointment, index) => ({
        label: appointment.label,
        meetingUrl: appointment.meetingUrl,
        scheduledStart:
          joiningNow && index === 0
            ? immediateStart
            : new Date(appointment.scheduledStart).toISOString(),
        durationMinutes: joiningNow && index === 0 ? 60 : appointment.durationMinutes,
      }));
      const normalizedAgenda = agenda
        .filter((item) => item.title.trim())
        .map((item) => ({ title: item.title, mandatory: item.mandatory }));

      const response = await fetch(
        mode === "series" ? "/api/meeting-series" : "/api/meetings",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            mode === "series"
              ? {
                  title,
                  objective,
                  timezone,
                  language,
                  autoJoin: automaticEntry,
                  agenda: normalizedAgenda,
                  correctionPolicy,
                  appointments: normalizedAppointments,
                }
              : {
                  title,
                  objective,
                  timezone,
                  language,
                  autoJoin: automaticEntry,
                  agenda: normalizedAgenda,
                  correctionPolicy,
                  ...normalizedAppointments[0],
                },
          ),
        },
      );
      const payload = (await response.json()) as {
        meeting?: { id: string };
        series?: { id: string };
      };

      if (!response.ok || (mode === "series" ? !payload.series : !payload.meeting)) {
        throw new Error();
      }

      router.push(
        mode === "series"
          ? `/meetings/series/${payload.series?.id}`
          : `/meetings/${payload.meeting?.id}`,
      );
      router.refresh();
    } catch {
      setError(
        isItalian
          ? "Non siamo riusciti a salvare il meeting. Controlla i dati e riprova."
          : "We couldn’t save the meeting. Check the details and try again.",
      );
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <fieldset className="card p-2">
        <legend className="sr-only">
          {isItalian ? "Tipo di programmazione" : "Schedule type"}
        </legend>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => selectMode("single")}
            aria-pressed={mode === "single"}
            className={`rounded-xl px-4 py-4 text-left transition ${
              mode === "single"
                ? "bg-[#1f5139] text-white shadow-sm"
                : "text-slate-600 hover:bg-slate-50"
            }`}
          >
            <span className="block text-sm font-bold">
              {isItalian ? "Meeting singolo" : "Single meeting"}
            </span>
            <span className={`mt-1 block text-xs leading-5 ${mode === "single" ? "text-white/65" : "text-slate-400"}`}>
              {isItalian ? "Un appuntamento e un link." : "One appointment and one link."}
            </span>
          </button>
          <button
            type="button"
            onClick={() => selectMode("series")}
            aria-pressed={mode === "series"}
            className={`rounded-xl px-4 py-4 text-left transition ${
              mode === "series"
                ? "bg-[#1f5139] text-white shadow-sm"
                : "text-slate-600 hover:bg-slate-50"
            }`}
          >
            <span className="block text-sm font-bold">
              {isItalian ? "Serie di meeting" : "Meeting series"}
            </span>
            <span className={`mt-1 block text-xs leading-5 ${mode === "series" ? "text-white/65" : "text-slate-400"}`}>
              {isItalian ? "Più appuntamenti, una memoria." : "Several appointments, one memory."}
            </span>
          </button>
        </div>
      </fieldset>

      <section className="card p-5 sm:p-7">
        <p className="text-xs font-semibold uppercase tracking-[0.15em] text-[#295c43]">
          {mode === "series"
            ? isItalian
              ? "Percorso condiviso"
              : "Shared journey"
            : isItalian
              ? "Il meeting"
              : "The meeting"}
        </p>
        <h2 className="mt-2 text-xl font-semibold">
          {mode === "series"
            ? isItalian
              ? "Una serie mantiene il filo tra gli appuntamenti"
              : "A series keeps every appointment connected"
            : isItalian
              ? "Prepara il meeting"
              : "Prepare the meeting"}
        </h2>

        <div className="mt-6 grid gap-5">
          <div>
            <label className="label" htmlFor="meeting-title">
              {mode === "series"
                ? isItalian
                  ? "Nome della serie"
                  : "Series name"
                : isItalian
                  ? "Titolo del meeting"
                  : "Meeting title"}
            </label>
            <input
              id="meeting-title"
              className="input"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={
                mode === "series"
                  ? isItalian
                    ? "Progetto Conclavia · Weekly"
                    : "Conclavia project · Weekly"
                  : isItalian
                    ? "Kickoff prodotto"
                    : "Product kickoff"
              }
              maxLength={160}
              required
            />
          </div>
          <div>
            <label className="label" htmlFor="meeting-objective">
              {isItalian ? "Obiettivo del meeting" : "Meeting objective"}
            </label>
            <textarea
              id="meeting-objective"
              className="input min-h-24 resize-y"
              value={objective}
              onChange={(event) => setObjective(event.target.value)}
              placeholder={
                isItalian
                  ? "Che cosa deve capire, ottenere o ricordare il collega digitale?"
                  : "What should the digital colleague understand, achieve or remember?"
              }
              maxLength={2_000}
              required
            />
          </div>
        </div>
      </section>

      <section className="card p-5 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.15em] text-[#295c43]">
              {isItalian ? "Scaletta" : "Agenda"}
            </p>
            <h2 className="mt-2 text-xl font-semibold">
              {isItalian ? "Che cosa deve essere affrontato" : "What must be covered"}
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              {isItalian ? "Segna come obbligatori i punti che non possono essere saltati." : "Mark items as mandatory when they cannot be skipped."}
            </p>
          </div>
          {agenda.length < 20 && (
            <button type="button" onClick={addAgendaItem} className="button-secondary">
              <span aria-hidden="true">＋</span> {isItalian ? "Aggiungi punto" : "Add item"}
            </button>
          )}
        </div>
        <div className="mt-6 space-y-3">
          {agenda.map((item, index) => (
            <div key={item.key} className="grid gap-3 rounded-xl border border-slate-200 bg-[#fafbf9] p-4 sm:grid-cols-[auto_minmax(0,1fr)_auto_auto] sm:items-center">
              <span className="flex size-8 items-center justify-center rounded-full bg-[#e4eee7] text-xs font-bold text-[#295c43]">{index + 1}</span>
              <label className="min-w-0">
                <span className="sr-only">{isItalian ? `Punto ${index + 1}` : `Item ${index + 1}`}</span>
                <input className="input" value={item.title} onChange={(event) => updateAgendaItem(item.key, { title: event.target.value })} placeholder={isItalian ? "Es. Approvare la roadmap" : "E.g. Approve the roadmap"} maxLength={500} />
              </label>
              <label className="flex items-center gap-2 whitespace-nowrap text-sm font-medium text-slate-600">
                <input type="checkbox" checked={item.mandatory} onChange={(event) => updateAgendaItem(item.key, { mandatory: event.target.checked })} className="size-4 accent-[#295c43]" />
                {isItalian ? "Obbligatorio" : "Mandatory"}
              </label>
              <button type="button" onClick={() => removeAgendaItem(item.key)} className="rounded-lg px-2.5 py-2 text-xs font-semibold text-red-700 hover:bg-red-50" aria-label={isItalian ? `Rimuovi punto ${index + 1}` : `Remove item ${index + 1}`}>×</button>
            </div>
          ))}
          {!agenda.length && <p className="rounded-xl border border-dashed border-slate-200 p-4 text-sm text-slate-500">{isItalian ? "Nessun punto: puoi aggiungerne uno." : "No items: add one when ready."}</p>}
        </div>
      </section>

      <section className="card p-5 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.15em] text-[#295c43]">
              {isItalian ? "Calendario" : "Schedule"}
            </p>
            <h2 className="mt-2 text-xl font-semibold">
              {mode === "series"
                ? isItalian
                  ? `${appointments.length} ${appointments.length === 1 ? "appuntamento" : "appuntamenti"}, anche con link Teams diversi`
                  : `${appointments.length} ${appointments.length === 1 ? "appointment" : "appointments"}, including different Teams links`
                : isItalian
                  ? "Dove e quando deve entrare"
                  : "Where and when to join"}
            </h2>
          </div>
          {mode === "series" && appointments.length < 24 && (
            <button type="button" onClick={addAppointment} className="button-secondary">
              <span aria-hidden="true">＋</span>{" "}
              {isItalian ? "Aggiungi appuntamento" : "Add appointment"}
            </button>
          )}
        </div>

        {mode === "single" && automaticEntryReady && (
          <fieldset className="mt-6">
            <legend className="label">
              {isItalian ? "Quando deve entrare" : "When should it join"}
            </legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => {
                  setTiming("now");
                  setAutoJoin(true);
                }}
                aria-pressed={timing === "now"}
                className={`rounded-xl border p-4 text-left transition ${
                  timing === "now"
                    ? "border-[#6e9a7d] bg-[#e9f2ec] text-[#204d36]"
                    : "border-slate-200 text-slate-500 hover:bg-slate-50"
                }`}
              >
                <strong className="block text-sm">
                  {isItalian ? "Entra ora" : "Join now"}
                </strong>
                <span className="mt-1 block text-xs leading-5">
                  {isItalian
                    ? "Entra appena salvi il meeting."
                    : "Join as soon as you save the meeting."}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setTiming("scheduled")}
                aria-pressed={timing === "scheduled"}
                className={`rounded-xl border p-4 text-left transition ${
                  timing === "scheduled"
                    ? "border-[#6e9a7d] bg-[#e9f2ec] text-[#204d36]"
                    : "border-slate-200 text-slate-500 hover:bg-slate-50"
                }`}
              >
                <strong className="block text-sm">
                  {isItalian ? "Pianifica" : "Schedule"}
                </strong>
                <span className="mt-1 block text-xs leading-5">
                  {isItalian
                    ? "Scegli data, ora e durata."
                    : "Choose the date, time and duration."}
                </span>
              </button>
            </div>
          </fieldset>
        )}

        <div className="mt-6 space-y-4">
          {appointments.map((appointment, index) => (
            <fieldset key={appointment.key} className="rounded-2xl border border-slate-200 bg-[#fafbf9] p-4 sm:p-5">
              <legend className="sr-only">
                {isItalian ? `Appuntamento ${index + 1}` : `Appointment ${index + 1}`}
              </legend>
              <div className="mb-4 flex items-center justify-between gap-3">
                <span className="flex size-8 items-center justify-center rounded-full bg-[#e4eee7] text-sm font-bold text-[#295c43]">
                  {index + 1}
                </span>
                {mode === "series" && appointments.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeAppointment(appointment.key)}
                    className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50"
                  >
                    {isItalian ? "Rimuovi" : "Remove"}
                  </button>
                )}
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                {mode === "series" && (
                  <div className="sm:col-span-2">
                    <label className="label" htmlFor={`${appointment.key}-label`}>
                      {isItalian ? "Nome appuntamento" : "Appointment name"}
                      <span className="ml-1 font-normal text-slate-400">
                        {isItalian ? "facoltativo" : "optional"}
                      </span>
                    </label>
                    <input
                      id={`${appointment.key}-label`}
                      className="input"
                      value={appointment.label}
                      onChange={(event) => updateAppointment(appointment.key, "label", event.target.value)}
                      placeholder={isItalian ? "Kickoff, revisione, follow-up…" : "Kickoff, review, follow-up…"}
                      maxLength={120}
                    />
                  </div>
                )}
                <div className="sm:col-span-2">
                  <label className="label" htmlFor={`${appointment.key}-url`}>
                    {isItalian ? "Link Microsoft Teams" : "Microsoft Teams link"}
                  </label>
                  <input
                    id={`${appointment.key}-url`}
                    type="url"
                    className="input"
                    value={appointment.meetingUrl}
                    onChange={(event) => updateAppointment(appointment.key, "meetingUrl", event.target.value)}
                    placeholder="https://teams.microsoft.com/l/meetup-join/..."
                    required
                  />
                </div>
                {(mode === "series" || timing === "scheduled") && (
                  <>
                    <div>
                      <label className="label" htmlFor={`${appointment.key}-start`}>
                        {isItalian ? "Data e ora" : "Date and time"}
                      </label>
                      <input
                        id={`${appointment.key}-start`}
                        type="datetime-local"
                        className="input"
                        value={appointment.scheduledStart}
                        onChange={(event) => updateAppointment(appointment.key, "scheduledStart", event.target.value)}
                        required
                      />
                    </div>
                    <div>
                      <label className="label" htmlFor={`${appointment.key}-duration`}>
                        {isItalian ? "Durata" : "Duration"}
                      </label>
                      <select
                        id={`${appointment.key}-duration`}
                        className="input"
                        value={appointment.durationMinutes}
                        onChange={(event) => updateAppointment(appointment.key, "durationMinutes", Number(event.target.value))}
                      >
                        <option value={30}>30 min</option>
                        <option value={45}>45 min</option>
                        <option value={60}>60 min</option>
                        <option value={90}>90 min</option>
                        <option value={120}>120 min</option>
                      </select>
                    </div>
                  </>
                )}
              </div>
            </fieldset>
          ))}
        </div>
      </section>

      {mode === "series" && (
        <div className="rounded-2xl border border-[#bfd5c5] bg-[#eef5f0] p-5">
          <p className="text-sm font-semibold text-[#204d36]">
            {isItalian ? "Memoria unica della serie" : "One memory for the series"}
          </p>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            {isItalian
              ? "Decisioni, attività aperte e domande passeranno automaticamente da un appuntamento al successivo, anche usando link Teams diversi."
              : "Decisions, open actions and questions move automatically from one appointment to the next, even across different Teams links."}
          </p>
        </div>
      )}

      <details className="card group overflow-hidden">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-5 hover:bg-[#fafcf9] sm:p-6">
          <div>
            <p className="section-kicker">{isItalian ? "Preferenze" : "Preferences"}</p>
            <h2 className="mt-2 text-lg font-semibold">
              {isItalian ? "Lingua e interventi" : "Language and contributions"}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              {isItalian ? "Automatico IT/EN · interviene solo per inesattezze importanti" : "Automatic IT/EN · contributes only for important inaccuracies"}
            </p>
          </div>
          <span aria-hidden="true" className="text-lg text-slate-400 transition-transform group-open:rotate-180">⌄</span>
        </summary>
        <div className="grid gap-5 border-t border-slate-100 p-5 sm:grid-cols-2 sm:p-6">
          <div>
            <label className="label" htmlFor="meeting-language">
              {isItalian ? "Lingua" : "Language"}
            </label>
            <select
              id="meeting-language"
              className="input"
              value={language}
              onChange={(event) => setLanguage(event.target.value as MeetingLanguage)}
            >
              <option value="auto">{isItalian ? "Automatica · IT/EN" : "Automatic · IT/EN"}</option>
              <option value="it">Italiano</option>
              <option value="en">English</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="meeting-correction-policy">
              {isItalian ? "Correzione delle inesattezze" : "Inaccuracy correction"}
            </label>
            <select
              id="meeting-correction-policy"
              className="input"
              value={correctionPolicy}
              onChange={(event) => setCorrectionPolicy(event.target.value as CorrectionPolicy)}
            >
              <option value="important_only">{isItalian ? "Alza la mano solo se è importante" : "Raise its hand only when important"}</option>
              <option value="on_request">{isItalian ? "Correggi solo su richiesta" : "Correct only when asked"}</option>
              <option value="off">{isItalian ? "Non intervenire" : "Do not intervene"}</option>
            </select>
          </div>
          {automaticEntryReady && mode === "single" && timing === "now" ? (
            <div className="rounded-xl bg-[#f3f7f4] p-4 sm:col-span-2">
              <p className="text-sm font-semibold text-[#204d36]">
                {isItalian ? "Ingresso immediato" : "Immediate entry"}
              </p>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                {isItalian
                  ? "Il collega digitale entrerà appena salvi. Se trova una sala d’attesa, dovrai ammetterlo."
                  : "The digital colleague will join as soon as you save. If it reaches a lobby, you will need to admit it."}
              </p>
            </div>
          ) : automaticEntryReady ? (
            <label className="flex items-start gap-3 rounded-xl bg-[#f3f7f4] p-4 sm:col-span-2">
              <input
                type="checkbox"
                checked={autoJoin}
                onChange={(event) => setAutoJoin(event.target.checked)}
                className="mt-0.5 size-4 accent-[#295c43]"
              />
              <span>
                <span className="block text-sm font-semibold">
                  {isItalian
                    ? "Programma l’ingresso automatico"
                    : "Schedule automatic join"}
                </span>
                <span className="mt-1 block text-xs leading-5 text-slate-500">
                  {isItalian
                    ? "Il collega digitale entrerà all’orario indicato. Se trova una sala d’attesa, dovrai ammetterlo."
                    : "The digital colleague will join at the selected time. If it reaches a lobby, you will need to admit it."}
                </span>
              </span>
            </label>
          ) : null}
          {correctionPolicy === "important_only" && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 sm:col-span-2">
              <p className="text-sm font-semibold text-amber-950">
                {isItalian ? "Non interrompe la conversazione" : "It does not interrupt the conversation"}
              </p>
              <p className="mt-1 text-xs leading-5 text-amber-900/75">
                {isItalian
                  ? `Se ${assistantName} rileva un errore importante o possiede un’informazione davvero utile, alza la mano. Parla soltanto dopo che qualcuno gli dice “${assistantName}, vai pure”.`
                  : `If ${assistantName} notices an important error or has genuinely useful information, it raises its hand. It speaks only after someone says “${assistantName}, go ahead”.`}
              </p>
            </div>
          )}
        </div>
      </details>

      {error && (
        <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="flex flex-col gap-3 rounded-2xl border border-[#d9e4da] bg-white p-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs leading-5 text-slate-500 sm:max-w-xl">
          {isItalian
            ? `Nel meeting puoi chiamarlo dicendo “${assistantName}” per fare domande, ricordare, riepilogare o seguire la scaletta.`
            : `In the meeting, say “${assistantName}” to ask questions, remember, summarize or follow the agenda.`}
        </p>
        <button type="submit" className="button-primary min-w-44" disabled={submitting}>
          {submitting
            ? isItalian
              ? "Salvataggio…"
              : "Saving…"
            : mode === "series"
              ? isItalian
                ? "Crea serie"
                : "Create series"
              : isItalian
                ? timing === "now"
                  ? "Salva e fai entrare"
                  : "Memorizza meeting"
                : timing === "now"
                  ? "Save and join"
                  : "Save meeting"}
        </button>
      </div>
    </form>
  );
}
