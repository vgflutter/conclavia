import type { TalkResponse } from "@/types/talk";
import type {
  TalkRunDiscussionState,
  TalkRunMessageResponse,
  TalkRunResponse,
  TalkRunTurnPlan,
} from "@/types/talk-run";

interface GenerationPrompt {
  instructions: string;
  input: string;
}

const RECENT_MESSAGE_LIMIT = 8;

function recentTranscript(messages: TalkRunMessageResponse[]): string {
  const recent = messages.slice(-RECENT_MESSAGE_LIMIT);
  if (recent.length === 0) return "No one has spoken yet.";

  return recent
    .map((message) => {
      const target = message.targetSpeakerName
        ? ` → ${message.targetSpeakerName}`
        : "";
      return `[${message.sequence}] ${message.speakerName}${target} (${message.arcPhase}, ${message.intent}, ${message.threadLabel}): ${message.content}`;
    })
    .join("\n\n");
}

function publicRoster(talk: TalkResponse): string {
  return talk.participants
    .map(
      (participant, index) =>
        `${index + 1}. ${participant.name}, ${participant.role}, sex ${participant.sex ?? (index % 2 === 0 ? "female" : "male")}`,
    )
    .join("\n");
}

function list(items: string[]): string {
  return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- none yet";
}

function sharedState(state: TalkRunDiscussionState, talk: TalkResponse): string {
  const positions = state.corePositions.map((position) => {
    const name = talk.participants[position.participantIndex]?.name ?? "Unknown guest";
    return `${name}: ${position.summary}`;
  });
  const turningPoints = state.turningPoints.map((point) => {
    const name = talk.participants[point.participantIndex]?.name ?? "Unknown guest";
    return `${name}: ${point.summary}`;
  });

  return [
    `Editorial arc phase: ${state.arcPhase}`,
    `Objective of this phase: ${state.phaseObjective}`,
    `Central question: ${state.centralQuestion}`,
    `Current focus: ${state.currentFocus || "not established yet"}`,
    `Core positions:\n${list(positions)}`,
    `Central conflict: ${state.keyConflict || "not isolated yet"}`,
    `Contested claims:\n${list(state.contestedClaims)}`,
    `Evidence and trade-offs tested:\n${list(state.evidenceAndTradeoffs)}`,
    `Open questions:\n${list(state.openQuestions)}`,
    `Genuine agreements:\n${list(state.agreements)}`,
    `Unresolved conflicts:\n${list(state.unresolvedConflicts)}`,
    `Turning points:\n${list(turningPoints)}`,
    `Conclusion readiness: ${state.conclusionReadiness}. ${state.conclusionReason}`,
    state.floorQueue.length > 0
      ? `Current floor requests:\n${list(
          state.floorQueue.map((request) => {
            const speaker = talk.participants[request.participantIndex]?.name ?? "Unknown";
            return `${speaker}: ${request.reason}`;
          }),
        )}`
      : undefined,
    state.conclusion
      ? `Editorial conclusion (${state.conclusion.kind}): ${state.conclusion.answer}`
      : undefined,
    state.conclusion
      ? `Decisive conditions:\n${list(state.conclusion.conditions)}`
      : undefined,
    state.conclusion
      ? `Remaining disagreements:\n${list(state.conclusion.disagreements)}`
      : undefined,
  ].join("\n");
}

function arcInstruction(plan: TalkRunTurnPlan): string {
  switch (plan.arcPhase) {
    case "positions":
      return "Editorial phase — positions: make one distinctive, falsifiable position clear. Do not merely offer generic context or repeat a position already present.";
    case "conflict":
      return "Editorial phase — central conflict: stay on the main incompatibility selected by the director. Force a concrete answer instead of opening another side topic.";
    case "examination":
      return "Editorial phase — examination: test a premise through consequences, an exception, a counterexample, feasibility, or a missing condition. Do not just restate whether you agree.";
    case "synthesis":
      return "Editorial phase — synthesis: state what survives the objections, what you can revise or concede, the condition that would change your judgment, and the precise disagreement that remains.";
    default:
      return "Editorial phase — conclusion: distinguish what was established from what remains unresolved. A clear disagreement is a valid conclusion; never manufacture consensus.";
  }
}

function talkContext(talk: TalkResponse): string {
  return [
    `Title: ${talk.title}`,
    `Topic: ${talk.topic}`,
    talk.description ? `Background: ${talk.description}` : undefined,
    `Required output language: ${talk.language}`,
    "On-air guests (public identity only):",
    publicRoster(talk),
  ]
    .filter(Boolean)
    .join("\n");
}

function planTask(plan: TalkRunTurnPlan): string {
  const target = plan.targetSpeakerName
    ? ` The intended interlocutor is ${plan.targetSpeakerName}; engage only with a point they actually made.`
    : "";

  switch (plan.intent) {
    case "opening":
      return "Open the live talk, frame the central conflict, briefly locate the range of guests, and end with a sharp starting question.";
    case "closing":
      return plan.speakerType === "participant"
        ? "Give your final position on the central question. Use the editorial conclusion as context, acknowledge the strongest point that survived the exchange, and name the decisive disagreement or condition that remains. Speak from your own perspective; do not impersonate a neutral host, invent consensus, or declare a winner."
        : "Present the editorial conclusion already present in the shared state: answer the central question, then separate genuine agreements, decisive conditions, strongest remaining conflicts, and open questions. Do not replace that conclusion, invent consensus, or declare a winner.";
    case "moderation":
      return `Intervene visibly as an active host: stop drift, expose the unresolved point, or redirect the exchange.${target}`;
    case "question":
      return `Ask one precise, consequential question that moves this exact thread forward.${target}`;
    case "answer":
      return `Answer the host's latest question clearly before developing your own point.${target}`;
    case "challenge":
      return `Challenge one specific premise or consequence in the targeted intervention. Explain the disagreement, do not merely declare it.${target}`;
    case "interruption":
      return `Make a brief, urgent interruption tied to one concrete claim just made.${target}`;
    case "clarification":
      return `Clarify a distinction or correct an ambiguity that matters to the current disagreement.${target}`;
    case "partial_agreement":
      return `Acknowledge one real point of agreement, then state precisely where and why the agreement ends.${target}`;
    case "reply":
      return `Give a direct reply that advances the exchange rather than restating your general position.${target}`;
    default:
      return "Present the strongest relevant argument from your position and give the next speaker something concrete to answer.";
  }
}

function preparationInstruction(
  plan: TalkRunTurnPlan,
  speculative: boolean,
): string {
  if (plan.preparationMode === "prepared") {
    return "You already had this contribution in mind before the latest speaker finished. Lead with your own claim; do not pretend it is a direct reply and do not force a reference to the immediately preceding intervention.";
  }

  return speculative
    ? "You are composing this reaction while the other person is still speaking. React only to a claim already explicit in the partial intervention. Never guess how they will finish, and make the opening sound immediate rather than prewritten."
    : "This intervention was formed while listening. React to the substance, but do not mechanically summarize the other person before making your point.";
}

function referenceInstruction(plan: TalkRunTurnPlan): string {
  if (!plan.targetSpeakerName) {
    return "No explicit addressee is required. Enter through the shared topic and avoid inventing a disagreement with the latest speaker.";
  }

  switch (plan.referenceStyle) {
    case "direct_name":
      return `Refer to ${plan.targetSpeakerName} by name once, naturally, but do not begin with a stock formula such as “I respond to…” or “as they said…”.`;
    case "idea_first":
      return `Begin from the concrete idea or consequence you want to address. Mention ${plan.targetSpeakerName} later only if it helps clarity.`;
    case "echo_phrase":
      return `Pick up a short phrase or concept actually used by ${plan.targetSpeakerName}, then turn it into your own point. Do not fabricate or overquote.`;
    default:
      return `Make the response to ${plan.targetSpeakerName} clear from context without naming them. Avoid generic agreement/disagreement formulas.`;
  }
}

function participantInstructions(
  talk: TalkResponse,
  run: TalkRunResponse,
  plan: TalkRunTurnPlan & { participantIndex: number },
): string {
  const participant = talk.participants[plan.participantIndex];
  const participantSex =
    participant.sex ?? (plan.participantIndex % 2 === 0 ? "female" : "male");
  const memory = run.discussionState.participantMemories.find(
    (item) => item.participantIndex === plan.participantIndex,
  )?.statements;
  const perspectiveInstruction =
    participant.perspectiveMode === "custom"
      ? `Your stable position: ${participant.perspectivePrompt}`
      : participant.perspectiveMode === "random"
        ? `Adopt a plausible, surprising position compatible with this private guidance: ${participant.perspectivePrompt || "none"}. Once chosen, keep it consistent with your remembered statements.`
        : `Choose a coherent position compatible with your role and this private guidance: ${participant.perspectivePrompt || "none"}. Once chosen, keep it consistent with your remembered statements.`;

  return [
    `You are ${participant.name}, on air as ${participant.role}.`,
    `Your sex is ${participantSex}. Keep names, self-references, and pronouns consistent with this identity; do not bring it up unless it is relevant to the discussion.`,
    perspectiveInstruction,
    participant.goals ? `Your private objectives: ${participant.goals}` : undefined,
    participant.nonNegotiables
      ? `Your private non-negotiable points: ${participant.nonNegotiables}`
      : undefined,
    participant.speakingStylePrompt
      ? `Your stable speaking style: ${participant.speakingStylePrompt}`
      : undefined,
    `Your behavioral profile (0–100): assertiveness ${participant.assertiveness}, patience ${participant.patience}, interruptiveness ${participant.interruptiveness}, baseline tension ${participant.baselineTension}.`,
    `Your remembered public claims:\n${list(memory ?? [])}`,
    talk.settings.allowInterruptions
      ? "This is an open studio exchange: direct challenges and occasional interruptions are allowed when relevant."
      : "This is an orderly studio exchange: be direct but do not simulate interruptions or overlap.",
  ]
    .filter(Boolean)
    .join("\n");
}

function moderatorInstructions(talk: TalkResponse): string {
  const moderator = talk.moderator;
  const style =
    moderator.style === "challenging"
      ? "adversarial but impartial: press vague claims and expose conflicts without becoming partisan"
      : moderator.style === "facilitating"
        ? "facilitating: clarify disagreements and surface possible compromises without forcing consensus"
        : "impartial and journalistic: keep competing positions clear and equally accountable";

  return [
    `You are ${moderator.name}, the on-air ${moderator.role || "host"}.`,
    `Your editorial style is ${style}.`,
    moderator.instructions
      ? `Editorial instructions: ${moderator.instructions}`
      : undefined,
    `You ${moderator.canInterrupt ? "may" : "must not"} interrupt and ${moderator.manageTime ? "must" : "do not need to"} manage pace and focus.`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildTurnPrompt(
  talk: TalkResponse,
  run: TalkRunResponse,
  plan: TalkRunTurnPlan,
  options: { speculative?: boolean } = {},
): GenerationPrompt {
  const identity =
    plan.speakerType === "participant" && plan.participantIndex !== undefined
      ? participantInstructions(
          talk,
          run,
          plan as TalkRunTurnPlan & { participantIndex: number },
        )
      : moderatorInstructions(talk);

  const instructions = [
    identity,
    `Speak only in ${talk.language}.`,
    `Turn intention: ${plan.intent}. Thread: ${plan.threadLabel}.`,
    arcInstruction(plan),
    preparationInstruction(plan, options.speculative === true),
    referenceInstruction(plan),
    `Write between ${plan.minWords} and ${plan.maxWords} words. The range is deliberate: do not pad a short intervention and do not turn every response into a mini-editorial.`,
    "Output only the spoken intervention. Do not prefix it with a name, role, label, stage direction, or quotation marks.",
    "Vary sentence openings and conversational entry points. Never repeatedly use the same template to agree, disagree, name another guest, or take the floor.",
    "Stay in character. Never speak for another guest. Do not invent sources, quotations, statistics, or facts absent from the provided context.",
  ].join("\n");

  return {
    instructions,
    input: [
      talkContext(talk),
      "Shared editorial state maintained by the invisible director:",
      sharedState(run.discussionState, talk),
      `Estimated studio airtime: ${run.estimatedAirtimeSeconds} of ${run.targetDurationMinutes * 60} seconds. Respect the assigned word range; the director shortens contributions as the closing approaches.`,
      `Recent on-air transcript (only the latest ${RECENT_MESSAGE_LIMIT} interventions):`,
      recentTranscript(run.messages),
      "Your assignment for this intervention:",
      planTask(plan),
    ].join("\n\n"),
  };
}
