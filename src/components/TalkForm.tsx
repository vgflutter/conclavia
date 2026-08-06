"use client";

import Image from "next/image";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { useTranslations } from "@/i18n/I18nProvider";
import type { TranslationKey } from "@/i18n/translations";
import {
  DEFAULT_LLM_MODEL,
  getLlmModel,
  LLM_MODELS,
  type LlmModelId,
  type LlmProvider,
} from "@/lib/llm-models";
import { MAX_RUN_TURNS } from "@/lib/talk-run-compatibility";
import {
  DEFAULT_STUDIO_THEME,
  STUDIO_THEMES,
  type StudioThemeId,
} from "@/lib/studio-themes";
import type {
  ModeratorKind,
  Participant,
  ParticipantKind,
  PerspectiveMode,
  TalkInput,
  TalkPace,
  TalkResponse,
} from "@/types/talk";

type CastPreset = "allAi" | "hybrid" | "allHuman" | "unassigned";
type CastGenerationMode = "manual" | "suggested" | "random";

const DURATION_OPTIONS = [3, 5] as const;

const STUDIO_THEME_COPY: Record<
  StudioThemeId,
  { title: TranslationKey; description: TranslationKey }
> = {
  broadcast_panel: {
    title: "studioThemeBroadcast",
    description: "studioThemeBroadcastHelp",
  },
  pop_garage: {
    title: "studioThemeGarage",
    description: "studioThemeGarageHelp",
  },
  pulp_podcast: {
    title: "studioThemePulp",
    description: "studioThemePulpHelp",
  },
  rooftop_hangout: {
    title: "studioThemeRooftop",
    description: "studioThemeRooftopHelp",
  },
  late_night: {
    title: "studioThemeLateNight",
    description: "studioThemeLateNightHelp",
  },
  neon_playground: {
    title: "studioThemeNeon",
    description: "studioThemeNeonHelp",
  },
};

function recommendedMaxTurns(minutes: number, pace: TalkPace): number {
  const turnsPerMinute = pace === "fast" ? 2.5 : pace === "deep" ? 1.5 : 2;
  return Math.min(MAX_RUN_TURNS, Math.max(5, Math.round(minutes * turnsPerMinute)));
}

function createAiParticipant(index: number, locale: "en" | "it"): Participant {
  return {
    kind: "ai",
    sex: index % 2 === 0 ? "female" : "male",
    name: `AI ${index + 1}`,
    role: locale === "it" ? "Partecipante AI" : "AI participant",
    perspectiveMode: "automatic",
    perspectivePrompt: "",
    goals: "",
    nonNegotiables: "",
    speakingStylePrompt: "",
    modelOverride: undefined,
    assertiveness: 50,
    patience: 50,
    interruptiveness: 20,
    baselineTension: 20,
  };
}

function createHumanParticipant(index: number): Participant {
  return {
    kind: "human",
    sex: index % 2 === 0 ? "female" : "male",
    name: "",
    role: "",
    perspectiveMode: "custom",
    perspectivePrompt: "",
    speakingStylePrompt: undefined,
    modelOverride: undefined,
    assertiveness: 50,
    patience: 50,
    interruptiveness: 20,
    baselineTension: 20,
  };
}

function createUnassignedParticipant(index: number): Participant {
  return {
    ...createHumanParticipant(index),
    kind: "unassigned",
  };
}

function createInitialTalk(locale: "en" | "it"): TalkInput {
  return {
    title: "",
    topic: "",
    description: "",
    language: locale === "it" ? "Italiano" : "English",
    participants: Array.from({ length: 5 }, (_, index) =>
      createAiParticipant(index, locale),
    ),
    moderator: {
      kind: "none",
      style: "neutral",
      canInterrupt: true,
      manageTime: true,
      summarizeAtEnd: true,
    },
    status: "draft",
    settings: {
      maxTurns: 20,
      targetDurationMinutes: 5,
      studioTheme: DEFAULT_STUDIO_THEME,
      defaultModel: DEFAULT_LLM_MODEL,
      allowInterruptions: true,
      pace: "balanced",
    },
  };
}

function editableTalk(
  talk: TalkResponse,
  duplicate: boolean,
  locale: "en" | "it",
): TalkInput {
  return {
    title: duplicate
      ? `${talk.title} — ${locale === "it" ? "copia" : "copy"}`
      : talk.title,
    topic: talk.topic,
    description: talk.description,
    language: talk.language,
    participants: talk.participants.map((participant) => ({ ...participant })),
    moderator: { ...talk.moderator },
    status: talk.status,
    settings: { ...talk.settings },
  };
}

interface ApiResponse {
  talk?: TalkResponse;
  error?: string;
  issues?: string[];
}

interface CastApiResponse {
  participants?: Participant[];
  error?: string;
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
        <output
          htmlFor={id}
          className="min-w-8 text-right text-sm font-semibold text-[#295c43]"
        >
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
    </div>
  );
}

interface ModelOptionGroupsProps {
  openAiLabel: string;
  geminiLabel: string;
}

function ModelOptionGroups({
  openAiLabel,
  geminiLabel,
}: ModelOptionGroupsProps) {
  return (
    <>
      {(["openai", "gemini"] as const).map((provider) => (
        <optgroup
          key={provider}
          label={provider === "openai" ? openAiLabel : geminiLabel}
        >
          {LLM_MODELS.filter((model) => model.provider === provider).map(
            (model) => (
              <option key={model.id} value={model.id}>
                {model.label} — {model.id}
              </option>
            ),
          )}
        </optgroup>
      ))}
    </>
  );
}

function participantIsComplete(participant: Participant): boolean {
  if (participant.kind === "unassigned") {
    return false;
  }

  return Boolean(
    participant.name.trim() &&
      participant.role.trim() &&
      (participant.kind !== "ai" ||
        participant.perspectiveMode !== "custom" ||
        participant.perspectivePrompt.trim()),
  );
}

interface TalkFormProps {
  initialTalk?: TalkResponse;
  mode?: "create" | "edit" | "duplicate";
}

export function TalkForm({ initialTalk, mode = "create" }: TalkFormProps) {
  const router = useRouter();
  const { locale, t } = useTranslations();
  const [talk, setTalk] = useState<TalkInput>(() =>
    initialTalk
      ? editableTalk(initialTalk, mode === "duplicate", locale)
      : createInitialTalk(locale),
  );
  const [activeParticipant, setActiveParticipant] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [castGenerationMode, setCastGenerationMode] =
    useState<CastGenerationMode>("manual");
  const [castGenerating, setCastGenerating] = useState<"all" | number | null>(
    null,
  );
  const [castError, setCastError] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const participant = talk.participants[activeParticipant];

  function providerLabel(provider: LlmProvider): string {
    return t(provider === "openai" ? "providerOpenAI" : "providerGemini");
  }

  function participantKindLabel(kind: ParticipantKind): string {
    if (kind === "human") return t("typeHuman");
    if (kind === "unassigned") return t("typeUnassigned");
    return t("typeAi");
  }

  function updateParticipant<K extends keyof Participant>(
    index: number,
    field: K,
    value: Participant[K],
  ) {
    setTalk((current) => ({
      ...current,
      participants: current.participants.map((item, participantIndex) =>
        participantIndex === index ? { ...item, [field]: value } : item,
      ),
    }));
  }

  function replaceParticipant(index: number, next: Participant) {
    setTalk((current) => ({
      ...current,
      participants: current.participants.map((item, participantIndex) =>
        participantIndex === index ? next : item,
      ),
    }));
  }

  function setParticipantKind(kind: ParticipantKind) {
    if (kind === "unassigned") {
      replaceParticipant(
        activeParticipant,
        createUnassignedParticipant(activeParticipant),
      );
      return;
    }

    if (kind === "human") {
      replaceParticipant(activeParticipant, {
        ...createHumanParticipant(activeParticipant),
        sex: participant.sex,
        name: participant.kind === "unassigned" ? "" : participant.name,
        role: participant.kind === "unassigned" ? "" : participant.role,
        perspectivePrompt:
          participant.kind === "unassigned" ? "" : participant.perspectivePrompt,
      });
      return;
    }

    replaceParticipant(activeParticipant, {
      ...createAiParticipant(activeParticipant, locale),
      sex: participant.sex,
      name: participant.name || `AI ${activeParticipant + 1}`,
      role:
        participant.role ||
        (locale === "it" ? "Partecipante AI" : "AI participant"),
    });
  }

  function applyCastPreset(preset: CastPreset) {
    const participants = Array.from({ length: 5 }, (_, index) => {
      if (preset === "allAi") return createAiParticipant(index, locale);
      if (preset === "allHuman") return createHumanParticipant(index);
      if (preset === "unassigned") return createUnassignedParticipant(index);
      return index < 3
        ? createAiParticipant(index, locale)
        : createHumanParticipant(index);
    });

    setTalk((current) => ({ ...current, participants }));
    setCastGenerationMode("manual");
    setCastError(null);
    setActiveParticipant(0);
  }

  async function generateCast(
    mode: Exclude<CastGenerationMode, "manual">,
    participantIndex?: number,
  ) {
    if (!talk.topic.trim()) {
      setCastError(t("castNeedsTopic"));
      return;
    }

    setCastError(null);
    setCastGenerationMode(mode);
    setCastGenerating(participantIndex ?? "all");
    try {
      const response = await fetch("/api/cast/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          participantIndex,
          title: talk.title,
          topic: talk.topic,
          description: talk.description,
          language: talk.language,
          model: talk.settings.defaultModel,
          participants: talk.participants,
        }),
      });
      const payload = (await response.json()) as CastApiResponse;
      if (!response.ok || !payload.participants) {
        setCastError(t("castGenerationError"));
        return;
      }

      if (participantIndex === undefined) {
        setTalk((current) => ({ ...current, participants: payload.participants! }));
        setActiveParticipant(0);
      } else {
        const replacement = payload.participants[0];
        if (!replacement) {
          setCastError(t("castGenerationError"));
          return;
        }
        replaceParticipant(participantIndex, {
          ...replacement,
          sex: talk.participants[participantIndex].sex,
          modelOverride: talk.participants[participantIndex].modelOverride,
        });
      }
    } catch {
      setCastError(t("networkError"));
    } finally {
      setCastGenerating(null);
    }
  }

  function setAllAiPerspectiveModes(mode: PerspectiveMode) {
    setTalk((current) => ({
      ...current,
      participants: current.participants.map((item) =>
        item.kind === "ai" ? { ...item, perspectiveMode: mode } : item,
      ),
    }));
  }

  function setModeratorKind(kind: ModeratorKind) {
    setTalk((current) => ({
      ...current,
      moderator: {
        kind,
        name:
          kind === "ai"
            ? locale === "it"
              ? "Conduttore AI"
              : "AI host"
            : kind === "human"
              ? ""
              : undefined,
        role: undefined,
        instructions: undefined,
        style: "neutral",
        modelOverride: undefined,
        canInterrupt: true,
        manageTime: true,
        summarizeAtEnd: true,
      },
    }));
  }

  const castCounts = talk.participants.reduce(
    (counts, item) => ({ ...counts, [item.kind]: counts[item.kind] + 1 }),
    { ai: 0, human: 0, unassigned: 0 },
  );

  const perspectiveModes: Array<{
    value: PerspectiveMode;
    title: string;
    description: string;
  }> = [
    {
      value: "automatic",
      title: t("modeAutomaticTitle"),
      description: t("modeAutomaticDescription"),
    },
    {
      value: "custom",
      title: t("modeCustomTitle"),
      description: t("modeCustomDescription"),
    },
    {
      value: "random",
      title: t("modeRandomTitle"),
      description: t("modeRandomDescription"),
    },
  ];

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrors([]);

    const incompleteIndex = talk.participants.findIndex(
      (item) => item.kind !== "unassigned" && !participantIsComplete(item),
    );
    if (incompleteIndex >= 0) {
      setActiveParticipant(incompleteIndex);
      setErrors([
        t("completeParticipant", { number: incompleteIndex + 1 }),
      ]);
      return;
    }

    if (talk.moderator.kind !== "none" && !talk.moderator.name?.trim()) {
      setErrors([t("completeModerator")]);
      return;
    }

    setSubmitting(true);
    try {
      const payloadTalk: TalkInput = {
        ...talk,
        status: talk.participants.some((item) => item.kind === "unassigned")
          ? "draft"
          : "ready",
      };
      const editing = mode === "edit" && initialTalk;
      const response = await fetch(
        editing ? `/api/talks/${initialTalk.id}` : "/api/talks",
        {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payloadTalk),
      },
      );
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

  const participantKinds: Array<{
    value: ParticipantKind;
    title: string;
    description: string;
  }> = [
    { value: "ai", title: t("typeAi"), description: t("typeAiHelp") },
    {
      value: "human",
      title: t("typeHuman"),
      description: t("typeHumanHelp"),
    },
    {
      value: "unassigned",
      title: t("typeUnassigned"),
      description: t("typeUnassignedHelp"),
    },
  ];

  const moderatorKinds: Array<{
    value: ModeratorKind;
    title: string;
    description: string;
  }> = [
    {
      value: "none",
      title: t("moderatorNone"),
      description: t("moderatorNoneHelp"),
    },
    {
      value: "human",
      title: t("moderatorHuman"),
      description: t("moderatorHumanHelp"),
    },
    {
      value: "ai",
      title: t("moderatorAi"),
      description: t("moderatorAiHelp"),
    },
  ];

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
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#295c43]">
            {t("step1")}
          </p>
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
              rows={2}
              value={talk.description ?? ""}
              onChange={(event) => setTalk({ ...talk, description: event.target.value })}
              className="input resize-y"
              placeholder={t("descriptionPlaceholder")}
            />
          </div>
          <p className="sm:col-span-2 text-xs leading-5 text-slate-500">
            {t("statusAutomaticHelp")}
          </p>
        </div>
      </section>

      <section>
        <div className="mb-5">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#295c43]">
            {t("step2")}
          </p>
          <div className="mt-1 flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="text-xl font-semibold">{t("participants")}</h2>
              <p className="mt-1 text-sm text-slate-600">{t("participantsDescription")}</p>
            </div>
            <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-600 ring-1 ring-[#dfe4dc]">
              {t("castSummary", {
                ai: castCounts.ai,
                human: castCounts.human,
                open: castCounts.unassigned,
              })}
            </span>
          </div>
        </div>

        <div className="card mb-4 p-4 sm:p-5">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="max-w-xl">
              <h3 className="text-sm font-semibold">{t("castCreation")}</h3>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                {t("castCreationHelp")}
              </p>
            </div>
            <div className="grid shrink-0 grid-cols-2 gap-2">
              <button
                type="button"
                disabled={castGenerating !== null}
                onClick={() => void generateCast("suggested")}
                className="button-primary px-3"
              >
                {castGenerating === "all" && castGenerationMode === "suggested"
                  ? t("castGenerating")
                  : t("castSuggested")}
              </button>
              <button
                type="button"
                disabled={castGenerating !== null}
                onClick={() => void generateCast("random")}
                className="button-secondary px-3"
              >
                {castGenerating === "all" && castGenerationMode === "random"
                  ? t("castGenerating")
                  : t("castRandom")}
              </button>
            </div>
          </div>
          <p className="mt-3 text-xs leading-5 text-[#295c43]">
            {t("castAlwaysEditable")}
          </p>
          {castError && (
            <p role="alert" className="mt-3 text-xs font-medium text-red-700">
              {castError}
            </p>
          )}

          <details className="mt-4 border-t border-slate-100 pt-4">
            <summary className="cursor-pointer text-xs font-semibold text-slate-600">
              {t("quickSetup")}
            </summary>
            <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
              {(
                [
                  ["allAi", "presetAllAi"],
                  ["hybrid", "presetHybrid"],
                  ["allHuman", "presetAllHuman"],
                  ["unassigned", "presetUnassigned"],
                ] as const
              ).map(([preset, label]) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => applyCastPreset(preset)}
                  className="rounded-lg border border-[#dfe4dc] bg-white px-3 py-2.5 text-left text-sm font-medium transition hover:border-[#8fa497] hover:bg-slate-50"
                >
                  {t(label)}
                </button>
              ))}
            </div>
          </details>
        </div>

        <div className="card overflow-hidden">
          <div
            role="tablist"
            aria-label={t("participants")}
            className="grid grid-cols-5 border-b border-[#dfe4dc] bg-slate-50"
          >
            {talk.participants.map((item, index) => {
              const selected = activeParticipant === index;
              const complete = participantIsComplete(item);
              return (
                <button
                  key={index}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => setActiveParticipant(index)}
                  className={`min-w-0 border-b-2 px-3 py-3 text-left transition ${
                    selected
                      ? "border-[#295c43] bg-white"
                      : "border-transparent hover:bg-white/70"
                  }`}
                >
                  <span className="flex items-center gap-2 text-xs font-semibold">
                    <span
                      className={`size-2 rounded-full ${
                        complete
                          ? "bg-emerald-500"
                          : item.kind === "unassigned"
                            ? "bg-slate-300"
                            : "bg-amber-400"
                      }`}
                    />
                    {t("seatNumber", { number: index + 1 })}
                  </span>
                  <span className="mt-1 block truncate text-[11px] text-slate-500">
                    {item.name || participantKindLabel(item.kind)}
                  </span>
                </button>
              );
            })}
          </div>

          <div role="tabpanel" className="p-5 sm:p-6">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#295c43]">
                  {t("seatNumber", { number: activeParticipant + 1 })}
                </p>
                <h3 className="mt-1 text-lg font-semibold">
                  {participant.name || participantKindLabel(participant.kind)}
                </h3>
              </div>
              <div className="flex items-center gap-2">
                {participant.kind === "ai" && (
                  <button
                    type="button"
                    disabled={castGenerating !== null}
                    onClick={() =>
                      void generateCast(
                        castGenerationMode === "random" ? "random" : "suggested",
                        activeParticipant,
                      )
                    }
                    className="rounded-full border border-[#b8c9bd] bg-white px-2.5 py-1 text-xs font-semibold text-[#295c43] transition hover:bg-[#edf4ef] disabled:cursor-wait disabled:opacity-60"
                  >
                    {castGenerating === activeParticipant
                      ? t("castGenerating")
                      : t("rerollGuest")}
                  </button>
                )}
                <span className="rounded-full bg-[#edf4ef] px-2.5 py-1 text-xs font-semibold text-[#295c43]">
                  {participantKindLabel(participant.kind)}
                </span>
              </div>
            </div>

            <fieldset>
              <legend className="label">{t("participantType")}</legend>
              <div className="grid gap-2 sm:grid-cols-3">
                {participantKinds.map((kind) => {
                  const selected = participant.kind === kind.value;
                  return (
                    <button
                      key={kind.value}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => setParticipantKind(kind.value)}
                      className={`rounded-xl border p-3 text-left transition ${
                        selected
                          ? "border-[#295c43] bg-[#edf4ef] ring-2 ring-[#295c43]/15"
                          : "border-[#dfe4dc] hover:bg-slate-50"
                      }`}
                    >
                      <span className="block text-sm font-semibold">{kind.title}</span>
                      <span className="mt-1 block text-xs leading-5 text-slate-500">
                        {kind.description}
                      </span>
                    </button>
                  );
                })}
              </div>
            </fieldset>

            {participant.kind === "unassigned" ? (
              <div className="mt-5 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-5 text-center">
                <h4 className="text-sm font-semibold">{t("unassignedTitle")}</h4>
                <p className="mx-auto mt-1 max-w-xl text-xs leading-5 text-slate-500">
                  {t("unassignedDescription")}
                </p>
              </div>
            ) : (
              <div className="mt-5 space-y-5">
                <div className="grid gap-5 sm:grid-cols-2">
                  <div>
                    <label htmlFor={`participant-${activeParticipant}-name`} className="label">
                      {t("name")}
                    </label>
                    <input
                      id={`participant-${activeParticipant}-name`}
                      required
                      value={participant.name}
                      onChange={(event) =>
                        updateParticipant(activeParticipant, "name", event.target.value)
                      }
                      className="input"
                      placeholder={t("participantNamePlaceholder")}
                    />
                  </div>
                  <div>
                    <label htmlFor={`participant-${activeParticipant}-role`} className="label">
                      {t("role")}
                    </label>
                    <input
                      id={`participant-${activeParticipant}-role`}
                      required
                      value={participant.role}
                      onChange={(event) =>
                        updateParticipant(activeParticipant, "role", event.target.value)
                      }
                      className="input"
                      placeholder={t("participantRolePlaceholder")}
                    />
                  </div>
                </div>

                <fieldset>
                  <legend className="label">{t("participantSex")}</legend>
                  <div className="grid max-w-md grid-cols-2 gap-2">
                    {(["female", "male"] as const).map((sex) => (
                      <button
                        key={sex}
                        type="button"
                        aria-pressed={participant.sex === sex}
                        onClick={() =>
                          updateParticipant(activeParticipant, "sex", sex)
                        }
                        className={`rounded-lg border px-3 py-2.5 text-sm font-semibold transition ${
                          participant.sex === sex
                            ? "border-[#295c43] bg-[#edf4ef] text-[#295c43]"
                            : "border-[#dfe4dc] bg-white text-slate-600 hover:bg-slate-50"
                        }`}
                      >
                        {t(sex === "female" ? "participantFemale" : "participantMale")}
                      </button>
                    ))}
                  </div>
                  <p className="mt-2 text-xs leading-5 text-slate-500">
                    {t("participantSexHelp")}
                  </p>
                </fieldset>

                {participant.kind === "human" ? (
                  <div>
                    <label htmlFor={`participant-${activeParticipant}-brief`} className="label">
                      {t("humanBrief")} <span className="font-normal text-slate-400">({t("optional")})</span>
                    </label>
                    <textarea
                      id={`participant-${activeParticipant}-brief`}
                      rows={4}
                      value={participant.perspectivePrompt}
                      onChange={(event) =>
                        updateParticipant(
                          activeParticipant,
                          "perspectivePrompt",
                          event.target.value,
                        )
                      }
                      className="input resize-y"
                      placeholder={t("humanBriefPlaceholder")}
                    />
                    <p className="mt-2 text-xs leading-5 text-slate-500">{t("humanBriefHelp")}</p>
                  </div>
                ) : (
                  <>
                    <fieldset>
                      <legend className="label">{t("perspectiveMode")}</legend>
                      <div className="grid gap-2 sm:grid-cols-3">
                        {perspectiveModes.map((mode) => (
                          <button
                            key={mode.value}
                            type="button"
                            aria-pressed={participant.perspectiveMode === mode.value}
                            onClick={() =>
                              updateParticipant(
                                activeParticipant,
                                "perspectiveMode",
                                mode.value,
                              )
                            }
                            className={`rounded-lg border px-3 py-2.5 text-left text-sm transition ${
                              participant.perspectiveMode === mode.value
                                ? "border-[#295c43] bg-[#edf4ef] font-semibold"
                                : "border-[#dfe4dc] hover:bg-slate-50"
                            }`}
                          >
                            {mode.title}
                          </button>
                        ))}
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setAllAiPerspectiveModes(participant.perspectiveMode)
                        }
                        className="mt-2 text-xs font-medium text-[#295c43] hover:underline"
                      >
                        {t("applyPerspectiveToAllAi")}
                      </button>
                    </fieldset>

                    <div>
                      <label htmlFor={`participant-${activeParticipant}-perspective`} className="label">
                        {participant.perspectiveMode === "custom"
                          ? t("perspectivePrompt")
                          : participant.perspectiveMode === "automatic"
                            ? t("automaticGuidance")
                            : t("randomConstraints")}
                        {participant.perspectiveMode !== "custom" && (
                          <span className="font-normal text-slate-400"> ({t("optional")})</span>
                        )}
                      </label>
                      <textarea
                        id={`participant-${activeParticipant}-perspective`}
                        required={participant.perspectiveMode === "custom"}
                        rows={participant.perspectiveMode === "custom" ? 5 : 3}
                        value={participant.perspectivePrompt}
                        onChange={(event) =>
                          updateParticipant(
                            activeParticipant,
                            "perspectivePrompt",
                            event.target.value,
                          )
                        }
                        className="input resize-y"
                        placeholder={
                          participant.perspectiveMode === "custom"
                            ? t("perspectivePlaceholder")
                            : participant.perspectiveMode === "automatic"
                              ? t("automaticGuidancePlaceholder")
                              : t("randomConstraintsPlaceholder")
                        }
                      />
                    </div>

                    <details className="rounded-xl border border-[#dfe4dc] bg-slate-50/60">
                      <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold marker:hidden">
                        <span className="flex items-center justify-between gap-3">
                          <span>{t("advancedAi")}</span>
                          <span className="text-xs font-normal text-slate-500">
                            {participant.modelOverride
                              ? getLlmModel(participant.modelOverride).label
                              : t("useTalkDefault", {
                                  model: getLlmModel(talk.settings.defaultModel).label,
                                })}
                          </span>
                        </span>
                      </summary>
                      <div className="space-y-5 border-t border-[#dfe4dc] p-4">
                        <div className="rounded-lg bg-white px-3 py-2 text-xs leading-5 text-slate-600 ring-1 ring-slate-200">
                          {t("identityMemoryHelp")}
                        </div>
                        <div className="grid gap-5 sm:grid-cols-2">
                          <div>
                            <label htmlFor={`participant-${activeParticipant}-goals`} className="label">
                              {t("participantGoals")} <span className="font-normal text-slate-400">({t("optional")})</span>
                            </label>
                            <textarea
                              id={`participant-${activeParticipant}-goals`}
                              rows={3}
                              value={participant.goals ?? ""}
                              onChange={(event) =>
                                updateParticipant(
                                  activeParticipant,
                                  "goals",
                                  event.target.value,
                                )
                              }
                              className="input resize-y"
                              placeholder={t("participantGoalsPlaceholder")}
                            />
                          </div>
                          <div>
                            <label htmlFor={`participant-${activeParticipant}-non-negotiables`} className="label">
                              {t("participantNonNegotiables")} <span className="font-normal text-slate-400">({t("optional")})</span>
                            </label>
                            <textarea
                              id={`participant-${activeParticipant}-non-negotiables`}
                              rows={3}
                              value={participant.nonNegotiables ?? ""}
                              onChange={(event) =>
                                updateParticipant(
                                  activeParticipant,
                                  "nonNegotiables",
                                  event.target.value,
                                )
                              }
                              className="input resize-y"
                              placeholder={t("participantNonNegotiablesPlaceholder")}
                            />
                          </div>
                        </div>
                        <div>
                          <label htmlFor={`participant-${activeParticipant}-model`} className="label">
                            {t("modelOverride")}
                          </label>
                          <select
                            id={`participant-${activeParticipant}-model`}
                            value={participant.modelOverride ?? ""}
                            onChange={(event) =>
                              updateParticipant(
                                activeParticipant,
                                "modelOverride",
                                event.target.value === ""
                                  ? undefined
                                  : (event.target.value as LlmModelId),
                              )
                            }
                            className="input"
                          >
                            <option value="">
                              {t("useTalkDefault", {
                                model: getLlmModel(talk.settings.defaultModel).label,
                              })}
                            </option>
                            <ModelOptionGroups
                              openAiLabel={providerLabel("openai")}
                              geminiLabel={providerLabel("gemini")}
                            />
                          </select>
                        </div>
                        <div>
                          <label htmlFor={`participant-${activeParticipant}-style`} className="label">
                            {t("speakingStylePrompt")} <span className="font-normal text-slate-400">({t("optional")})</span>
                          </label>
                          <textarea
                            id={`participant-${activeParticipant}-style`}
                            rows={2}
                            value={participant.speakingStylePrompt ?? ""}
                            onChange={(event) =>
                              updateParticipant(
                                activeParticipant,
                                "speakingStylePrompt",
                                event.target.value,
                              )
                            }
                            className="input resize-y"
                            placeholder={t("speakingStylePlaceholder")}
                          />
                        </div>
                        <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
                          <ScoreField
                            id={`participant-${activeParticipant}-assertiveness`}
                            label={t("assertiveness")}
                            value={participant.assertiveness}
                            onChange={(value) =>
                              updateParticipant(activeParticipant, "assertiveness", value)
                            }
                          />
                          <ScoreField
                            id={`participant-${activeParticipant}-patience`}
                            label={t("patience")}
                            value={participant.patience}
                            onChange={(value) =>
                              updateParticipant(activeParticipant, "patience", value)
                            }
                          />
                          <ScoreField
                            id={`participant-${activeParticipant}-interruptiveness`}
                            label={t("interruptiveness")}
                            value={participant.interruptiveness}
                            onChange={(value) =>
                              updateParticipant(activeParticipant, "interruptiveness", value)
                            }
                          />
                          <ScoreField
                            id={`participant-${activeParticipant}-tension`}
                            label={t("baselineTension")}
                            value={participant.baselineTension}
                            onChange={(value) =>
                              updateParticipant(activeParticipant, "baselineTension", value)
                            }
                          />
                        </div>
                      </div>
                    </details>
                  </>
                )}
              </div>
            )}

            <div className="mt-6 flex items-center justify-between border-t border-slate-100 pt-4">
              <button
                type="button"
                disabled={activeParticipant === 0}
                onClick={() => setActiveParticipant((current) => current - 1)}
                className="button-secondary disabled:cursor-not-allowed disabled:opacity-40"
              >
                ← {t("previousParticipant")}
              </button>
              <button
                type="button"
                disabled={activeParticipant === 4}
                onClick={() => setActiveParticipant((current) => current + 1)}
                className="button-secondary disabled:cursor-not-allowed disabled:opacity-40"
              >
                {t("nextParticipant")} →
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="card p-5 sm:p-6">
        <div className="mb-5">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#295c43]">
            {t("step3")}
          </p>
          <h2 className="mt-1 text-xl font-semibold">{t("moderation")}</h2>
          <p className="mt-1 text-sm text-slate-600">{t("moderationIntro")}</p>
        </div>

        <div className="grid gap-2 sm:grid-cols-3">
          {moderatorKinds.map((kind) => {
            const selected = talk.moderator.kind === kind.value;
            return (
              <button
                key={kind.value}
                type="button"
                aria-pressed={selected}
                onClick={() => setModeratorKind(kind.value)}
                className={`rounded-xl border p-3 text-left transition ${
                  selected
                    ? "border-[#295c43] bg-[#edf4ef] ring-2 ring-[#295c43]/15"
                    : "border-[#dfe4dc] hover:bg-slate-50"
                }`}
              >
                <span className="block text-sm font-semibold">{kind.title}</span>
                <span className="mt-1 block text-xs leading-5 text-slate-500">
                  {kind.description}
                </span>
              </button>
            );
          })}
        </div>

        {talk.moderator.kind !== "none" && (
          <div className="mt-6 space-y-5 border-t border-slate-100 pt-6">
            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <label htmlFor="moderator-name" className="label">{t("moderatorName")}</label>
                <input
                  id="moderator-name"
                  required
                  value={talk.moderator.name ?? ""}
                  onChange={(event) =>
                    setTalk({
                      ...talk,
                      moderator: { ...talk.moderator, name: event.target.value },
                    })
                  }
                  className="input"
                  placeholder={t("moderatorNamePlaceholder")}
                />
              </div>
              <div>
                <label htmlFor="moderator-role" className="label">
                  {t("moderatorRole")} <span className="font-normal text-slate-400">({t("optional")})</span>
                </label>
                <input
                  id="moderator-role"
                  value={talk.moderator.role ?? ""}
                  onChange={(event) =>
                    setTalk({
                      ...talk,
                      moderator: { ...talk.moderator, role: event.target.value },
                    })
                  }
                  className="input"
                  placeholder={t("moderatorRolePlaceholder")}
                />
              </div>
              {talk.moderator.kind === "ai" && (
                <div>
                  <label htmlFor="moderator-model" className="label">{t("moderatorModel")}</label>
                  <select
                    id="moderator-model"
                    value={talk.moderator.modelOverride ?? ""}
                    onChange={(event) =>
                      setTalk({
                        ...talk,
                        moderator: {
                          ...talk.moderator,
                          modelOverride:
                            event.target.value === ""
                              ? undefined
                              : (event.target.value as LlmModelId),
                        },
                      })
                    }
                    className="input"
                  >
                    <option value="">
                      {t("useTalkDefault", {
                        model: getLlmModel(talk.settings.defaultModel).label,
                      })}
                    </option>
                    <ModelOptionGroups
                      openAiLabel={providerLabel("openai")}
                      geminiLabel={providerLabel("gemini")}
                    />
                  </select>
                </div>
              )}
              <div className="sm:col-span-2">
                <label htmlFor="moderator-instructions" className="label">
                  {t("moderatorInstructions")} <span className="font-normal text-slate-400">({t("optional")})</span>
                </label>
                <textarea
                  id="moderator-instructions"
                  rows={3}
                  value={talk.moderator.instructions ?? ""}
                  onChange={(event) =>
                    setTalk({
                      ...talk,
                      moderator: {
                        ...talk.moderator,
                        instructions: event.target.value,
                      },
                    })
                  }
                  className="input resize-y"
                  placeholder={t("moderatorInstructionsPlaceholder")}
                />
              </div>
            </div>

            <fieldset>
              <legend className="label">{t("moderatorStyle")}</legend>
              <p className="mb-3 text-xs leading-5 text-slate-500">
                {t("moderatorStyleHelp")}
              </p>
              <div className="grid gap-3 md:grid-cols-3">
                {(
                  [
                    ["neutral", "styleNeutral", "styleNeutralHelp"],
                    ["challenging", "styleChallenging", "styleChallengingHelp"],
                    ["facilitating", "styleFacilitating", "styleFacilitatingHelp"],
                  ] as const
                ).map(([value, label, help]) => {
                  const selected = talk.moderator.style === value;
                  return (
                    <label
                      key={value}
                      className={`cursor-pointer rounded-xl border p-4 transition ${
                        selected
                          ? "border-[#295c43] bg-[#edf4ef] ring-2 ring-[#295c43]/15"
                          : "border-[#dfe4dc] bg-white hover:bg-slate-50"
                      }`}
                    >
                      <input
                        type="radio"
                        name="moderatorStyle"
                        value={value}
                        checked={selected}
                        onChange={() =>
                          setTalk({
                            ...talk,
                            moderator: { ...talk.moderator, style: value },
                          })
                        }
                        className="sr-only"
                      />
                      <span className="block text-sm font-semibold">{t(label)}</span>
                      <span className="mt-1 block text-xs leading-5 text-slate-500">
                        {t(help)}
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>

            <div className="grid gap-3 sm:grid-cols-3">
              {(
                [
                  ["canInterrupt", "moderatorCanInterrupt"],
                  ["manageTime", "moderatorManageTime"],
                  ["summarizeAtEnd", "moderatorSummarize"],
                ] as const
              ).map(([field, label]) => (
                <label
                  key={field}
                  className="flex cursor-pointer items-center gap-3 rounded-lg border border-[#dfe4dc] p-3"
                >
                  <input
                    type="checkbox"
                    checked={talk.moderator[field]}
                    onChange={(event) =>
                      setTalk({
                        ...talk,
                        moderator: {
                          ...talk.moderator,
                          [field]: event.target.checked,
                        },
                      })
                    }
                    className="size-4 accent-[#295c43]"
                  />
                  <span className="text-sm font-medium">{t(label)}</span>
                </label>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="card p-5 sm:p-6">
        <div className="mb-5">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#295c43]">
            {t("step4")}
          </p>
          <h2 className="mt-1 text-xl font-semibold">{t("talkSettings")}</h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            {t("talkSettingsIntro")}
          </p>
        </div>
        <div className="space-y-6">
          <fieldset id="studio-theme">
            <legend className="label">{t("studioTheme")}</legend>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
              {STUDIO_THEMES.map((theme) => {
                const copy = STUDIO_THEME_COPY[theme.id];
                const selected = talk.settings.studioTheme === theme.id;
                return (
                  <label
                    key={theme.id}
                    className={`group cursor-pointer overflow-hidden rounded-xl border bg-white transition ${
                      selected
                        ? "border-[#295c43] ring-2 ring-[#295c43]/20"
                        : "border-[#dfe4dc] hover:border-[#a9b9ae]"
                    }`}
                  >
                    <input
                      type="radio"
                      name="studioTheme"
                      value={theme.id}
                      checked={selected}
                      onChange={() =>
                        setTalk({
                          ...talk,
                          settings: { ...talk.settings, studioTheme: theme.id },
                        })
                      }
                      className="sr-only"
                    />
                    <span className="relative block aspect-[4/3] overflow-hidden bg-slate-950">
                      <Image
                        src={theme.image}
                        alt=""
                        fill
                        sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                        className="object-cover transition duration-300 group-hover:scale-[1.02]"
                      />
                      {selected && (
                        <span className="absolute right-2 top-2 flex size-7 items-center justify-center rounded-full bg-[#295c43] text-sm font-bold text-white shadow-lg">
                          ✓
                        </span>
                      )}
                    </span>
                    <span className="block p-2.5">
                      <span className="block truncate text-xs font-semibold sm:text-sm">
                        {t(copy.title)}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
            <p className="mt-2 text-xs leading-5 text-slate-500">
              {t(STUDIO_THEME_COPY[talk.settings.studioTheme].description)}
            </p>
          </fieldset>

          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <label htmlFor="targetDuration" className="label">
                {t("targetDuration")}
              </label>
              <select
                id="targetDuration"
                required
                value={talk.settings.targetDurationMinutes}
                onChange={(event) =>
                  setTalk({
                    ...talk,
                    settings: {
                      ...talk.settings,
                      targetDurationMinutes: Number(event.target.value),
                      maxTurns: recommendedMaxTurns(
                        Number(event.target.value),
                        talk.settings.pace,
                      ),
                    },
                  })
                }
                className="input"
              >
                {!DURATION_OPTIONS.includes(
                  talk.settings.targetDurationMinutes as (typeof DURATION_OPTIONS)[number],
                ) && (
                  <option value={talk.settings.targetDurationMinutes}>
                    {talk.settings.targetDurationMinutes} {t("minutes")}
                  </option>
                )}
                {DURATION_OPTIONS.map((minutes) => (
                  <option key={minutes} value={minutes}>
                    {minutes} {t("minutes")}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="talkPace" className="label">
                {t("talkPace")}
              </label>
              <select
                id="talkPace"
                value={talk.settings.pace}
                onChange={(event) => {
                  const pace = event.target.value as TalkPace;
                  setTalk({
                    ...talk,
                    settings: {
                      ...talk.settings,
                      pace,
                      maxTurns: recommendedMaxTurns(
                        talk.settings.targetDurationMinutes,
                        pace,
                      ),
                    },
                  });
                }}
                className="input"
              >
                <option value="fast">{t("paceFast")}</option>
                <option value="balanced">{t("paceBalanced")}</option>
                <option value="deep">{t("paceDeep")}</option>
              </select>
            </div>
            <div>
              <label htmlFor="defaultModel" className="label">
                {t("defaultModel")}
              </label>
              <select
                id="defaultModel"
                value={talk.settings.defaultModel}
                onChange={(event) =>
                  setTalk({
                    ...talk,
                    settings: {
                      ...talk.settings,
                      defaultModel: event.target.value as LlmModelId,
                    },
                  })
                }
                className="input"
              >
                <ModelOptionGroups
                  openAiLabel={providerLabel("openai")}
                  geminiLabel={providerLabel("gemini")}
                />
              </select>
            </div>
          </div>
          <p className="-mt-3 text-xs leading-5 text-slate-500">
            {t("formatDefaultsHelp")}
          </p>

          <details className="rounded-xl border border-[#dfe4dc] bg-slate-50 p-4">
            <summary className="cursor-pointer text-sm font-semibold text-slate-700">
              {t("advancedRuntime")}
            </summary>
            <div className="mt-4 grid gap-5 md:grid-cols-[minmax(0,1fr)_16rem]">
              <fieldset>
                <legend className="label">{t("turnDynamics")}</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {(
                    [
                      [false, "orderedTurns", "orderedTurnsHelp"],
                      [true, "openExchange", "openExchangeHelp"],
                    ] as const
                  ).map(([value, label, help]) => {
                    const selected = talk.settings.allowInterruptions === value;
                    return (
                      <label
                        key={String(value)}
                        className={`cursor-pointer rounded-xl border p-4 transition ${
                          selected
                            ? "border-[#295c43] bg-[#edf4ef] ring-2 ring-[#295c43]/15"
                            : "border-[#dfe4dc] bg-white hover:bg-slate-50"
                        }`}
                      >
                        <input
                          type="radio"
                          name="turnDynamics"
                          checked={selected}
                          onChange={() =>
                            setTalk({
                              ...talk,
                              settings: {
                                ...talk.settings,
                                allowInterruptions: value,
                              },
                            })
                          }
                          className="sr-only"
                        />
                        <span className="block text-sm font-semibold">{t(label)}</span>
                        <span className="mt-1 block text-xs leading-5 text-slate-500">
                          {t(help)}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
              <div>
                <label htmlFor="maxTurns" className="label">
                  {t("maximumTurns")}
                </label>
                <input
                  id="maxTurns"
                  type="number"
                  min="1"
                  max={MAX_RUN_TURNS}
                  required
                  value={talk.settings.maxTurns}
                  onChange={(event) =>
                    setTalk({
                      ...talk,
                      settings: {
                        ...talk.settings,
                        maxTurns: Number(event.target.value),
                      },
                    })
                  }
                  className="input"
                />
                <p className="mt-2 text-xs leading-5 text-slate-500">
                  {t("maximumTurnsHelp")}
                </p>
              </div>
            </div>
          </details>
        </div>
      </section>

      <div className="sticky bottom-0 z-10 -mx-4 flex gap-3 border-t border-[#dfe4dc] bg-[#f6f7f2]/95 px-4 py-4 backdrop-blur sm:static sm:mx-0 sm:justify-end sm:bg-transparent sm:px-0 sm:pt-6">
        <button
          type="button"
          onClick={() => router.push("/talks")}
          disabled={submitting}
          className="button-secondary flex-1 sm:flex-none"
        >
          {t("cancel")}
        </button>
        <button type="submit" disabled={submitting} className="button-primary min-w-32 flex-1 sm:flex-none">
          {submitting ? t("saving") : t("saveTalk")}
        </button>
      </div>
    </form>
  );
}
