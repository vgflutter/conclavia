import { randomUUID } from "node:crypto";
import type { Types } from "mongoose";

import { meetingSeriesKey } from "@/lib/meeting-validation";
import type {
  MeetingAssistantConfiguration,
  MeetingCreateInput,
  MeetingVoiceConfiguration,
} from "@/types/meeting";

export function localVoiceConfiguration(): MeetingVoiceConfiguration {
  return {
    mode: "local_private",
    provider: "local",
    model: "supertonic_3",
    pronunciationProfile: "conclavia-local-it-en",
  };
}

export function meetingAssistantConfiguration(
  correctionPolicy: MeetingCreateInput["correctionPolicy"],
  invocationName = "Conclavia",
): MeetingAssistantConfiguration {
  return {
    wakeWord: invocationName.trim().slice(0, 80) || "Conclavia",
    answerQuestions: true,
    captureMemory: true,
    summarizeOnRequest: true,
    correctionPolicy,
  };
}

export function meetingDocumentData(
  input: MeetingCreateInput,
  options: {
    seriesId?: Types.ObjectId;
    seriesLabel?: string;
    seriesKey?: string;
    assistantName?: string;
  } = {},
) {
  const scheduledStart = new Date(input.scheduledStart);
  const scheduledEnd = new Date(
    scheduledStart.getTime() + input.durationMinutes * 60_000,
  );
  const seriesLabel = options.seriesLabel ?? input.seriesLabel;
  const outputToken = randomUUID();

  return {
    seriesId: options.seriesId,
    title: input.title,
    meetingUrl: input.meetingUrl,
    platform: "microsoft_teams" as const,
    scheduledStart,
    scheduledEnd,
    timezone: input.timezone,
    objective: input.objective,
    seriesLabel,
    seriesKey:
      options.seriesKey ??
      (seriesLabel ? meetingSeriesKey(seriesLabel, input.title) : `single-${randomUUID()}`),
    language: input.language,
    autoJoin: input.autoJoin,
    status: "scheduled" as const,
    agenda: input.agenda.map((item) => ({
      id: randomUUID(),
      title: item.title,
      mandatory: item.mandatory,
      status: "pending" as const,
    })),
    assistant: meetingAssistantConfiguration(
      input.correctionPolicy,
      options.assistantName,
    ),
    commandHistory: [],
    bot: {
      provider: "mock" as const,
      accessMode: "anonymous_guest" as const,
      status: "not_scheduled" as const,
      outputToken,
      processedWebhookIds: [],
    },
    voice: localVoiceConfiguration(),
    retention: {
      transcriptDays: 90,
      storeAudio: false,
      consentRequired: true,
    },
    participants: [],
    transcript: [],
    summary: {
      overview: "",
      rememberedFacts: [],
      decisions: [],
      actionItems: [],
      openQuestions: [],
      participantNotes: [],
    },
  };
}
