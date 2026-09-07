import type { MeetingDocument } from "@/models/Meeting";
import { localVoiceConfiguration, meetingAssistantConfiguration } from "@/lib/meeting-factory";
import type { MeetingResponse } from "@/types/meeting";

function iso(value: Date | undefined): string | undefined {
  return value ? new Date(value).toISOString() : undefined;
}

export function serializeMeeting(document: MeetingDocument): MeetingResponse {
  const pendingIntervention = document.pendingIntervention &&
    document.pendingIntervention.expiresAt.getTime() > Date.now()
    ? document.pendingIntervention
    : undefined;
  return {
    id: document._id.toString(),
    seriesId: document.seriesId?.toString(),
    title: document.title,
    meetingUrl: document.meetingUrl,
    platform: document.platform,
    scheduledStart: document.scheduledStart.toISOString(),
    scheduledEnd: document.scheduledEnd.toISOString(),
    timezone: document.timezone,
    objective: document.objective || "",
    seriesLabel: document.seriesLabel || undefined,
    seriesKey: document.seriesKey,
    language: document.language,
    autoJoin: document.autoJoin,
    status: document.status,
    agenda: (document.agenda || []).map((item) => ({
      id: item.id,
      title: item.title,
      mandatory: item.mandatory,
      status: item.status,
      notes: item.notes || undefined,
    })),
    assistant: document.assistant
      ? {
          wakeWord: document.assistant.wakeWord || "Conclavia",
          answerQuestions: document.assistant.answerQuestions !== false,
          captureMemory: document.assistant.captureMemory !== false,
          summarizeOnRequest: document.assistant.summarizeOnRequest !== false,
          correctionPolicy: document.assistant.correctionPolicy || "important_only",
        }
      : meetingAssistantConfiguration("important_only"),
    commandHistory: (document.commandHistory || []).map((event) => ({
      id: event.id,
      kind: event.kind,
      prompt: event.prompt || undefined,
      response: event.response,
      createdAt: event.createdAt.toISOString(),
    })),
    pendingIntervention: pendingIntervention
      ? {
          id: pendingIntervention.id,
          type: pendingIntervention.type,
          sourceSpeaker: pendingIntervention.sourceSpeaker || undefined,
          sourceStatement: pendingIntervention.sourceStatement,
          reason: pendingIntervention.reason,
          response: pendingIntervention.response,
          createdAt: pendingIntervention.createdAt.toISOString(),
          expiresAt: pendingIntervention.expiresAt.toISOString(),
        }
      : undefined,
    bot: {
      provider: document.bot.provider,
      accessMode: document.bot.accessMode || "anonymous_guest",
      status: document.bot.status,
      externalBotId: document.bot.externalBotId || undefined,
      accountEmail: document.bot.accountEmail || undefined,
      outputToken: document.bot.outputToken,
      outputUrl: document.bot.outputUrl || undefined,
      scheduledFor: iso(document.bot.scheduledFor),
      joinedAt: iso(document.bot.joinedAt),
      leftAt: iso(document.bot.leftAt),
      providerStatusCode: document.bot.providerStatusCode || undefined,
      lastStatusAt: iso(document.bot.lastStatusAt),
      lastError: document.bot.lastError || undefined,
    },
    voice: localVoiceConfiguration(),
    retention: {
      transcriptDays: document.retention.transcriptDays,
      storeAudio: document.retention.storeAudio,
      consentRequired: document.retention.consentRequired,
    },
    participants: [...document.participants],
    transcript: document.transcript.map((segment) => ({
      sequence: segment.sequence,
      speakerName: segment.speakerName,
      text: segment.text,
      language: segment.language,
      startMs: segment.startMs,
      endMs: segment.endMs,
      createdAt: segment.createdAt.toISOString(),
    })),
    summary: {
      overview: document.summary.overview,
      rememberedFacts: [...(document.summary.rememberedFacts || [])],
      decisions: [...document.summary.decisions],
      actionItems: document.summary.actionItems.map((item) => ({
        description: item.description,
        owner: item.owner || undefined,
        dueAt: iso(item.dueAt),
        completed: item.completed,
      })),
      openQuestions: [...document.summary.openQuestions],
      participantNotes: document.summary.participantNotes.map((note) => ({
        displayName: note.displayName,
        note: note.note,
      })),
      generatedAt: iso(document.summary.generatedAt),
    },
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString(),
  };
}
