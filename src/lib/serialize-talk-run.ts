import type { TalkRunDocument } from "@/models/TalkRun";
import type { TalkRunResponse } from "@/types/talk-run";

export function serializeTalkRun(run: TalkRunDocument): TalkRunResponse {
  return {
    id: run._id.toString(),
    talkId: run.talkId.toString(),
    status: run.status,
    phase: run.phase,
    participantTurnCount: run.participantTurnCount,
    maxTurns: run.maxTurns,
    nextParticipantIndex: run.nextParticipantIndex,
    messages: run.messages.map((message) => ({
      sequence: message.sequence,
      speakerType: message.speakerType,
      participantIndex: message.participantIndex,
      speakerName: message.speakerName,
      speakerRole: message.speakerRole,
      provider: message.provider,
      model: message.model,
      content: message.content,
      inputTokens: message.inputTokens,
      outputTokens: message.outputTokens,
      createdAt: message.createdAt.toISOString(),
    })),
    error: run.error,
    startedAt: run.startedAt.toISOString(),
    completedAt: run.completedAt?.toISOString(),
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
  };
}
