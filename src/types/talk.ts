import type { LlmModelId } from "@/lib/llm-models";
import type { StudioThemeId } from "@/lib/studio-themes";

export type TalkStatus = "draft" | "ready";
export type PerspectiveMode = "custom" | "automatic" | "random";
export type ParticipantKind = "ai" | "human" | "unassigned";
export type ParticipantSex = "female" | "male";
export type VoiceDelivery = "natural" | "energetic" | "authoritative";
export type ModeratorKind = "none" | "ai" | "human";
export type ModeratorStyle = "neutral" | "challenging" | "facilitating";
export type TalkPace = "fast" | "balanced" | "deep";

export interface Participant {
  kind: ParticipantKind;
  sex: ParticipantSex;
  name: string;
  role: string;
  perspectiveMode: PerspectiveMode;
  perspectivePrompt: string;
  goals?: string;
  nonNegotiables?: string;
  speakingStylePrompt?: string;
  modelOverride?: LlmModelId;
  voiceId?: string;
  voiceDelivery?: VoiceDelivery;
  assertiveness: number;
  patience: number;
  interruptiveness: number;
  baselineTension: number;
}

export interface ModeratorConfiguration {
  kind: ModeratorKind;
  name?: string;
  role?: string;
  instructions?: string;
  style: ModeratorStyle;
  modelOverride?: LlmModelId;
  voiceId?: string;
  voiceDelivery?: VoiceDelivery;
  canInterrupt: boolean;
  manageTime: boolean;
  summarizeAtEnd: boolean;
}

export interface TalkSettings {
  maxTurns: number;
  targetDurationMinutes: number;
  studioTheme: StudioThemeId;
  defaultModel: LlmModelId;
  allowInterruptions: boolean;
  pace: TalkPace;
}

export interface TalkInput {
  title: string;
  topic: string;
  description?: string;
  language: string;
  participants: Participant[];
  moderator: ModeratorConfiguration;
  status: TalkStatus;
  settings: TalkSettings;
}

export interface TalkRecord extends TalkInput {
  createdAt: Date;
  updatedAt: Date;
}

export interface TalkResponse extends Omit<TalkInput, "description"> {
  id: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}
