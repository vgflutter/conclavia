import type { LlmModelId } from "@/lib/llm-models";

export type TalkStatus = "draft" | "ready";
export type PerspectiveMode = "custom" | "automatic" | "random";
export type ParticipantKind = "ai" | "human" | "unassigned";
export type ModeratorKind = "none" | "ai" | "human";
export type ModeratorStyle = "neutral" | "challenging" | "facilitating";

export interface Participant {
  kind: ParticipantKind;
  name: string;
  role: string;
  perspectiveMode: PerspectiveMode;
  perspectivePrompt: string;
  speakingStylePrompt?: string;
  modelOverride?: LlmModelId;
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
  canInterrupt: boolean;
  manageTime: boolean;
  summarizeAtEnd: boolean;
}

export interface TalkSettings {
  maxTurns: number;
  targetDurationMinutes: number;
  defaultModel: LlmModelId;
  allowInterruptions: boolean;
  seekCommonGround: boolean;
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
