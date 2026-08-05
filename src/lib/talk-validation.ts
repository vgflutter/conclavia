import type {
  ModeratorConfiguration,
  ModeratorKind,
  ModeratorStyle,
  Participant,
  ParticipantKind,
  PerspectiveMode,
  TalkInput,
  TalkSettings,
  TalkStatus,
} from "@/types/talk";
import {
  DEFAULT_LLM_MODEL,
  isLlmModelId,
  type LlmModelId,
} from "@/lib/llm-models";
import { MAX_RUN_TURNS } from "@/lib/talk-run-compatibility";

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

function optionalModelId(
  value: unknown,
  field: string,
  issues: string[],
): LlmModelId | undefined {
  const modelId = optionalString(value, field, issues);

  if (modelId === undefined) {
    return undefined;
  }

  if (!isLlmModelId(modelId)) {
    issues.push(`${field} must be one of the supported models`);
    return undefined;
  }

  return modelId;
}

function score(value: unknown, field: string, issues: string[]): number {
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 100) {
    issues.push(`${field} must be an integer from 0 to 100`);
    return 0;
  }

  return value as number;
}

function participantKind(
  value: unknown,
  field: string,
  issues: string[],
): ParticipantKind {
  if (value === undefined || value === "ai") {
    return "ai";
  }

  if (value === "human" || value === "unassigned") {
    return value;
  }

  issues.push(`${field} must be ai, human, or unassigned`);
  return "ai";
}

function perspectiveMode(
  value: unknown,
  field: string,
  issues: string[],
): PerspectiveMode {
  if (value === undefined || value === "custom") {
    return "custom";
  }

  if (value === "automatic" || value === "random") {
    return value;
  }

  issues.push(`${field} must be custom, automatic, or random`);
  return "custom";
}

function perspectivePrompt(
  value: unknown,
  mode: PerspectiveMode,
  field: string,
  issues: string[],
): string {
  if (mode === "custom") {
    return requiredString(value, field, issues);
  }

  if (value === undefined || value === null || value === "") {
    return "";
  }

  if (typeof value !== "string") {
    issues.push(`${field} must be a string`);
    return "";
  }

  return value.trim();
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

  const mode = perspectiveMode(
    participant.perspectiveMode,
    `${field}.perspectiveMode`,
    issues,
  );
  const kind = participantKind(participant.kind, `${field}.kind`, issues);
  const name =
    kind === "unassigned"
      ? optionalString(participant.name, `${field}.name`, issues) ?? ""
      : requiredString(participant.name, `${field}.name`, issues);
  const role =
    kind === "unassigned"
      ? optionalString(participant.role, `${field}.role`, issues) ?? ""
      : requiredString(participant.role, `${field}.role`, issues);

  return {
    kind,
    name,
    role,
    perspectiveMode: kind === "ai" ? mode : "custom",
    perspectivePrompt:
      kind === "ai"
        ? perspectivePrompt(
            participant.perspectivePrompt,
            mode,
            `${field}.perspectivePrompt`,
            issues,
          )
        : kind === "human"
          ? optionalString(
              participant.perspectivePrompt,
              `${field}.perspectivePrompt`,
              issues,
            ) ?? ""
          : "",
    speakingStylePrompt:
      kind === "ai"
        ? optionalString(
            participant.speakingStylePrompt,
            `${field}.speakingStylePrompt`,
            issues,
          )
        : undefined,
    modelOverride:
      kind === "ai"
        ? optionalModelId(
            participant.modelOverride,
            `${field}.modelOverride`,
            issues,
          )
        : undefined,
    assertiveness: score(
      participant.assertiveness ?? 50,
      `${field}.assertiveness`,
      issues,
    ),
    patience: score(participant.patience ?? 50, `${field}.patience`, issues),
    interruptiveness: score(
      participant.interruptiveness ?? 20,
      `${field}.interruptiveness`,
      issues,
    ),
    baselineTension: score(
      participant.baselineTension ?? 20,
      `${field}.baselineTension`,
      issues,
    ),
  };
}

function parseModerator(
  value: unknown,
  issues: string[],
): ModeratorConfiguration {
  if (value === undefined) {
    return {
      kind: "none",
      style: "neutral",
      canInterrupt: true,
      manageTime: true,
      summarizeAtEnd: true,
    };
  }

  const moderator = isRecord(value) ? value : {};
  if (!isRecord(value)) {
    issues.push("moderator must be an object");
  }

  let kind: ModeratorKind = "none";
  if (moderator.kind === "ai" || moderator.kind === "human") {
    kind = moderator.kind;
  } else if (moderator.kind !== undefined && moderator.kind !== "none") {
    issues.push("moderator.kind must be none, ai, or human");
  }

  let style: ModeratorStyle = "neutral";
  if (
    moderator.style === "challenging" ||
    moderator.style === "facilitating"
  ) {
    style = moderator.style;
  } else if (moderator.style !== undefined && moderator.style !== "neutral") {
    issues.push("moderator.style must be neutral, challenging, or facilitating");
  }

  function moderatorBoolean(
    field: "canInterrupt" | "manageTime" | "summarizeAtEnd",
    fallback: boolean,
  ): boolean {
    const fieldValue = moderator[field];
    if (fieldValue === undefined) {
      return fallback;
    }
    if (typeof fieldValue !== "boolean") {
      issues.push(`moderator.${field} must be a boolean`);
      return fallback;
    }
    return fieldValue;
  }

  return {
    kind,
    name:
      kind === "none"
        ? undefined
        : requiredString(moderator.name, "moderator.name", issues),
    role:
      kind === "none"
        ? undefined
        : optionalString(moderator.role, "moderator.role", issues),
    instructions:
      kind === "none"
        ? undefined
        : optionalString(
            moderator.instructions,
            "moderator.instructions",
            issues,
          ),
    style,
    modelOverride:
      kind === "ai"
        ? optionalModelId(
            moderator.modelOverride,
            "moderator.modelOverride",
            issues,
          )
        : undefined,
    canInterrupt: moderatorBoolean("canInterrupt", true),
    manageTime: moderatorBoolean("manageTime", true),
    summarizeAtEnd: moderatorBoolean("summarizeAtEnd", true),
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
  } else if ((maxTurns as number) > MAX_RUN_TURNS) {
    issues.push(`settings.maxTurns must not exceed ${MAX_RUN_TURNS}`);
  }

  const targetDurationMinutes = settings.targetDurationMinutes ?? 30;
  if (
    !Number.isInteger(targetDurationMinutes) ||
    (targetDurationMinutes as number) < 1
  ) {
    issues.push("settings.targetDurationMinutes must be a positive integer");
  }

  const rawDefaultModel =
    settings.defaultModel === undefined || settings.defaultModel === "auto"
      ? DEFAULT_LLM_MODEL
      : settings.defaultModel;
  const defaultModel = isLlmModelId(rawDefaultModel)
    ? rawDefaultModel
    : DEFAULT_LLM_MODEL;

  if (!isLlmModelId(rawDefaultModel)) {
    issues.push("settings.defaultModel must be one of the supported models");
  }

  if (typeof settings.allowInterruptions !== "boolean") {
    issues.push("settings.allowInterruptions must be a boolean");
  }

  if (typeof settings.seekCommonGround !== "boolean") {
    issues.push("settings.seekCommonGround must be a boolean");
  }

  return {
    maxTurns: Number.isInteger(maxTurns) ? (maxTurns as number) : 1,
    targetDurationMinutes: Number.isInteger(targetDurationMinutes)
      ? (targetDurationMinutes as number)
      : 30,
    defaultModel,
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

  if (
    status === "ready" &&
    participants.some((participant) => participant.kind === "unassigned")
  ) {
    issues.push("ready talks cannot contain unassigned participants");
  }

  const data: TalkInput = {
    title: requiredString(value.title, "title", issues),
    topic: requiredString(value.topic, "topic", issues),
    description: optionalString(value.description, "description", issues),
    language: requiredString(value.language, "language", issues),
    participants,
    moderator: parseModerator(value.moderator, issues),
    status,
    settings: parseSettings(value.settings, issues),
  };

  return issues.length > 0
    ? { success: false, issues }
    : { success: true, data };
}
