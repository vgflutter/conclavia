import { getLlmModel, type LlmProvider } from "@/lib/llm-models";
import type { TalkInput } from "@/types/talk";

export const MAX_RUN_TURNS = 50;

export type TalkRunBlockCode =
  | "unassigned_participants"
  | "human_participants"
  | "human_moderator";

export function getTalkRunBlockCode(
  talk: TalkInput,
): TalkRunBlockCode | undefined {
  if (talk.participants.some((participant) => participant.kind === "unassigned")) {
    return "unassigned_participants";
  }
  if (talk.participants.some((participant) => participant.kind === "human")) {
    return "human_participants";
  }
  if (talk.moderator.kind === "human") {
    return "human_moderator";
  }
  return undefined;
}

export function requiredTalkProviders(talk: TalkInput): LlmProvider[] {
  const providers = new Set<LlmProvider>();

  for (const participant of talk.participants) {
    if (participant.kind === "ai") {
      providers.add(
        getLlmModel(participant.modelOverride ?? talk.settings.defaultModel)
          .provider,
      );
    }
  }

  if (talk.moderator.kind === "ai") {
    providers.add(
      getLlmModel(talk.moderator.modelOverride ?? talk.settings.defaultModel)
        .provider,
    );
  }

  return [...providers];
}
