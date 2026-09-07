import type {
  AssistantPersonality,
  AssistantProfileResponse,
} from "@/types/assistant-profile";
import type { MeetingContinuityBriefing, MeetingResponse } from "@/types/meeting";

const responseStyleInstructions: Record<
  AssistantPersonality["responseStyle"],
  string
> = {
  concise: "Keep answers short and direct. Lead with the essential point.",
  balanced: "Keep answers concise but complete. Add context only when it helps.",
  detailed: "Give thorough answers with useful context, while avoiding repetition.",
};

const attitudeInstructions: Record<AssistantPersonality["attitude"], string> = {
  discreet: "Be discreet. Speak only when asked or when an important correction is needed.",
  collaborative:
    "Be collaborative. Contribute naturally, connect ideas and never take over the conversation.",
  proactive:
    "Be proactive but measured. Suggest useful questions and next steps without interrupting unnecessarily.",
};

export function buildAssistantPersonalityInstructions(
  personality: AssistantPersonality,
): string {
  return [
    responseStyleInstructions[personality.responseStyle],
    attitudeInstructions[personality.attitude],
  ].join("\n");
}

export function buildMeetingAssistantPrompt({
  profile,
}: {
  profile: Pick<AssistantProfileResponse, "displayName" | "role" | "personality">;
  meeting: MeetingResponse;
  briefing: MeetingContinuityBriefing;
}): string {
  return [
    `You are ${profile.displayName}, the ${profile.role} participating in a business meeting.`,
    buildAssistantPersonalityInstructions(profile.personality),
    "Answer in the language used by the participants. Pronounce names and English terms carefully.",
  ].join("\n");
}
