import type { Participant, TalkInput, TalkSettings, TalkStatus } from "@/types/talk";

type ValidationResult =
  | { success: true; data: TalkInput }
  | { success: false; issues: string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(
  value: unknown,
  field: string,
  issues: string[],
): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    issues.push(`${field} is required`);
    return "";
  }

  return value.trim();
}

function optionalString(
  value: unknown,
  field: string,
  issues: string[],
): string | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (typeof value !== "string") {
    issues.push(`${field} must be a string`);
    return undefined;
  }

  return value.trim() || undefined;
}

function score(value: unknown, field: string, issues: string[]): number {
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 100) {
    issues.push(`${field} must be an integer from 0 to 100`);
    return 0;
  }

  return value as number;
}

function parseParticipant(
  value: unknown,
  index: number,
  issues: string[],
): Participant {
  const field = `participants[${index}]`;
  const participant = isRecord(value) ? value : {};

  if (!isRecord(value)) {
    issues.push(`${field} must be an object`);
  }

  return {
    name: requiredString(participant.name, `${field}.name`, issues),
    role: requiredString(participant.role, `${field}.role`, issues),
    perspectivePrompt: requiredString(
      participant.perspectivePrompt,
      `${field}.perspectivePrompt`,
      issues,
    ),
    speakingStylePrompt: optionalString(
      participant.speakingStylePrompt,
      `${field}.speakingStylePrompt`,
      issues,
    ),
    assertiveness: score(participant.assertiveness, `${field}.assertiveness`, issues),
    patience: score(participant.patience, `${field}.patience`, issues),
    interruptiveness: score(
      participant.interruptiveness,
      `${field}.interruptiveness`,
      issues,
    ),
    baselineTension: score(
      participant.baselineTension,
      `${field}.baselineTension`,
      issues,
    ),
  };
}

function parseSettings(value: unknown, issues: string[]): TalkSettings {
  const settings = isRecord(value) ? value : {};

  if (!isRecord(value)) {
    issues.push("settings must be an object");
  }

  const maxTurns = settings.maxTurns;
  if (!Number.isInteger(maxTurns) || (maxTurns as number) < 1) {
    issues.push("settings.maxTurns must be a positive integer");
  }

  if (typeof settings.allowInterruptions !== "boolean") {
    issues.push("settings.allowInterruptions must be a boolean");
  }

  if (typeof settings.seekCommonGround !== "boolean") {
    issues.push("settings.seekCommonGround must be a boolean");
  }

  return {
    maxTurns: Number.isInteger(maxTurns) ? (maxTurns as number) : 1,
    allowInterruptions:
      typeof settings.allowInterruptions === "boolean"
        ? settings.allowInterruptions
        : false,
    seekCommonGround:
      typeof settings.seekCommonGround === "boolean"
        ? settings.seekCommonGround
        : false,
  };
}

export function validateTalkInput(value: unknown): ValidationResult {
  const issues: string[] = [];

  if (!isRecord(value)) {
    return { success: false, issues: ["Request body must be an object"] };
  }

  let participants: Participant[] = [];
  if (!Array.isArray(value.participants) || value.participants.length !== 5) {
    issues.push("participants must contain exactly five items");
  } else {
    participants = value.participants.map((participant, index) =>
      parseParticipant(participant, index, issues),
    );
  }

  let status: TalkStatus = "draft";
  if (value.status === "draft" || value.status === "ready") {
    status = value.status;
  } else {
    issues.push("status must be draft or ready");
  }

  const data: TalkInput = {
    title: requiredString(value.title, "title", issues),
    topic: requiredString(value.topic, "topic", issues),
    description: optionalString(value.description, "description", issues),
    language: requiredString(value.language, "language", issues),
    participants,
    status,
    settings: parseSettings(value.settings, issues),
  };

  return issues.length > 0
    ? { success: false, issues }
    : { success: true, data };
}
