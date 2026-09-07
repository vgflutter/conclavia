"use client";

import { type CSSProperties, useEffect, useRef, useState } from "react";

import {
  BusinessAvatar,
  type AvatarGesture,
  type AvatarMood,
} from "@/components/BusinessAvatar";
import type { Locale } from "@/i18n/locale";
import {
  avatarVisemeAt,
  avatarVoiceLevelAt,
  buildAvatarLipSync,
} from "@/lib/avatar-lipsync";
import type { AvatarViseme } from "@/lib/avatar-visemes";
import { generateLocalSpeech, prepareLocalVoice } from "@/lib/local-tts";
import {
  parseRecallOutputTranscript,
  type RecallOutputTranscript,
} from "@/lib/recall-transcript";
import type { AssistantVoiceStyle } from "@/types/assistant-profile";
import type {
  MeetingBotProvider,
  MeetingCommandKind,
  MeetingStatus,
} from "@/types/meeting";

import styles from "./MeetingOutputSurface.module.css";

type SpokenCommand = {
  id: string;
  kind: MeetingCommandKind;
  response: string;
};

function performanceFor(kind: MeetingCommandKind): {
  mood: AvatarMood;
  gesture: AvatarGesture;
} {
  if (kind === "correct") return { mood: "focused", gesture: "rest" };
  if (kind === "inform") return { mood: "confident", gesture: "rest" };
  if (kind === "summary") return { mood: "confident", gesture: "rest" };
  return { mood: "friendly", gesture: "rest" };
}

export function MeetingOutputSurface({
  outputToken,
  title,
  initialStatus,
  initialCommandId,
  initialInterventionId,
  displayName,
  role,
  locale,
  speechLanguage,
  voiceStyle,
  speakingRate,
  inMeeting,
  meetingProvider,
}: {
  outputToken: string;
  title: string;
  initialStatus: MeetingStatus;
  initialCommandId?: string;
  initialInterventionId?: string;
  displayName: string;
  role: string;
  locale: Locale;
  speechLanguage: "it" | "en";
  voiceStyle: AssistantVoiceStyle;
  speakingRate: number;
  inMeeting: boolean;
  meetingProvider: MeetingBotProvider;
}) {
  const [status, setStatus] = useState(initialStatus);
  const [viseme, setViseme] = useState<AvatarViseme>("rest");
  const [voiceLevel, setVoiceLevel] = useState(0);
  const [mood, setMood] = useState<AvatarMood>("friendly");
  const [gesture, setGesture] = useState<AvatarGesture>(
    initialInterventionId ? "hand_raise" : "rest",
  );
  const [speaking, setSpeaking] = useState(false);
  const pendingInterventionRef = useRef(initialInterventionId);
  const lastSpokenCommandRef = useRef(initialCommandId);
  const isPresent = ["joining", "waiting_room", "live"].includes(status);
  const isItalian = locale === "it";

  useEffect(() => {
    let active = true;
    let speechRun = 0;
    let audio: HTMLAudioElement | undefined;
    let audioUrl: string | undefined;
    let animation: number | undefined;
    let polling = false;
    let transcriptSocket: WebSocket | undefined;
    let reconnectTimer: number | undefined;
    let utteranceTimer: number | undefined;
    let bufferedTranscript: RecallOutputTranscript | undefined;
    let meetingAudioStream: MediaStream | undefined;

    function resetPerformance() {
      if (animation) window.cancelAnimationFrame(animation);
      audio?.pause();
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      animation = undefined;
      audio = undefined;
      audioUrl = undefined;
      if (!active) return;
      setViseme("rest");
      setVoiceLevel(0);
      setMood("friendly");
      setGesture("rest");
      setSpeaking(false);
    }

    async function speak(command: SpokenCommand) {
      speechRun += 1;
      const run = speechRun;
      resetPerformance();
      const performance = performanceFor(command.kind);
      setMood(performance.mood);
      setGesture(performance.gesture);

      try {
        const result = await generateLocalSpeech({
          text: command.response,
          language: speechLanguage,
          voiceStyle,
          speakingRate,
        });
        if (!active || run !== speechRun) return;

        const frames = buildAvatarLipSync(command.response);
        audioUrl = URL.createObjectURL(result.audio);
        audio = new Audio(audioUrl);
        audio.preload = "auto";
        audio.onended = () => {
          resetPerformance();
        };
        await audio.play();
        if (!active || run !== speechRun) return;
        setSpeaking(true);

        const animate = () => {
          if (!active || run !== speechRun || !audio || audio.paused || audio.ended) return;
          const duration = Number.isFinite(audio.duration) && audio.duration > 0
            ? audio.duration
            : result.durationSeconds;
          const progress = duration > 0 ? audio.currentTime / duration : 0;
          setViseme(avatarVisemeAt(frames, progress));
          setVoiceLevel(avatarVoiceLevelAt(result.samples, progress));
          animation = window.requestAnimationFrame(animate);
        };
        animation = window.requestAnimationFrame(animate);
      } catch {
        if (active && run === speechRun) resetPerformance();
      }
    }

    async function pollMeeting() {
      if (polling) return;
      polling = true;
      try {
        const response = await fetch(
          `/api/meeting-room/${encodeURIComponent(outputToken)}/state`,
          { cache: "no-store" },
        );
        const payload = (await response.json()) as {
          status?: MeetingStatus;
          command?: SpokenCommand;
          pendingIntervention?: { id: string };
        };
        if (!active || !response.ok || !payload.status) return;
        setStatus(payload.status);
        const nextInterventionId = payload.pendingIntervention?.id;
        if (nextInterventionId !== pendingInterventionRef.current) {
          pendingInterventionRef.current = nextInterventionId;
          if (nextInterventionId) {
            setMood("focused");
            setGesture("hand_raise");
          } else {
            setMood("friendly");
            setGesture("rest");
          }
        }
        const latest = payload.command;
        if (latest && latest.id !== lastSpokenCommandRef.current) {
          lastSpokenCommandRef.current = latest.id;
          void speak(latest);
        }
      } catch {
        // Keep the last known state while the connection recovers.
      } finally {
        polling = false;
      }
    }

    async function flushTranscript() {
      if (utteranceTimer) window.clearTimeout(utteranceTimer);
      utteranceTimer = undefined;
      const transcript = bufferedTranscript;
      bufferedTranscript = undefined;
      if (!active || !transcript) return;

      try {
        const response = await fetch(
          `/api/meeting-room/${encodeURIComponent(outputToken)}/transcript`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(transcript),
          },
        );
        const payload = (await response.json()) as { command?: SpokenCommand };
        if (!active || !response.ok || !payload.command) return;
        if (payload.command.id !== lastSpokenCommandRef.current) {
          lastSpokenCommandRef.current = payload.command.id;
          void speak(payload.command);
        }
      } catch {
        // The next finalized utterance will retry through the active meeting connection.
      }
    }

    function queueTranscript(next: RecallOutputTranscript) {
      if (
        bufferedTranscript &&
        bufferedTranscript.speakerName.toLocaleLowerCase() ===
          next.speakerName.toLocaleLowerCase()
      ) {
        bufferedTranscript = {
          ...bufferedTranscript,
          text: `${bufferedTranscript.text} ${next.text}`.trim().slice(-10_000),
          language: next.language || bufferedTranscript.language,
          endMs: next.endMs || bufferedTranscript.endMs,
        };
      } else {
        void flushTranscript();
        bufferedTranscript = next;
      }
      if (utteranceTimer) window.clearTimeout(utteranceTimer);
      utteranceTimer = window.setTimeout(() => void flushTranscript(), 1_100);
    }

    function connectTranscript() {
      if (!active || !inMeeting) return;
      transcriptSocket = new WebSocket(
        "wss://meeting-data.bot.recall.ai/api/v1/transcript",
      );
      transcriptSocket.onmessage = (event) => {
        try {
          const transcript = parseRecallOutputTranscript(JSON.parse(String(event.data)));
          if (transcript) queueTranscript(transcript);
        } catch {
          // Ignore malformed frames and keep the live connection open.
        }
      };
      transcriptSocket.onclose = () => {
        if (!active) return;
        reconnectTimer = window.setTimeout(connectTranscript, 2_000);
      };
    }

    if (inMeeting) {
      void prepareLocalVoice(voiceStyle).catch(() => undefined);
      if (meetingProvider === "recall") connectTranscript();
      if (meetingProvider === "attendee" && navigator.mediaDevices?.getUserMedia) {
        void navigator.mediaDevices
          .getUserMedia({ audio: true, video: false })
          .then((stream) => {
            if (!active) {
              stream.getTracks().forEach((track) => track.stop());
              return;
            }
            meetingAudioStream = stream;
          })
          .catch(() => undefined);
      }
    }
    void pollMeeting();
    const timer = window.setInterval(pollMeeting, 650);

    return () => {
      active = false;
      speechRun += 1;
      window.clearInterval(timer);
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      if (utteranceTimer) window.clearTimeout(utteranceTimer);
      transcriptSocket?.close();
      meetingAudioStream?.getTracks().forEach((track) => track.stop());
      if (animation) window.cancelAnimationFrame(animation);
      audio?.pause();
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [inMeeting, meetingProvider, outputToken, speakingRate, speechLanguage, voiceStyle]);

  const stageStyle = {
    "--voice-level": voiceLevel,
  } as CSSProperties;

  const statusLabel = speaking
    ? isItalian
      ? "STA PARLANDO"
      : "SPEAKING"
    : gesture === "hand_raise"
      ? isItalian
        ? "CHIEDE LA PAROLA"
        : "REQUESTING TO SPEAK"
    : status === "waiting_room"
      ? isItalian
        ? "IN ATTESA"
        : "WAITING"
      : status === "live"
        ? isItalian
          ? "IN RIUNIONE"
          : "IN MEETING"
        : isItalian
          ? "PRONTO"
          : "READY";

  return (
    <div className={styles.output} style={stageStyle} data-live={isPresent} data-speaking={speaking}>
      <div className={styles.grid} />
      <div className={styles.glow} />
      <header className={styles.topbar}>
        <span>CONCLAVIA · {isItalian ? "COLLEGA DIGITALE" : "DIGITAL COLLEAGUE"}</span>
        <span className={styles.liveBadge}>
          <i /> {statusLabel}
        </span>
      </header>
      <div className={styles.avatarWrap}>
        <BusinessAvatar
          viseme={viseme}
          mood={mood}
          gesture={gesture}
          voiceLevel={voiceLevel}
          ariaLabel={isItalian ? "Avatar del collega digitale in abito business" : "Business-style digital colleague avatar"}
        />
      </div>
      <div className={styles.lowerThird}>
        <span>{displayName}</span>
        <strong>{role}</strong>
        <small>{title}</small>
      </div>
      {!inMeeting && (
        <div className={styles.mockNotice}>
          {isItalian ? "Anteprima dell’aspetto nel meeting" : "Preview of the meeting appearance"}
        </div>
      )}
    </div>
  );
}
