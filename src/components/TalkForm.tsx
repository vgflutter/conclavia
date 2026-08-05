"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import { useRouter } from "next/navigation";

import { useTranslations } from "@/i18n/I18nProvider";
import type { Participant, TalkInput, TalkResponse } from "@/types/talk";

const emptyParticipant = (): Participant => ({
  name: "",
  role: "",
  perspectivePrompt: "",
  speakingStylePrompt: "",
  assertiveness: 50,
  patience: 50,
  interruptiveness: 20,
  baselineTension: 20,
});

const initialTalk: TalkInput = {
  title: "",
  topic: "",
  description: "",
  language: "English",
  participants: Array.from({ length: 5 }, emptyParticipant),
  status: "draft",
  settings: {
    maxTurns: 20,
    allowInterruptions: true,
    seekCommonGround: true,
  },
};

interface ApiResponse {
  talk?: TalkResponse;
  error?: string;
  issues?: string[];
}

interface ScoreFieldProps {
  id: string;
  label: string;
  value: number;
  onChange: (value: number) => void;
}

function ScoreField({ id, label, value, onChange }: ScoreFieldProps) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        <output htmlFor={id} className="min-w-8 text-right text-sm font-semibold text-[#295c43]">
          {value}
        </output>
      </div>
      <input
        id={id}
        type="range"
        min="0"
        max="100"
        step="1"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full cursor-pointer accent-[#295c43]"
      />
      <div className="mt-1 flex justify-between text-[11px] text-slate-400" aria-hidden="true">
        <span>0</span>
        <span>100</span>
      </div>
    </div>
  );
}

export function TalkForm() {
  const router = useRouter();
  const { locale, t } = useTranslations();
  const [talk, setTalk] = useState<TalkInput>(() => ({
    ...initialTalk,
    language: locale === "it" ? "Italiano" : "English",
  }));
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  function updateParticipant<K extends keyof Participant>(
    index: number,
    field: K,
    value: Participant[K],
  ) {
    setTalk((current) => ({
      ...current,
      participants: current.participants.map((participant, participantIndex) =>
        participantIndex === index
          ? { ...participant, [field]: value }
          : participant,
      ),
    }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setErrors([]);

    try {
      const response = await fetch("/api/talks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(talk),
      });
      const payload = (await response.json()) as ApiResponse;

      if (!response.ok || !payload.talk) {
        setErrors([t("saveError")]);
        return;
      }

      router.push(`/talks/${payload.talk.id}`);
      router.refresh();
    } catch {
      setErrors([t("networkError")]);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      {errors.length > 0 && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          <p className="font-semibold">{t("reviewConfiguration")}</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </div>
      )}

      <section className="card p-5 sm:p-6">
        <div className="mb-6">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#295c43]">{t("step1")}</p>
          <h2 className="mt-1 text-xl font-semibold">{t("talkDetails")}</h2>
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label htmlFor="title" className="label">{t("title")}</label>
            <input
              id="title"
              required
              value={talk.title}
              onChange={(event) => setTalk({ ...talk, title: event.target.value })}
              className="input"
              placeholder={t("titlePlaceholder")}
            />
          </div>
          <div>
            <label htmlFor="language" className="label">{t("language")}</label>
            <select
              id="language"
              required
              value={talk.language}
              onChange={(event) => setTalk({ ...talk, language: event.target.value })}
              className="input"
            >
              <option value="English">{t("talkLanguageEnglish")}</option>
              <option value="Italiano">{t("talkLanguageItalian")}</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="topic" className="label">{t("topic")}</label>
            <textarea
              id="topic"
              required
              rows={3}
              value={talk.topic}
              onChange={(event) => setTalk({ ...talk, topic: event.target.value })}
              className="input resize-y"
              placeholder={t("topicPlaceholder")}
            />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="description" className="label">
              {t("description")} <span className="font-normal text-slate-400">({t("optional")})</span>
            </label>
            <textarea
              id="description"
              rows={3}
              value={talk.description ?? ""}
              onChange={(event) => setTalk({ ...talk, description: event.target.value })}
              className="input resize-y"
              placeholder={t("descriptionPlaceholder")}
            />
          </div>
          <div>
            <label htmlFor="status" className="label">{t("status")}</label>
            <select
              id="status"
              value={talk.status}
              onChange={(event) =>
                setTalk({ ...talk, status: event.target.value as TalkInput["status"] })
              }
              className="input"
            >
              <option value="draft">{t("statusDraft")}</option>
              <option value="ready">{t("statusReady")}</option>
            </select>
          </div>
        </div>
      </section>

      <section>
        <div className="mb-5">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#295c43]">{t("step2")}</p>
          <h2 className="mt-1 text-xl font-semibold">{t("participants")}</h2>
          <p className="mt-1 text-sm text-slate-600">
            {t("participantsDescription")}
          </p>
        </div>

        <div className="space-y-5">
          {talk.participants.map((participant, index) => (
            <article key={index} className="card p-5 sm:p-6">
              <div className="mb-6 flex items-center gap-3">
                <span className="flex size-8 items-center justify-center rounded-full bg-[#e4eee7] text-sm font-bold text-[#295c43]">
                  {index + 1}
                </span>
                <h3 className="font-semibold">
                  {participant.name || t("participantNumber", { number: index + 1 })}
                </h3>
              </div>

              <div className="grid gap-5 sm:grid-cols-2">
                <div>
                  <label htmlFor={`participant-${index}-name`} className="label">{t("name")}</label>
                  <input
                    id={`participant-${index}-name`}
                    required
                    value={participant.name}
                    onChange={(event) => updateParticipant(index, "name", event.target.value)}
                    className="input"
                    placeholder={t("participantNamePlaceholder")}
                  />
                </div>
                <div>
                  <label htmlFor={`participant-${index}-role`} className="label">{t("role")}</label>
                  <input
                    id={`participant-${index}-role`}
                    required
                    value={participant.role}
                    onChange={(event) => updateParticipant(index, "role", event.target.value)}
                    className="input"
                    placeholder={t("participantRolePlaceholder")}
                  />
                </div>
                <div className="sm:col-span-2">
                  <label htmlFor={`participant-${index}-perspective`} className="label">
                    {t("perspectivePrompt")}
                  </label>
                  <textarea
                    id={`participant-${index}-perspective`}
                    required
                    rows={3}
                    value={participant.perspectivePrompt}
                    onChange={(event) =>
                      updateParticipant(index, "perspectivePrompt", event.target.value)
                    }
                    className="input resize-y"
                    placeholder={t("perspectivePlaceholder")}
                  />
                </div>
                <div className="sm:col-span-2">
                  <label htmlFor={`participant-${index}-style`} className="label">
                    {t("speakingStylePrompt")} <span className="font-normal text-slate-400">({t("optional")})</span>
                  </label>
                  <textarea
                    id={`participant-${index}-style`}
                    rows={2}
                    value={participant.speakingStylePrompt ?? ""}
                    onChange={(event) =>
                      updateParticipant(index, "speakingStylePrompt", event.target.value)
                    }
                    className="input resize-y"
                    placeholder={t("speakingStylePlaceholder")}
                  />
                </div>
              </div>

              <div className="mt-6 grid gap-x-8 gap-y-5 border-t border-slate-100 pt-6 sm:grid-cols-2">
                <ScoreField
                  id={`participant-${index}-assertiveness`}
                  label={t("assertiveness")}
                  value={participant.assertiveness}
                  onChange={(value) => updateParticipant(index, "assertiveness", value)}
                />
                <ScoreField
                  id={`participant-${index}-patience`}
                  label={t("patience")}
                  value={participant.patience}
                  onChange={(value) => updateParticipant(index, "patience", value)}
                />
                <ScoreField
                  id={`participant-${index}-interruptiveness`}
                  label={t("interruptiveness")}
                  value={participant.interruptiveness}
                  onChange={(value) => updateParticipant(index, "interruptiveness", value)}
                />
                <ScoreField
                  id={`participant-${index}-tension`}
                  label={t("baselineTension")}
                  value={participant.baselineTension}
                  onChange={(value) => updateParticipant(index, "baselineTension", value)}
                />
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="card p-5 sm:p-6">
        <div className="mb-6">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#295c43]">{t("step3")}</p>
          <h2 className="mt-1 text-xl font-semibold">{t("talkSettings")}</h2>
        </div>
        <div className="grid gap-6 sm:grid-cols-2">
          <div>
            <label htmlFor="maxTurns" className="label">{t("maximumTurns")}</label>
            <input
              id="maxTurns"
              type="number"
              min="1"
              required
              value={talk.settings.maxTurns}
              onChange={(event) =>
                setTalk({
                  ...talk,
                  settings: { ...talk.settings, maxTurns: Number(event.target.value) },
                })
              }
              className="input"
            />
          </div>
          <div className="space-y-4 sm:pt-7">
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={talk.settings.allowInterruptions}
                onChange={(event) =>
                  setTalk({
                    ...talk,
                    settings: {
                      ...talk.settings,
                      allowInterruptions: event.target.checked,
                    },
                  })
                }
                className="mt-0.5 size-4 accent-[#295c43]"
              />
              <span>
                <span className="block text-sm font-medium">{t("allowInterruptions")}</span>
                <span className="mt-0.5 block text-xs leading-5 text-slate-500">
                  {t("allowInterruptionsHelp")}
                </span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={talk.settings.seekCommonGround}
                onChange={(event) =>
                  setTalk({
                    ...talk,
                    settings: {
                      ...talk.settings,
                      seekCommonGround: event.target.checked,
                    },
                  })
                }
                className="mt-0.5 size-4 accent-[#295c43]"
              />
              <span>
                <span className="block text-sm font-medium">{t("seekCommonGround")}</span>
                <span className="mt-0.5 block text-xs leading-5 text-slate-500">
                  {t("seekCommonGroundHelp")}
                </span>
              </span>
            </label>
          </div>
        </div>
      </section>

      <div className="flex flex-col-reverse gap-3 border-t border-[#dfe4dc] pt-6 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={() => router.push("/talks")}
          disabled={submitting}
          className="button-secondary"
        >
          {t("cancel")}
        </button>
        <button type="submit" disabled={submitting} className="button-primary min-w-32">
          {submitting ? t("saving") : t("saveTalk")}
        </button>
      </div>
    </form>
  );
}
