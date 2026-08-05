import { NextResponse } from "next/server";

import { generateLlmJson, ProviderError } from "@/lib/llm-provider";
import { isLlmModelId, type LlmModelId } from "@/lib/llm-models";
import type { Participant } from "@/types/talk";

export const runtime = "nodejs";
export const maxDuration = 120;

type CastMode = "suggested" | "random";

interface GeneratedGuest {
  sex: "female" | "male";
  name: string;
  role: string;
  perspectivePrompt: string;
  goals: string;
  nonNegotiables: string;
  speakingStylePrompt: string;
  assertiveness: number;
  patience: number;
  interruptiveness: number;
  baselineTension: number;
}

interface GeneratedCast {
  participants: GeneratedGuest[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredText(value: unknown, maximum: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= maximum
    ? normalized
    : undefined;
}

function trait(value: unknown): number | undefined {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 100
    ? (value as number)
    : undefined;
}

function normalizeGuest(value: unknown): Participant | undefined {
  if (!isRecord(value)) return undefined;
  const sex = value.sex === "female" || value.sex === "male" ? value.sex : undefined;
  const name = requiredText(value.name, 100);
  const role = requiredText(value.role, 160);
  const perspectivePrompt = requiredText(value.perspectivePrompt, 1_200);
  const goals = requiredText(value.goals, 800);
  const nonNegotiables = requiredText(value.nonNegotiables, 800);
  const speakingStylePrompt = requiredText(value.speakingStylePrompt, 600);
  const assertiveness = trait(value.assertiveness);
  const patience = trait(value.patience);
  const interruptiveness = trait(value.interruptiveness);
  const baselineTension = trait(value.baselineTension);

  if (
    !sex ||
    !name ||
    !role ||
    !perspectivePrompt ||
    !goals ||
    !nonNegotiables ||
    !speakingStylePrompt ||
    assertiveness === undefined ||
    patience === undefined ||
    interruptiveness === undefined ||
    baselineTension === undefined
  ) {
    return undefined;
  }

  return {
    kind: "ai",
    sex,
    name,
    role,
    perspectiveMode: "custom",
    perspectivePrompt,
    goals,
    nonNegotiables,
    speakingStylePrompt,
    modelOverride: undefined,
    assertiveness,
    patience,
    interruptiveness,
    baselineTension,
  };
}

function castSchema(count: number): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      participants: {
        type: "array",
        minItems: count,
        maxItems: count,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            sex: { type: "string", enum: ["female", "male"] },
            name: { type: "string" },
            role: { type: "string" },
            perspectivePrompt: { type: "string" },
            goals: { type: "string" },
            nonNegotiables: { type: "string" },
            speakingStylePrompt: { type: "string" },
            assertiveness: { type: "integer", minimum: 0, maximum: 100 },
            patience: { type: "integer", minimum: 0, maximum: 100 },
            interruptiveness: { type: "integer", minimum: 0, maximum: 100 },
            baselineTension: { type: "integer", minimum: 0, maximum: 100 },
          },
          required: [
            "sex",
            "name",
            "role",
            "perspectivePrompt",
            "goals",
            "nonNegotiables",
            "speakingStylePrompt",
            "assertiveness",
            "patience",
            "interruptiveness",
            "baselineTension",
          ],
        },
      },
    },
    required: ["participants"],
  };
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!isRecord(body)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const mode: CastMode | undefined =
    body.mode === "suggested" || body.mode === "random" ? body.mode : undefined;
  const topic = requiredText(body.topic, 4_000);
  const title = requiredText(body.title, 300) ?? "Untitled talk";
  const language = requiredText(body.language, 80);
  const model: LlmModelId | undefined = isLlmModelId(body.model)
    ? body.model
    : undefined;
  const participantIndex =
    Number.isInteger(body.participantIndex) &&
    (body.participantIndex as number) >= 0 &&
    (body.participantIndex as number) <= 4
      ? (body.participantIndex as number)
      : undefined;

  if (!mode || !topic || !language || !model) {
    return NextResponse.json(
      { error: "mode, topic, language, and a supported model are required" },
      { status: 400 },
    );
  }

  const currentParticipants = Array.isArray(body.participants)
    ? body.participants
        .filter(isRecord)
        .map((participant) => ({
          sex:
            participant.sex === "female" || participant.sex === "male"
              ? participant.sex
              : undefined,
          name: typeof participant.name === "string" ? participant.name : "",
          role: typeof participant.role === "string" ? participant.role : "",
        }))
    : [];
  const count = participantIndex === undefined ? 5 : 1;
  const diversityDirection =
    mode === "random"
      ? "Make the result surprising and less conventional while remaining credible for this exact topic. Vary background, stance, temperament, and rhetorical style."
      : "Build a balanced, editorially credible studio cast with distinct expertise, interests, and positions that create meaningful disagreement without caricatures.";
  const rerollDirection =
    participantIndex === undefined
      ? "Generate exactly five guests as a coherent ensemble."
      : `Generate exactly one replacement for seat ${participantIndex + 1} with sex ${currentParticipants[participantIndex]?.sex ?? "female"}. Avoid duplicating these existing public identities: ${JSON.stringify(currentParticipants)}.`;

  try {
    const { data, generation } = await generateLlmJson<GeneratedCast>({
      model,
      schemaName: "conclavia_cast",
      schema: castSchema(count),
      maxOutputTokens: count === 5 ? 4_000 : 1_400,
      instructions: [
        "You are the casting editor for a serious live current-affairs talk show.",
        diversityDirection,
        rerollDirection,
        `Write every field in ${language}.`,
        "Use plausible fictional names, not celebrities or impersonations of real people.",
        "Set sex to female or male, keep the name and identity consistent with it, and use a natural mix across a full cast.",
        "Each perspective must state a stable position; goals must say what the guest wants to achieve; non-negotiables must identify their red lines; speaking style must be concrete and performable.",
        "Trait scores must meaningfully differ across the cast. Avoid five neutral personalities.",
      ].join("\n"),
      input: [
        `Episode title: ${title}`,
        `Central topic: ${topic}`,
        typeof body.description === "string" && body.description.trim()
          ? `Background: ${body.description.trim()}`
          : undefined,
      ]
        .filter(Boolean)
        .join("\n"),
    });

    if (!isRecord(data) || !Array.isArray(data.participants)) {
      throw new Error("Structured cast is missing participants");
    }
    const participants = data.participants.map(normalizeGuest);
    if (participants.length !== count || participants.some((item) => !item)) {
      throw new Error("Structured cast failed semantic validation");
    }

    return NextResponse.json({
      participants,
      provider: generation.provider,
      model: generation.model,
    });
  } catch (error) {
    const message =
      error instanceof ProviderError
        ? error.message
        : "The generated cast did not pass validation";
    console.error("Unable to generate cast", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
