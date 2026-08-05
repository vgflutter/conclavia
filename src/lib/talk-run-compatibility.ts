import { getLlmModel, type LlmProvider } from "@/lib/llm-models";
import type { TalkInput } from "@/types/talk";

export const MAX_RUN_TURNS = 50;

export type TalkRunBlockCode =
  | "unassigned_participants";

export function getTalkRunBlockCode(
  talk: TalkInput,
): TalkRunBlockCode | undefined {
  if (talk.participants.some((participant) => participant.kind === "unassigned")) {
    return "unassigned_participants";
  }
  return undefined;
}

export function requiredTalkProviders(talk: TalkInput): LlmProvider[] {
  const providers = new Set<LlmProvider>();

  // The default provider also powers the off-air editorial desk, including
  // fully human casts.
  providers.add(getLlmModel(talk.settings.defaultModel).provider);

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
