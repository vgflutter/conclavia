export type TalkStatus = "draft" | "ready";

export interface Participant {
  name: string;
  role: string;
  perspectivePrompt: string;
  speakingStylePrompt?: string;
  assertiveness: number;
  patience: number;
  interruptiveness: number;
  baselineTension: number;
}

export interface TalkSettings {
  maxTurns: number;
  allowInterruptions: boolean;
  seekCommonGround: boolean;
}

export interface TalkInput {
  title: string;
  topic: string;
  description?: string;
  language: string;
  participants: Participant[];
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
