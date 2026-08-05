import type { LlmModelId, LlmProvider } from "@/lib/llm-models";

export type TalkRunStatus = "idle" | "generating" | "completed" | "failed";
export type TalkRunPhase = "opening" | "discussion" | "closing" | "completed";
export type TalkRunSpeakerType = "participant" | "moderator";

export interface TalkRunMessageResponse {
  sequence: number;
  speakerType: TalkRunSpeakerType;
  participantIndex?: number;
  speakerName: string;
  speakerRole?: string;
  provider: LlmProvider;
  model: LlmModelId;
  content: string;
  inputTokens?: number;
  outputTokens?: number;
  createdAt: string;
}

export interface TalkRunResponse {
  id: string;
  talkId: string;
  status: TalkRunStatus;
  phase: TalkRunPhase;
  participantTurnCount: number;
  maxTurns: number;
  nextParticipantIndex: number;
  messages: TalkRunMessageResponse[];
  error?: string;
  startedAt: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}
