import type { TalkResponse } from "@/types/talk";
import type {
  TalkRunMessageResponse,
  TalkRunPhase,
} from "@/types/talk-run";

interface GenerationPrompt {
  instructions: string;
  input: string;
}

function transcript(messages: TalkRunMessageResponse[]): string {
  if (messages.length === 0) {
    return "No one has spoken yet.";
  }

  return messages
    .map((message) => `[${message.sequence}] ${message.speakerName}: ${message.content}`)
    .join("\n\n");
}

function roster(talk: TalkResponse): string {
  return talk.participants
    .map((participant, index) => {
      const perspective = participant.perspectivePrompt
        ? ` — configured perspective/guidance: ${participant.perspectivePrompt}`
        : "";
      return `${index + 1}. ${participant.name}, ${participant.role}${perspective}`;
    })
    .join("\n");
}

function talkContext(talk: TalkResponse): string {
  return [
    `Title: ${talk.title}`,
    `Topic: ${talk.topic}`,
    talk.description ? `Background: ${talk.description}` : undefined,
    `Required output language: ${talk.language}`,
    "Participants:",
    roster(talk),
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildParticipantPrompt(
  talk: TalkResponse,
  messages: TalkRunMessageResponse[],
  participantIndex: number,
): GenerationPrompt {
  const participant = talk.participants[participantIndex];
  const perspectiveInstruction =
    participant.perspectiveMode === "custom"
      ? `Follow this perspective faithfully: ${participant.perspectivePrompt}`
      : participant.perspectiveMode === "random"
        ? `Adopt a plausible but surprising perspective that differs from the other participants. Respect these optional constraints: ${participant.perspectivePrompt || "none"}.`
        : `Choose a relevant, coherent perspective yourself. Use these optional preferences if present: ${participant.perspectivePrompt || "none"}.`;

  const instructions = [
    `You are ${participant.name}, participating as ${participant.role}.`,
    perspectiveInstruction,
    participant.speakingStylePrompt
      ? `Speaking style: ${participant.speakingStylePrompt}`
      : undefined,
    `Behavior profile (0–100): assertiveness ${participant.assertiveness}, patience ${participant.patience}, interruptiveness ${participant.interruptiveness}, baseline tension ${participant.baselineTension}.`,
    `Respond only in ${talk.language}. Stay in character and address the actual topic and prior interventions.`,
    "Write one focused intervention of roughly 80–180 words. Do not prefix it with your name or role. Do not invent citations or claim access to facts not present in the discussion.",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    instructions,
    input: `${talkContext(talk)}\n\nTranscript so far:\n${transcript(messages)}\n\nIt is now your turn. Add a substantive contribution: state or develop your position, respond to relevant earlier points, and avoid merely repeating the transcript.`,
  };
}

export function buildModeratorPrompt(
  talk: TalkResponse,
  messages: TalkRunMessageResponse[],
  phase: Extract<TalkRunPhase, "opening" | "closing">,
): GenerationPrompt {
  const moderator = talk.moderator;
  const style =
    moderator.style === "challenging"
      ? "challenging and precise"
      : moderator.style === "facilitating"
        ? "facilitating and constructive"
        : "neutral and balanced";
  const instructions = [
    `You are ${moderator.name}, the ${moderator.role || "moderator"} of this talk.`,
    `Your moderation style is ${style}.`,
    moderator.instructions
      ? `Editorial instructions: ${moderator.instructions}`
      : undefined,
    `You ${moderator.canInterrupt ? "may" : "must not"} interrupt, ${moderator.manageTime ? "must" : "do not need to"} manage time, and ${moderator.summarizeAtEnd ? "must" : "do not need to"} provide a final summary.`,
    `Respond only in ${talk.language}. Do not prefix the output with your name or role.`,
  ]
    .filter(Boolean)
    .join("\n");

  const task =
    phase === "opening"
      ? "Open the talk in 60–120 words. Frame the question neutrally, introduce the range of participants without inventing facts, and establish a useful focus for the discussion."
      : "Close the talk in 100–180 words. Summarize the strongest points, agreements, disagreements, and unresolved questions without declaring a winner unless the transcript clearly supports it.";

  return {
    instructions,
    input: `${talkContext(talk)}\n\nTranscript so far:\n${transcript(messages)}\n\n${task}`,
  };
}
