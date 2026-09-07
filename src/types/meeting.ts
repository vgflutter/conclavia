import type { Types } from "mongoose";

export type MeetingPlatform = "microsoft_teams";

export type MeetingStatus =
  | "scheduled"
  | "joining"
  | "waiting_room"
  | "live"
  | "processing"
  | "completed"
  | "cancelled"
  | "failed";

export type MeetingBotProvider = "mock" | "recall" | "attendee";
export type MeetingAccessMode = "verified_guest" | "anonymous_guest";
export type MeetingBotStatus =
  | "not_scheduled"
  | "scheduling"
  | "scheduled"
  | "joining"
  | "waiting_room"
  | "joined"
  | "left"
  | "failed";

export type MeetingLanguage = "auto" | "it" | "en";
export type AgendaItemStatus = "pending" | "covered" | "skipped";
export type CorrectionPolicy = "important_only" | "on_request" | "off";
export type MeetingCommandKind =
  | "remember"
  | "summary"
  | "agenda"
  | "ask"
  | "correct"
  | "inform";
export type MeetingInterventionType = "correction" | "relevant_information";

export interface MeetingAgendaInput {
  title: string;
  mandatory: boolean;
}

export interface MeetingAgendaItem extends MeetingAgendaInput {
  id: string;
  status: AgendaItemStatus;
  notes?: string;
}

export interface MeetingAssistantConfiguration {
  wakeWord: string;
  answerQuestions: boolean;
  captureMemory: boolean;
  summarizeOnRequest: boolean;
  correctionPolicy: CorrectionPolicy;
}

export interface MeetingCreateInput {
  title: string;
  meetingUrl: string;
  scheduledStart: string;
  durationMinutes: number;
  timezone: string;
  objective: string;
  seriesLabel?: string;
  language: MeetingLanguage;
  autoJoin: boolean;
  agenda: MeetingAgendaInput[];
  correctionPolicy: CorrectionPolicy;
}

export interface MeetingAppointmentInput {
  label?: string;
  meetingUrl: string;
  scheduledStart: string;
  durationMinutes: number;
}

export interface MeetingSeriesCreateInput {
  title: string;
  objective: string;
  timezone: string;
  language: MeetingLanguage;
  autoJoin: boolean;
  agenda: MeetingAgendaInput[];
  correctionPolicy: CorrectionPolicy;
  appointments: MeetingAppointmentInput[];
}

export interface MeetingActionItem {
  description: string;
  owner?: string;
  dueAt?: Date;
  completed: boolean;
}

export interface MeetingParticipantNote {
  displayName: string;
  note: string;
}

export interface MeetingTranscriptSegment {
  sequence: number;
  speakerName: string;
  text: string;
  language?: "it" | "en";
  startMs?: number;
  endMs?: number;
  createdAt: Date;
}

export interface MeetingCommandEvent {
  id: string;
  kind: MeetingCommandKind;
  prompt?: string;
  response: string;
  createdAt: Date;
}

export interface MeetingPendingIntervention {
  id: string;
  type: MeetingInterventionType;
  sourceSpeaker?: string;
  sourceStatement: string;
  reason: string;
  response: string;
  createdAt: Date;
  expiresAt: Date;
}

export interface MeetingSummary {
  overview: string;
  rememberedFacts: string[];
  decisions: string[];
  actionItems: MeetingActionItem[];
  openQuestions: string[];
  participantNotes: MeetingParticipantNote[];
  generatedAt?: Date;
}

export interface MeetingBotConfiguration {
  provider: MeetingBotProvider;
  accessMode: MeetingAccessMode;
  status: MeetingBotStatus;
  externalBotId?: string;
  accountEmail?: string;
  outputToken: string;
  outputUrl?: string;
  scheduledFor?: Date;
  joinedAt?: Date;
  leftAt?: Date;
  providerStatusCode?: string;
  lastStatusAt?: Date;
  lastCorrectionCheckAt?: Date;
  processedWebhookIds?: string[];
  lastError?: string;
}

export interface MeetingVoiceConfiguration {
  mode: "local_private";
  provider: "local";
  model: "supertonic_3";
  pronunciationProfile: string;
}

export interface MeetingRetentionConfiguration {
  transcriptDays: number;
  storeAudio: boolean;
  consentRequired: boolean;
}

export interface MeetingRecord {
  seriesId?: Types.ObjectId;
  title: string;
  meetingUrl: string;
  platform: MeetingPlatform;
  scheduledStart: Date;
  scheduledEnd: Date;
  timezone: string;
  objective: string;
  seriesLabel?: string;
  seriesKey: string;
  language: MeetingLanguage;
  autoJoin: boolean;
  status: MeetingStatus;
  agenda: MeetingAgendaItem[];
  assistant: MeetingAssistantConfiguration;
  commandHistory: MeetingCommandEvent[];
  pendingIntervention?: MeetingPendingIntervention;
  bot: MeetingBotConfiguration;
  voice: MeetingVoiceConfiguration;
  retention: MeetingRetentionConfiguration;
  participants: string[];
  transcript: MeetingTranscriptSegment[];
  summary: MeetingSummary;
  createdAt: Date;
  updatedAt: Date;
}

export interface MeetingResponse {
  id: string;
  seriesId?: string;
  title: string;
  meetingUrl: string;
  platform: MeetingPlatform;
  scheduledStart: string;
  scheduledEnd: string;
  timezone: string;
  objective: string;
  seriesLabel?: string;
  seriesKey: string;
  language: MeetingLanguage;
  autoJoin: boolean;
  status: MeetingStatus;
  agenda: MeetingAgendaItem[];
  assistant: MeetingAssistantConfiguration;
  commandHistory: Array<Omit<MeetingCommandEvent, "createdAt"> & { createdAt: string }>;
  pendingIntervention?: Omit<MeetingPendingIntervention, "createdAt" | "expiresAt"> & {
    createdAt: string;
    expiresAt: string;
  };
  bot: {
    provider: MeetingBotProvider;
    accessMode: MeetingAccessMode;
    status: MeetingBotStatus;
    externalBotId?: string;
    accountEmail?: string;
    outputToken: string;
    outputUrl?: string;
    scheduledFor?: string;
    joinedAt?: string;
    leftAt?: string;
    providerStatusCode?: string;
    lastStatusAt?: string;
    lastError?: string;
  };
  voice: MeetingVoiceConfiguration;
  retention: MeetingRetentionConfiguration;
  participants: string[];
  transcript: Array<Omit<MeetingTranscriptSegment, "createdAt"> & { createdAt: string }>;
  summary: {
    overview: string;
    rememberedFacts: string[];
    decisions: string[];
    actionItems: Array<Omit<MeetingActionItem, "dueAt"> & { dueAt?: string }>;
    openQuestions: string[];
    participantNotes: MeetingParticipantNote[];
    generatedAt?: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface MeetingSeriesRecord {
  title: string;
  objective: string;
  timezone: string;
  language: MeetingLanguage;
  autoJoin: boolean;
  agenda: MeetingAgendaInput[];
  assistant: MeetingAssistantConfiguration;
  voice: MeetingVoiceConfiguration;
  createdAt: Date;
  updatedAt: Date;
}

export interface MeetingSeriesResponse {
  id: string;
  title: string;
  objective: string;
  timezone: string;
  language: MeetingLanguage;
  autoJoin: boolean;
  agenda: MeetingAgendaInput[];
  assistant: MeetingAssistantConfiguration;
  voice: MeetingVoiceConfiguration;
  createdAt: string;
  updatedAt: string;
}

export interface MeetingContinuityBriefing {
  seriesId?: string;
  seriesKey: string;
  previousMeetingIds: string[];
  lastMeetingAt?: string;
  overview?: string;
  rememberedFacts: string[];
  decisions: string[];
  actionItems: Array<Omit<MeetingActionItem, "dueAt"> & { dueAt?: string }>;
  openQuestions: string[];
  participantNotes: MeetingParticipantNote[];
}
