"use client";

import { type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import { BusinessAvatar } from "@/components/BusinessAvatar";
import { useTranslations } from "@/i18n/I18nProvider";
import type {
  AssistantAttitude,
  AssistantProfileResponse,
  AssistantResponseStyle,
  AssistantVoiceStyle,
} from "@/types/assistant-profile";

export function AvatarSettingsForm({ profile }: { profile: AssistantProfileResponse }) {
  const router = useRouter();
  const { locale } = useTranslations();
  const isItalian = locale === "it";
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [role, setRole] = useState(profile.role);
  const [responseStyle, setResponseStyle] = useState<AssistantResponseStyle>(
    profile.personality.responseStyle,
  );
  const [attitude, setAttitude] = useState<AssistantAttitude>(
    profile.personality.attitude,
  );
  const [voiceStyle, setVoiceStyle] = useState<AssistantVoiceStyle>(profile.voice.style);
  const [speakingRate, setSpeakingRate] = useState(profile.voice.speakingRate);
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string>();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setSaved(false);
    setError(undefined);
    try {
      const response = await fetch("/api/avatar", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName,
          role,
          responseStyle,
          attitude,
          voiceStyle,
          speakingRate,
        }),
      });
      const payload = (await response.json()) as { profile?: unknown };
      if (!response.ok || !payload.profile) throw new Error();
      setSaved(true);
      router.refresh();
    } catch {
      setError(
        isItalian
          ? "Non siamo riusciti a salvare le modifiche. Riprova."
          : "We couldn’t save your changes. Please try again.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-6 lg:grid-cols-[minmax(20rem,0.9fr)_minmax(0,1.1fr)]">
      <section className="relative min-h-[34rem] overflow-hidden rounded-[2rem] bg-[#09100d]">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_35%,rgba(79,170,126,0.28),transparent_42%)]" />
        <div className="absolute inset-x-[8%] bottom-0 top-4">
          <BusinessAvatar ariaLabel={isItalian ? "Avatar del collega digitale in abito business" : "Business-style digital colleague avatar"} />
        </div>
        <div className="absolute inset-x-0 top-0 flex items-center justify-between border-b border-white/10 px-5 py-4 text-[11px] font-bold uppercase tracking-[0.17em] text-white/45">
          <span>{isItalian ? "Anteprima avatar" : "Avatar preview"}</span>
          <span className="text-[#bde88d]">{isItalian ? "Stile professionale" : "Professional style"}</span>
        </div>
        <div className="absolute bottom-5 left-5 border-l-4 border-[#bde88d] bg-black/65 px-4 py-3 backdrop-blur">
          <strong className="block text-sm uppercase tracking-[0.14em] text-[#bde88d]">{displayName || "Conclavia"}</strong>
          <span className="mt-1 block text-sm text-white/80">{role || (isItalian ? "Collega digitale" : "Digital colleague")}</span>
        </div>
      </section>

      <div className="space-y-6">
        <section className="card p-5 sm:p-7">
          <p className="text-xs font-semibold uppercase tracking-[0.15em] text-[#295c43]">{isItalian ? "Identità" : "Identity"}</p>
          <h2 className="mt-2 text-xl font-semibold">{isItalian ? "Come appare nel meeting" : "How it appears in the meeting"}</h2>
          <div className="mt-6 grid gap-5 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="avatar-name">{isItalian ? "Nome e parola di richiamo" : "Name and call phrase"}</label>
              <input id="avatar-name" className="input" value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={80} required />
              <p className="mt-2 text-xs leading-5 text-slate-500">
                {isItalian
                  ? "Apparirà con questo nome e risponderà quando lo pronunci nel meeting."
                  : "It appears with this name and responds when you say it in the meeting."}
              </p>
            </div>
            <div>
              <label className="label" htmlFor="avatar-role">{isItalian ? "Ruolo mostrato" : "Displayed role"}</label>
              <input id="avatar-role" className="input" value={role} onChange={(event) => setRole(event.target.value)} maxLength={120} required />
            </div>
          </div>
        </section>

        <section className="card p-5 sm:p-7">
          <p className="text-xs font-semibold uppercase tracking-[0.15em] text-[#295c43]">
            {isItalian ? "Personalità" : "Personality"}
          </p>
          <h2 className="mt-2 text-xl font-semibold">
            {isItalian ? "Come si comporta nel meeting" : "How it behaves in the meeting"}
          </h2>
          <p className="mt-3 text-sm leading-6 text-slate-500">
            {isItalian
              ? "Due scelte semplici per rendere i suoi interventi coerenti con il tuo modo di lavorare."
              : "Two simple choices to keep its contributions consistent with how you work."}
          </p>
          <div className="mt-6 grid gap-5 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="response-style">
                {isItalian ? "Stile delle risposte" : "Response style"}
              </label>
              <select
                id="response-style"
                className="input"
                value={responseStyle}
                onChange={(event) =>
                  setResponseStyle(event.target.value as AssistantResponseStyle)
                }
              >
                <option value="concise">{isItalian ? "Sintetico" : "Concise"}</option>
                <option value="balanced">{isItalian ? "Equilibrato" : "Balanced"}</option>
                <option value="detailed">{isItalian ? "Approfondito" : "Detailed"}</option>
              </select>
              <p className="mt-2 text-xs leading-5 text-slate-500">
                {isItalian
                  ? responseStyle === "concise"
                    ? "Va subito al punto con risposte brevi."
                    : responseStyle === "detailed"
                      ? "Aggiunge più contesto quando è utile."
                      : "Risposte brevi ma complete."
                  : responseStyle === "concise"
                    ? "Gets straight to the point with short answers."
                    : responseStyle === "detailed"
                      ? "Adds more context when useful."
                      : "Keeps answers brief but complete."}
              </p>
            </div>
            <div>
              <label className="label" htmlFor="assistant-attitude">
                {isItalian ? "Atteggiamento" : "Attitude"}
              </label>
              <select
                id="assistant-attitude"
                className="input"
                value={attitude}
                onChange={(event) =>
                  setAttitude(event.target.value as AssistantAttitude)
                }
              >
                <option value="discreet">{isItalian ? "Discreto" : "Discreet"}</option>
                <option value="collaborative">{isItalian ? "Collaborativo" : "Collaborative"}</option>
                <option value="proactive">{isItalian ? "Propositivo" : "Proactive"}</option>
              </select>
              <p className="mt-2 text-xs leading-5 text-slate-500">
                {isItalian
                  ? attitude === "discreet"
                    ? "Interviene soltanto quando è davvero utile."
                    : attitude === "proactive"
                      ? "Suggerisce con misura domande e prossimi passi."
                      : "Partecipa con naturalezza senza prendere il controllo."
                  : attitude === "discreet"
                    ? "Contributes only when it is genuinely useful."
                    : attitude === "proactive"
                      ? "Suggests questions and next steps with restraint."
                      : "Contributes naturally without taking over."}
              </p>
            </div>
          </div>
        </section>

        <section className="card p-5 sm:p-7">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.15em] text-[#295c43]">{isItalian ? "Voce" : "Voice"}</p>
              <h2 className="mt-2 text-xl font-semibold">{isItalian ? "Una voce chiara e professionale" : "A clear, professional voice"}</h2>
            </div>
            <span className="rounded-full bg-[#e4eee7] px-3 py-1 text-xs font-semibold text-[#295c43]">{isItalian ? "Italiano e inglese" : "Italian and English"}</span>
          </div>
          <p className="mt-3 text-sm leading-6 text-slate-500">
            {isItalian
              ? "Scegli il timbro e la velocità con cui il collega digitale parlerà durante i meeting."
              : "Choose the voice and speaking pace the digital colleague will use during meetings."}
          </p>
          <div className="mt-6 grid gap-5 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="voice-style">{isItalian ? "Timbro" : "Voice character"}</label>
              <select id="voice-style" className="input" value={voiceStyle} onChange={(event) => setVoiceStyle(event.target.value as AssistantVoiceStyle)}>
                <option value="executive_warm">{isItalian ? "Executive caldo" : "Warm executive"}</option>
                <option value="executive_clear">{isItalian ? "Executive nitido" : "Clear executive"}</option>
              </select>
            </div>
            <div>
              <label className="label" htmlFor="speaking-rate">{isItalian ? "Velocità" : "Speaking rate"} · {speakingRate.toFixed(2)}×</label>
              <input id="speaking-rate" type="range" min="0.8" max="1.1" step="0.01" value={speakingRate} onChange={(event) => setSpeakingRate(Number(event.target.value))} className="mt-3 w-full accent-[#295c43]" />
            </div>
          </div>
        </section>

        <div className="flex flex-wrap items-center justify-end gap-3">
          {saved && <span className="text-sm font-medium text-emerald-700">{isItalian ? "Avatar aggiornato." : "Avatar updated."}</span>}
          {error && <span className="text-sm text-red-700">{error}</span>}
          <button type="submit" className="button-primary" disabled={pending}>{pending ? (isItalian ? "Salvataggio…" : "Saving…") : (isItalian ? "Salva avatar" : "Save avatar")}</button>
        </div>
      </div>
    </form>
  );
}
