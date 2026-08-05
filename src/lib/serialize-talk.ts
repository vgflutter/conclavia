import type { TalkDocument } from "@/models/Talk";
import type { TalkResponse } from "@/types/talk";
import {
  DEFAULT_LLM_MODEL,
  isLlmModelId,
} from "@/lib/llm-models";

export function serializeTalk(talk: TalkDocument): TalkResponse {
  return {
    id: talk._id.toString(),
    title: talk.title,
    topic: talk.topic,
    description: talk.description,
    language: talk.language,
    participants: talk.participants.map((participant) => ({
      kind:
        participant.kind === "human" || participant.kind === "unassigned"
          ? participant.kind
          : "ai",
      name: participant.name,
      role: participant.role,
      perspectiveMode: participant.perspectiveMode ?? "custom",
      perspectivePrompt: participant.perspectivePrompt,
      speakingStylePrompt: participant.speakingStylePrompt,
      modelOverride: isLlmModelId(participant.modelOverride)
        ? participant.modelOverride
        : undefined,
      assertiveness: participant.assertiveness,
      patience: participant.patience,
      interruptiveness: participant.interruptiveness,
      baselineTension: participant.baselineTension,
    })),
    moderator: {
      kind:
        talk.moderator?.kind === "ai" || talk.moderator?.kind === "human"
          ? talk.moderator.kind
          : "none",
      name: talk.moderator?.name,
      role: talk.moderator?.role,
      instructions: talk.moderator?.instructions,
      style:
        talk.moderator?.style === "challenging" ||
        talk.moderator?.style === "facilitating"
          ? talk.moderator.style
          : "neutral",
      modelOverride: isLlmModelId(talk.moderator?.modelOverride)
        ? talk.moderator.modelOverride
        : undefined,
      canInterrupt: talk.moderator?.canInterrupt ?? true,
      manageTime: talk.moderator?.manageTime ?? true,
      summarizeAtEnd: talk.moderator?.summarizeAtEnd ?? true,
    },
    status: talk.status,
    settings: {
      maxTurns: talk.settings.maxTurns,
      targetDurationMinutes: talk.settings.targetDurationMinutes ?? 30,
      defaultModel: isLlmModelId(talk.settings.defaultModel)
        ? talk.settings.defaultModel
        : DEFAULT_LLM_MODEL,
      allowInterruptions: talk.settings.allowInterruptions,
      seekCommonGround: talk.settings.seekCommonGround,
    },
    createdAt: talk.createdAt.toISOString(),
    updatedAt: talk.updatedAt.toISOString(),
  };
}
