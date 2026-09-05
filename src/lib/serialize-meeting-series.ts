import type { MeetingSeriesDocument } from "@/models/MeetingSeries";
import { localVoiceConfiguration, meetingAssistantConfiguration } from "@/lib/meeting-factory";
import type { MeetingSeriesResponse } from "@/types/meeting";

export function serializeMeetingSeries(
  document: MeetingSeriesDocument,
): MeetingSeriesResponse {
  return {
    id: document._id.toString(),
    title: document.title,
    objective: document.objective || "",
    timezone: document.timezone,
    language: document.language,
    autoJoin: document.autoJoin,
    agenda: (document.agenda || []).map((item) => ({
      title: item.title,
      mandatory: item.mandatory,
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
    voice: localVoiceConfiguration(),
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString(),
  };
}
