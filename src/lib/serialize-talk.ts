import type { TalkDocument } from "@/models/Talk";
import type { TalkResponse } from "@/types/talk";

export function serializeTalk(talk: TalkDocument): TalkResponse {
  return {
    id: talk._id.toString(),
    title: talk.title,
    topic: talk.topic,
    description: talk.description,
    language: talk.language,
    participants: talk.participants.map((participant) => ({
      name: participant.name,
      role: participant.role,
      perspectivePrompt: participant.perspectivePrompt,
      speakingStylePrompt: participant.speakingStylePrompt,
      assertiveness: participant.assertiveness,
      patience: participant.patience,
      interruptiveness: participant.interruptiveness,
      baselineTension: participant.baselineTension,
    })),
    status: talk.status,
    settings: {
      maxTurns: talk.settings.maxTurns,
      allowInterruptions: talk.settings.allowInterruptions,
      seekCommonGround: talk.settings.seekCommonGround,
    },
    createdAt: talk.createdAt.toISOString(),
    updatedAt: talk.updatedAt.toISOString(),
  };
}
