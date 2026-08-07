import type { TalkDocument } from "@/models/Talk";
import type { TalkResponse } from "@/types/talk";
import {
  DEFAULT_LLM_MODEL,
  isLlmModelId,
} from "@/lib/llm-models";
import {
  DEFAULT_STUDIO_THEME,
  normalizeStudioTheme,
} from "@/lib/studio-themes";
import { findStudioVoice } from "@/lib/liveavatar-catalog";

function voiceDelivery(value: unknown) {
  return value === "energetic" || value === "authoritative"
    ? value
    : "natural";
}

export function serializeTalk(talk: TalkDocument): TalkResponse {
  return {
    id: talk._id.toString(),
    title: talk.title,
    topic: talk.topic,
    description: talk.description,
    language: talk.language,
    participants: talk.participants.map((participant, index) => ({
      kind:
        participant.kind === "human" || participant.kind === "unassigned"
          ? participant.kind
          : "ai",
      sex:
        participant.sex === "female" || participant.sex === "male"
          ? participant.sex
          : index % 2 === 0
            ? "female"
            : "male",
      name: participant.name,
      role: participant.role,
      perspectiveMode: participant.perspectiveMode ?? "custom",
      perspectivePrompt: participant.perspectivePrompt,
      goals: participant.goals,
      nonNegotiables: participant.nonNegotiables,
      speakingStylePrompt: participant.speakingStylePrompt,
      modelOverride: isLlmModelId(participant.modelOverride)
        ? participant.modelOverride
        : undefined,
      voiceId: findStudioVoice(participant.voiceId ?? "")?.id,
      voiceDelivery: voiceDelivery(participant.voiceDelivery),
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
      voiceId: findStudioVoice(talk.moderator?.voiceId ?? "")?.id,
      voiceDelivery: voiceDelivery(talk.moderator?.voiceDelivery),
      canInterrupt: talk.moderator?.canInterrupt ?? true,
      manageTime: talk.moderator?.manageTime ?? true,
      summarizeAtEnd: talk.moderator?.summarizeAtEnd ?? true,
    },
    status: talk.status,
    settings: {
      maxTurns: talk.settings.maxTurns,
      targetDurationMinutes: talk.settings.targetDurationMinutes ?? 30,
      studioTheme: normalizeStudioTheme(
        talk.settings.studioTheme ?? DEFAULT_STUDIO_THEME,
      ),
      defaultModel: isLlmModelId(talk.settings.defaultModel)
        ? talk.settings.defaultModel
        : DEFAULT_LLM_MODEL,
      allowInterruptions: talk.settings.allowInterruptions,
      pace:
        talk.settings.pace === "fast" || talk.settings.pace === "deep"
          ? talk.settings.pace
          : "balanced",
    },
    createdAt: talk.createdAt.toISOString(),
    updatedAt: talk.updatedAt.toISOString(),
  };
}
