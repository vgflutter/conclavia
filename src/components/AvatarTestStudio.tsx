"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  BusinessAvatar,
  type AvatarGesture,
  type AvatarMood,
} from "@/components/BusinessAvatar";
import type { Locale } from "@/i18n/locale";
import type { AvatarViseme } from "@/lib/avatar-visemes";
import {
  avatarVisemeAt,
  avatarVoiceLevelAt,
  buildAvatarLipSync,
} from "@/lib/avatar-lipsync";
import {
  generateLocalSpeech,
  type LocalSpeechResult,
  type LocalVoiceProgress,
} from "@/lib/local-tts";
import type { AssistantProfileResponse } from "@/types/assistant-profile";

type PreviewState = "ready" | "loading" | "generating" | "prepared" | "speaking" | "error";
type SpeechLanguage = "it" | "en";

const samples = {
  it: [
    "Buongiorno, sono {name}. Terrò il filo del meeting e dei prossimi passi.",
    "Prima di proseguire, vorrei verificare un punto importante della scaletta.",
  ],
  en: [
    "Good morning, I am {name}. I will keep track of the meeting and next steps.",
    "Before we continue, I would like to verify an important point on the agenda.",
  ],
} satisfies Record<SpeechLanguage, string[]>;

const moodOptions: Array<{ value: AvatarMood; it: string; en: string }> = [
  { value: "neutral", it: "Neutro", en: "Neutral" },
  { value: "friendly", it: "Cordiale", en: "Friendly" },
  { value: "focused", it: "Concentrato", en: "Focused" },
  { value: "confident", it: "Deciso", en: "Confident" },
];

export function AvatarTestStudio({
  profile,
  locale,
}: {
  profile: AssistantProfileResponse;
  locale: Locale;
}) {
  const isItalian = locale === "it";
  const [language, setLanguage] = useState<SpeechLanguage>(locale);
  const sampleText = (item: string) => item.replace("{name}", profile.displayName);
  const [text, setText] = useState(sampleText(samples[locale][0]));
  const [viseme, setViseme] = useState<AvatarViseme>("rest");
  const [voiceLevel, setVoiceLevel] = useState(0);
  const [mood, setMood] = useState<AvatarMood>("friendly");
  const [gesture, setGesture] = useState<AvatarGesture>("rest");
  const [previewState, setPreviewState] = useState<PreviewState>("ready");
  const [progress, setProgress] = useState<LocalVoiceProgress>();
  const [speech, setSpeech] = useState<LocalSpeechResult>();
  const [speechKey, setSpeechKey] = useState("");
  const audioRef = useRef<HTMLAudioElement | undefined>(undefined);
  const audioUrlRef = useRef<string | undefined>(undefined);
  const animationRef = useRef<number | undefined>(undefined);
  const runRef = useRef(0);
  const frames = useMemo(() => buildAvatarLipSync(text), [text]);
  const currentSpeechKey = `${language}:${profile.voice.style}:${profile.voice.speakingRate}:${text.trim()}`;
  const speechIsCurrent = Boolean(speech && speechKey === currentSpeechKey);
  const isBusy = previewState === "loading" || previewState === "generating";

  function cleanPlayback() {
    if (animationRef.current) window.cancelAnimationFrame(animationRef.current);
    audioRef.current?.pause();
    audioRef.current = undefined;
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    audioUrlRef.current = undefined;
    setViseme("rest");
    setVoiceLevel(0);
  }

  function stopPreview() {
    runRef.current += 1;
    cleanPlayback();
    setProgress(undefined);
    setPreviewState("ready");
  }

  async function playSpeech(result: LocalSpeechResult, run: number) {
    cleanPlayback();
    const url = URL.createObjectURL(result.audio);
    const audio = new Audio(url);
    audio.preload = "auto";
    audioRef.current = audio;
    audioUrlRef.current = url;

    const animate = () => {
      if (run !== runRef.current || audio.paused || audio.ended) return;
      const duration = Number.isFinite(audio.duration) && audio.duration > 0
        ? audio.duration
        : result.durationSeconds;
      const playbackProgress = duration > 0 ? audio.currentTime / duration : 0;
      setViseme(avatarVisemeAt(frames, playbackProgress));
      setVoiceLevel(avatarVoiceLevelAt(result.samples, playbackProgress));
      animationRef.current = window.requestAnimationFrame(animate);
    };

    audio.onended = () => {
      if (run !== runRef.current) return;
      cleanPlayback();
      setPreviewState("ready");
    };

    try {
      await audio.play();
      if (run !== runRef.current) return;
      setPreviewState("speaking");
      animationRef.current = window.requestAnimationFrame(animate);
    } catch {
      cleanPlayback();
      setPreviewState("prepared");
    }
  }

  async function startPreview() {
    if (!text.trim()) return;
    cleanPlayback();
    const run = runRef.current + 1;
    runRef.current = run;

    if (speechIsCurrent && speech) {
      await playSpeech(speech, run);
      return;
    }

    setProgress({ phase: "loading", current: 0, total: 4 });
    setPreviewState("loading");
    try {
      const result = await generateLocalSpeech({
        text,
        language,
        voiceStyle: profile.voice.style,
        speakingRate: profile.voice.speakingRate,
        onProgress: (nextProgress) => {
          if (run !== runRef.current) return;
          setProgress(nextProgress);
          setPreviewState(nextProgress.phase);
        },
      });
      if (run !== runRef.current) return;
      setSpeech(result);
      setSpeechKey(currentSpeechKey);
      setProgress(undefined);
      setPreviewState("prepared");
      await playSpeech(result, run);
    } catch {
      if (run !== runRef.current) return;
      cleanPlayback();
      setProgress(undefined);
      setPreviewState("error");
    }
  }

  function changeLanguage(nextLanguage: SpeechLanguage) {
    stopPreview();
    setLanguage(nextLanguage);
    setText(sampleText(samples[nextLanguage][0]));
    setSpeech(undefined);
    setSpeechKey("");
  }

  useEffect(() => () => {
    runRef.current += 1;
    if (animationRef.current) window.cancelAnimationFrame(animationRef.current);
    audioRef.current?.pause();
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
  }, []);

  const statusLabel = previewState === "speaking"
    ? isItalian ? "IN VOCE" : "SPEAKING"
    : isBusy
      ? isItalian ? "PREPARAZIONE" : "PREPARING"
      : isItalian ? "PRONTO" : "READY";

  const buttonLabel = previewState === "speaking"
    ? isItalian ? "Ferma la voce" : "Stop voice"
    : speechIsCurrent
      ? isItalian ? "Riproduci di nuovo" : "Play again"
      : isItalian ? "Ascolta la voce" : "Listen to voice";

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.55fr)_minmax(18rem,0.72fr)] lg:items-start">
      <section
        className="relative aspect-video min-h-[20rem] overflow-hidden rounded-[2rem] bg-[#07100c] shadow-[0_28px_80px_rgba(18,42,29,0.2)]"
        data-preview-state={previewState}
      >
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_38%,rgba(67,161,113,0.28),transparent_34%),radial-gradient(circle_at_12%_46%,rgba(209,105,54,0.15),transparent_25%),linear-gradient(145deg,#111c17,#050806_65%,#0c1711)]" />
        <div className="absolute inset-0 opacity-25 [background-image:linear-gradient(rgba(255,255,255,.05)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.05)_1px,transparent_1px)] [background-size:4rem_4rem]" />
        <div className="absolute inset-x-0 top-0 z-10 flex min-h-14 items-center justify-between border-b border-white/10 bg-black/20 px-5 text-[10px] font-bold uppercase tracking-[0.17em] text-white/45 sm:px-7 sm:text-xs">
          <span>{profile.displayName} · {isItalian ? "Collega digitale" : "Digital colleague"}</span>
          <span className={previewState === "speaking" ? "text-[#ffc6ac]" : "text-[#d4e8cb]"}>
            <i className={`mr-2 inline-block size-2 rounded-full ${previewState === "speaking" ? "bg-[#f17747] shadow-[0_0_18px_#f17747]" : isBusy ? "animate-pulse bg-[#e5b757]" : "bg-[#8c9890]"}`} />
            <span aria-live="polite">{statusLabel}</span>
          </span>
        </div>
        <div className="absolute inset-x-[22%] bottom-[-10%] top-[9%] sm:inset-x-[25%]">
          <BusinessAvatar
            viseme={viseme}
            mood={mood}
            gesture={gesture}
            voiceLevel={voiceLevel}
            ariaLabel={
              isItalian
                ? "Avatar del collega digitale in abito business"
                : "Business-style digital colleague avatar"
            }
          />
        </div>
        <div className="absolute bottom-5 left-5 z-10 border-l-4 border-[#bde88d] bg-black/70 px-4 py-3 backdrop-blur sm:bottom-7 sm:left-7">
          <strong className="block text-xs uppercase tracking-[0.16em] text-[#bde88d] sm:text-sm">
            {profile.displayName}
          </strong>
          <span className="mt-1 block text-xs text-white/75 sm:text-sm">{profile.role}</span>
        </div>
      </section>

      <section className="card p-5 sm:p-7">
        <p className="text-xs font-semibold uppercase tracking-[0.15em] text-[#295c43]">
          {isItalian ? "Prova avatar" : "Avatar test"}
        </p>
        <h2 className="mt-2 text-xl font-semibold">
          {isItalian ? "Voce, espressione e gesti" : "Voice, expression and gestures"}
        </h2>
        <p className="mt-3 text-sm leading-6 text-slate-500">
          {isItalian
            ? "Ascolta come parla e scegli come deve presentarsi durante un intervento."
            : "Listen to how it speaks and choose how it should appear while contributing."}
        </p>

        <div className="mt-6">
          <span className="label">{isItalian ? "Lingua della frase" : "Phrase language"}</span>
          <div className="mt-2 grid grid-cols-2 gap-2" role="group" aria-label={isItalian ? "Lingua della voce" : "Voice language"}>
            {(["it", "en"] as const).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => changeLanguage(item)}
                aria-pressed={language === item}
                className={`rounded-xl border px-3 py-2 text-xs font-semibold transition ${language === item ? "border-[#6e9a7d] bg-[#e9f2ec] text-[#204d36]" : "border-slate-200 text-slate-500 hover:bg-slate-50"}`}
              >
                {item === "it" ? "Italiano" : "English"}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 space-y-2">
          {samples[language].map((sampleTemplate, index) => {
            const sample = sampleText(sampleTemplate);
            return (
            <button
              key={sample}
              type="button"
              onClick={() => {
                stopPreview();
                setText(sample);
              }}
              className={`w-full rounded-xl border p-3 text-left text-xs leading-5 transition ${text === sample ? "border-[#9fbea9] bg-[#eef5f0] text-[#204d36]" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}
            >
              <strong className="mr-2">{index + 1}</strong>
              {sample}
            </button>
            );
          })}
        </div>

        <label className="label mt-5" htmlFor="avatar-test-text">
          {isItalian ? "Frase da provare" : "Phrase to test"}
        </label>
        <textarea
          id="avatar-test-text"
          value={text}
          onChange={(event) => {
            stopPreview();
            setText(event.target.value);
          }}
          maxLength={300}
          className="input min-h-24 resize-y"
        />

        <div className="mt-5">
          <span className="label">{isItalian ? "Espressione" : "Expression"}</span>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {moodOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                data-testid={`mood-${option.value}`}
                onClick={() => setMood(option.value)}
                aria-pressed={mood === option.value}
                className={`rounded-xl border px-3 py-2 text-xs font-semibold transition ${mood === option.value ? "border-[#6e9a7d] bg-[#e9f2ec] text-[#204d36]" : "border-slate-200 text-slate-500 hover:bg-slate-50"}`}
              >
                {isItalian ? option.it : option.en}
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          data-testid="hand-raise-toggle"
          onClick={() => setGesture((current) => current === "hand_raise" ? "rest" : "hand_raise")}
          aria-pressed={gesture === "hand_raise"}
          className="mt-3 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
        >
          {gesture === "hand_raise"
            ? isItalian ? "Abbassa la mano" : "Lower hand"
            : isItalian ? "Alza la mano" : "Raise hand"}
        </button>

        <button
          type="button"
          onClick={previewState === "speaking" ? stopPreview : startPreview}
          disabled={!text.trim() || isBusy}
          className="button-primary mt-4 w-full"
        >
          {isBusy && progress
            ? progress.phase === "loading"
              ? isItalian ? `Preparo la voce ${progress.current}/${progress.total}…` : `Preparing voice ${progress.current}/${progress.total}…`
              : isItalian ? `Creo l’audio ${progress.current}/${progress.total}…` : `Creating audio ${progress.current}/${progress.total}…`
            : buttonLabel}
        </button>

        {(previewState === "error" || previewState === "prepared") && (
          <div className="mt-4 rounded-xl bg-[#f3f7f4] p-4 text-xs leading-5 text-slate-600" aria-live="polite">
            {previewState === "error"
              ? isItalian
                ? "La voce non è disponibile in questo momento. Controlla la connessione e riprova."
                : "Voice is unavailable right now. Check your connection and try again."
              : isItalian
                ? "La voce è pronta. Premi di nuovo per ascoltarla."
                : "The voice is ready. Press again to listen."}
          </div>
        )}
      </section>
    </div>
  );
}
