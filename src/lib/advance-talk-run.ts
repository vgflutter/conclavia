import "server-only";

import { Types } from "mongoose";

import {
  chooseNextTurn,
  createInitialDiscussionState,
  estimateAirtimeSeconds,
  minimumMeaningfulTurns,
  shouldReviewAfterTurn,
  updateDiscussionState,
} from "@/lib/talk-director";
import { reviewEditorialArc } from "@/lib/talk-editorial-review";
import { getLlmModel } from "@/lib/llm-models";
import {
  generateLlmTextStream,
  ProviderError,
  type GenerationResult,
} from "@/lib/llm-provider";
import { connectToDatabase } from "@/lib/mongodb";
import { serializeTalk } from "@/lib/serialize-talk";
import { serializeTalkRun } from "@/lib/serialize-talk-run";
import { getTalkRunBlockCode } from "@/lib/talk-run-compatibility";
import { buildTurnPrompt } from "@/lib/talk-run-prompt";
import { TalkModel } from "@/models/Talk";
import {
  TalkRunModel,
  type TalkRunDocument,
  type TalkRunPreparedTurnRecord,
} from "@/models/TalkRun";
import type { TalkResponse } from "@/types/talk";
import type {
  TalkRunDiscussionState,
  TalkRunMessageResponse,
  TalkRunPhase,
  TalkRunResponse,
  TalkRunIntent,
  TalkRunTurnPlan,
} from "@/types/talk-run";

export class AdvanceTalkRunError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly run?: TalkRunResponse,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "AdvanceTalkRunError";
  }
}

interface AdvanceHooks {
  onPlan?: (plan: TalkRunTurnPlan) => void | Promise<void>;
  onDelta?: (delta: string) => void | Promise<void>;
  onPreparing?: (plan: TalkRunTurnPlan) => void | Promise<void>;
  onPrepared?: (plan: TalkRunTurnPlan) => void | Promise<void>;
  onEditorialReviewStarted?: () => void | Promise<void>;
  onEditorialReviewCompleted?: (
    state: TalkRunDiscussionState,
  ) => void | Promise<void>;
  onSpeechReady?: (
    message: TalkRunMessageResponse,
  ) => void | Promise<void>;
  onTurnSaved?: (run: TalkRunResponse) => void | Promise<void>;
}

interface AdvanceOptions {
  prepareNext?: boolean;
  signal?: AbortSignal;
}

interface RunTransition {
  phase: TalkRunPhase;
  participantTurnCount: number;
  nextParticipantIndex: number;
  estimatedAirtimeSeconds: number;
  completed: boolean;
}

async function failRun(
  run: TalkRunDocument,
  message: string,
): Promise<TalkRunDocument> {
  return (
    (await TalkRunModel.findByIdAndUpdate(
      run._id,
      {
        $set: { status: "failed", error: message },
        $unset: {
          generationStartedAt: 1,
          activeTurn: 1,
          preparedTurn: 1,
        },
      },
      { new: true },
    ).exec()) ?? run
  );
}

function completeInitialState(
  current: TalkRunDiscussionState,
  fallback: TalkRunDiscussionState,
): TalkRunDiscussionState {
  return {
    arcPhase: current.arcPhase ?? fallback.arcPhase,
    centralQuestion: current.centralQuestion || fallback.centralQuestion,
    phaseObjective: current.phaseObjective || fallback.phaseObjective,
    currentFocus: current.currentFocus || fallback.currentFocus,
    corePositions: current.corePositions ?? [],
    keyConflict: current.keyConflict ?? "",
    contestedClaims: current.contestedClaims ?? [],
    evidenceAndTradeoffs: current.evidenceAndTradeoffs ?? [],
    openQuestions: current.openQuestions ?? [],
    agreements: current.agreements ?? [],
    unresolvedConflicts: current.unresolvedConflicts ?? [],
    turningPoints: current.turningPoints ?? [],
    floorQueue: current.floorQueue ?? [],
    conclusionReadiness:
      current.conclusionReadiness ?? fallback.conclusionReadiness,
    conclusionReason:
      current.conclusionReason || fallback.conclusionReason,
    conclusion: current.conclusion,
    editorialReviewCount: current.editorialReviewCount ?? 0,
    editorialInputTokens: current.editorialInputTokens ?? 0,
    editorialOutputTokens: current.editorialOutputTokens ?? 0,
    participantMemories: fallback.participantMemories.map((emptyMemory) => {
      const existing = current.participantMemories?.find(
        (memory) => memory.participantIndex === emptyMemory.participantIndex,
      );
      return existing ?? emptyMemory;
    }),
  };
}

function normalizePlan(plan: TalkRunTurnPlan): TalkRunTurnPlan {
  return {
    speakerType: plan.speakerType,
    participantIndex: plan.participantIndex,
    speakerName: plan.speakerName,
    speakerRole: plan.speakerRole,
    intent: plan.intent,
    targetParticipantIndex: plan.targetParticipantIndex,
    targetSpeakerName: plan.targetSpeakerName,
    threadLabel: plan.threadLabel,
    arcPhase: plan.arcPhase ?? "positions",
    preparationMode: plan.preparationMode ?? "reactive",
    referenceStyle: plan.referenceStyle ?? "idea_first",
    minWords: plan.minWords,
    maxWords: plan.maxWords,
  };
}

function modelForPlan(talk: TalkResponse, plan: TalkRunTurnPlan) {
  return plan.speakerType === "moderator"
    ? talk.moderator.modelOverride ?? talk.settings.defaultModel
    : talk.participants[plan.participantIndex ?? 0].modelOverride ??
        talk.settings.defaultModel;
}

function planIsHuman(talk: TalkResponse, plan: TalkRunTurnPlan): boolean {
  return plan.speakerType === "moderator"
    ? talk.moderator.kind === "human"
    : talk.participants[plan.participantIndex ?? 0]?.kind === "human";
}

function requestWasAborted(error: unknown, signal?: AbortSignal): boolean {
  return (
    signal?.aborted === true ||
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

function transitionAfterTurn(
  talk: TalkResponse,
  run: TalkRunResponse,
  plan: TalkRunTurnPlan,
  discussionState: TalkRunDiscussionState,
  interventionAirtimeSeconds: number,
): RunTransition {
  let phase = run.phase;
  let participantTurnCount = run.participantTurnCount;
  let nextParticipantIndex = run.nextParticipantIndex;
  const estimatedAirtimeSeconds =
    run.estimatedAirtimeSeconds + interventionAirtimeSeconds;

  if (plan.intent === "opening") {
    phase = "discussion";
  } else if (plan.intent === "closing") {
    phase = "completed";
  } else if (plan.speakerType === "participant") {
    participantTurnCount += 1;
    nextParticipantIndex = ((plan.participantIndex ?? 0) + 1) % 5;
    const hardLimitReached =
      participantTurnCount >= run.maxTurns ||
      estimatedAirtimeSeconds >= run.targetDurationMinutes * 60;
    const semanticConclusionReached =
      participantTurnCount >= minimumMeaningfulTurns(run.maxTurns) &&
      (discussionState.conclusionReadiness === "ready" ||
        discussionState.conclusionReadiness === "forced");
    if (hardLimitReached || semanticConclusionReached) {
      const hasAiClosingVoice =
        (talk.moderator.kind === "ai" && talk.moderator.summarizeAtEnd) ||
        (talk.moderator.kind === "none" &&
          talk.participants.some((participant) => participant.kind === "ai"));
      phase = hasAiClosingVoice ? "closing" : "completed";
    }
  } else {
    phase = "discussion";
  }

  return {
    phase,
    participantTurnCount,
    nextParticipantIndex,
    estimatedAirtimeSeconds,
    completed: phase === "completed",
  };
}

function projectedRunAfterTurn(
  talk: TalkResponse,
  run: TalkRunResponse,
  plan: TalkRunTurnPlan,
  content: string,
  generation: Pick<GenerationResult, "provider" | "model">,
  origin: "ai" | "human" = "ai",
): TalkRunResponse {
  const wordCount = content.split(/\s+/u).filter(Boolean).length;
  const estimatedAirtime = estimateAirtimeSeconds(wordCount, plan.speakerType);
  const discussionState = updateDiscussionState(
    run.discussionState,
    plan,
    content,
    run.messages.length + 1,
  );
  const transition = transitionAfterTurn(
    talk,
    run,
    plan,
    discussionState,
    estimatedAirtime,
  );
  const now = new Date().toISOString();
  const message: TalkRunMessageResponse = {
    sequence: run.messages.length + 1,
    speakerType: plan.speakerType,
    participantIndex: plan.participantIndex,
    speakerName: plan.speakerName,
    speakerRole: plan.speakerRole,
    intent: plan.intent,
    targetParticipantIndex: plan.targetParticipantIndex,
    targetSpeakerName: plan.targetSpeakerName,
    threadLabel: plan.threadLabel,
    arcPhase: plan.arcPhase,
    preparationMode: plan.preparationMode,
    referenceStyle: plan.referenceStyle,
    wordCount,
    estimatedAirtimeSeconds: estimatedAirtime,
    origin,
    provider: origin === "ai" ? generation.provider : undefined,
    model: origin === "ai" ? generation.model : undefined,
    content,
    createdAt: now,
  };

  return {
    ...run,
    status: transition.completed ? "completed" : "idle",
    phase: transition.phase,
    participantTurnCount: transition.participantTurnCount,
    nextParticipantIndex: transition.nextParticipantIndex,
    estimatedAirtimeSeconds: transition.estimatedAirtimeSeconds,
    activeTurn: undefined,
    hasPreparedTurn: false,
    discussionState,
    messages: [...run.messages, message],
    completedAt: transition.completed ? now : undefined,
    updatedAt: now,
  };
}

async function prepareTurnFromProjectedRun(
  talk: TalkResponse,
  projected: TalkRunResponse,
  hooks: AdvanceHooks,
  speculative: boolean,
  allowClosing: boolean,
  signal?: AbortSignal,
): Promise<TalkRunPreparedTurnRecord | undefined> {
  if (projected.phase === "completed") {
    return undefined;
  }

  const nextPlan = chooseNextTurn(talk, projected);
  if (!nextPlan || (!allowClosing && nextPlan.intent === "closing")) {
    return undefined;
  }
  if (
    (nextPlan.speakerType === "participant" &&
      talk.participants[nextPlan.participantIndex ?? 0]?.kind === "human") ||
    (nextPlan.speakerType === "moderator" && talk.moderator.kind === "human")
  ) {
    return undefined;
  }

  await hooks.onPreparing?.(nextPlan);
  const nextModel = modelForPlan(talk, nextPlan);
  const prompt = buildTurnPrompt(talk, projected, nextPlan, {
    speculative,
  });
  const generation = await generateLlmTextStream({
    model: nextModel,
    ...prompt,
    maxOutputTokens: Math.max(800, nextPlan.maxWords * 5),
    signal,
  });
  await hooks.onPrepared?.(nextPlan);

  return {
    basedOnSequence: projected.messages.length,
    plan: nextPlan,
    provider: generation.provider,
    model: generation.model,
    content: generation.content,
    inputTokens: generation.inputTokens,
    outputTokens: generation.outputTokens,
    createdAt: new Date(),
  };
}

async function prepareFollowingTurn(
  talk: TalkResponse,
  runBeforeCurrent: TalkRunResponse,
  currentPlan: TalkRunTurnPlan,
  partialContent: string,
  currentModel: GenerationResult["model"],
  hooks: AdvanceHooks,
  signal?: AbortSignal,
): Promise<TalkRunPreparedTurnRecord | undefined> {
  const currentProvider = getLlmModel(currentModel).provider;
  const projected = projectedRunAfterTurn(
    talk,
    runBeforeCurrent,
    currentPlan,
    partialContent,
    { provider: currentProvider, model: currentModel },
  );
  return prepareTurnFromProjectedRun(
    talk,
    projected,
    hooks,
    true,
    false,
    signal,
  );
}

async function replayPreparedText(
  content: string,
  onDelta: (delta: string) => Promise<void>,
): Promise<void> {
  const chunks = content.match(/(?:\S+\s*){1,3}/gu) ?? [content];
  for (const chunk of chunks) {
    await onDelta(chunk);
    await new Promise((resolve) => setTimeout(resolve, 4));
  }
}

function fallbackEditorialState(
  talk: TalkResponse,
  run: TalkRunResponse,
): TalkRunDiscussionState {
  const hardLimitReached =
    run.participantTurnCount >= run.maxTurns ||
    run.estimatedAirtimeSeconds >= run.targetDurationMinutes * 60;
  const progress = Math.max(
    run.participantTurnCount / run.maxTurns,
    run.estimatedAirtimeSeconds / (run.targetDurationMinutes * 60),
  );
  const arcPhase = hardLimitReached
    ? "conclusion"
    : progress >= 0.75
      ? "synthesis"
      : progress >= 0.5
        ? "examination"
        : progress >= 0.25
          ? "conflict"
          : "positions";
  const italian = talk.language.toLocaleLowerCase().startsWith("ital");
  const answer = italian
    ? "Il limite editoriale è stato raggiunto: il confronto chiarisce le posizioni disponibili senza forzare un accordo non emerso."
    : "The editorial limit was reached: the exchange clarifies the available positions without forcing an agreement that did not emerge.";

  return {
    ...run.discussionState,
    arcPhase,
    phaseObjective: hardLimitReached
      ? italian
        ? "Separare ciò che è emerso dal conflitto che resta aperto."
        : "Separate what was established from the conflict that remains open."
      : run.discussionState.phaseObjective,
    conclusionReadiness: hardLimitReached ? "forced" : "developing",
    conclusionReason: hardLimitReached
      ? italian
        ? "Raggiunto il numero massimo di interventi."
        : "The maximum number of interventions was reached."
      : run.discussionState.conclusionReason,
    conclusion: hardLimitReached
      ? {
          kind:
            run.discussionState.unresolvedConflicts.length > 0
              ? "clarified_disagreement"
              : "open",
          answer,
          agreements: run.discussionState.agreements,
          disagreements: run.discussionState.unresolvedConflicts,
          conditions: [],
          openQuestions: run.discussionState.openQuestions,
        }
      : run.discussionState.conclusion,
  };
}

export interface HumanTurnInput {
  content: string;
  intent?: TalkRunIntent;
  targetParticipantIndex?: number;
  threadLabel?: string;
}

function humanIntent(
  plan: TalkRunTurnPlan,
  requested: TalkRunIntent | undefined,
): TalkRunIntent {
  if (!requested) return plan.intent;
  if (plan.speakerType === "moderator") {
    if (plan.intent === "opening" || plan.intent === "closing") return plan.intent;
    return requested === "question" || requested === "moderation"
      ? requested
      : plan.intent;
  }
  return [
    "argument",
    "reply",
    "challenge",
    "question",
    "answer",
    "clarification",
    "partial_agreement",
    "interruption",
  ].includes(requested)
    ? requested
    : plan.intent;
}

export async function submitHumanTalkRunTurn(
  id: string,
  input: HumanTurnInput,
): Promise<TalkRunResponse> {
  if (!Types.ObjectId.isValid(id)) {
    throw new AdvanceTalkRunError("Talk run not found", 404);
  }

  await connectToDatabase();
  const claimed = await TalkRunModel.findOneAndUpdate(
    { _id: id, status: "waiting_for_human", activeTurn: { $exists: true } },
    { $set: { status: "generating", generationStartedAt: new Date() } },
    { new: true },
  ).exec();
  if (!claimed?.activeTurn) {
    const current = await TalkRunModel.findById(id).exec();
    throw new AdvanceTalkRunError(
      current ? "No human intervention is currently expected" : "Talk run not found",
      current ? 409 : 404,
      current ? serializeTalkRun(current) : undefined,
    );
  }

  try {
    const talkDocument = claimed.talkSnapshot
      ? null
      : await TalkModel.findById(claimed.talkId).exec();
    if (!claimed.talkSnapshot && !talkDocument) {
      throw new Error("The source talk no longer exists");
    }
    const talk = claimed.talkSnapshot ?? serializeTalk(talkDocument!);
    const basePlan = normalizePlan(claimed.activeTurn);
    if (!planIsHuman(talk, basePlan)) {
      throw new AdvanceTalkRunError(
        "The expected speaker is not human",
        409,
        serializeTalkRun(claimed),
      );
    }

    const targetParticipantIndex =
      input.targetParticipantIndex !== undefined &&
      input.targetParticipantIndex >= 0 &&
      input.targetParticipantIndex < talk.participants.length &&
      input.targetParticipantIndex !== basePlan.participantIndex
        ? input.targetParticipantIndex
        : basePlan.targetParticipantIndex;
    const plan: TalkRunTurnPlan = {
      ...basePlan,
      intent: humanIntent(basePlan, input.intent),
      targetParticipantIndex,
      targetSpeakerName:
        targetParticipantIndex === undefined
          ? basePlan.targetSpeakerName
          : talk.participants[targetParticipantIndex]?.name,
      threadLabel: input.threadLabel?.trim() || basePlan.threadLabel,
      preparationMode: "reactive",
    };
    const run: TalkRunResponse = {
      ...serializeTalkRun(claimed),
      discussionState: completeInitialState(
        serializeTalkRun(claimed).discussionState,
        createInitialDiscussionState(talk),
      ),
    };
    const placeholderAttribution = {
      provider: getLlmModel(talk.settings.defaultModel).provider,
      model: talk.settings.defaultModel,
    };
    let projected = projectedRunAfterTurn(
      talk,
      run,
      plan,
      input.content,
      placeholderAttribution,
      "human",
    );
    let discussionState = projected.discussionState;
    if (shouldReviewAfterTurn(run, plan)) {
      try {
        discussionState = (await reviewEditorialArc(talk, projected)).state;
      } catch (error) {
        console.error(
          "Editorial review after human turn failed",
          error instanceof Error ? error.message : "unknown error",
        );
        discussionState = fallbackEditorialState(talk, projected);
      }
    }

    const airtime = projected.estimatedAirtimeSeconds - run.estimatedAirtimeSeconds;
    const transition = transitionAfterTurn(
      talk,
      run,
      plan,
      discussionState,
      airtime,
    );
    projected = {
      ...projected,
      status: transition.completed ? "completed" : "idle",
      phase: transition.phase,
      participantTurnCount: transition.participantTurnCount,
      nextParticipantIndex: transition.nextParticipantIndex,
      estimatedAirtimeSeconds: transition.estimatedAirtimeSeconds,
      discussionState,
    };

    const wordCount = input.content.split(/\s+/u).filter(Boolean).length;
    const saved = await TalkRunModel.findByIdAndUpdate(
      claimed._id,
      {
        $push: {
          messages: {
            sequence: claimed.messages.length + 1,
            speakerType: plan.speakerType,
            participantIndex: plan.participantIndex,
            speakerName: plan.speakerName,
            speakerRole: plan.speakerRole,
            intent: plan.intent,
            targetParticipantIndex: plan.targetParticipantIndex,
            targetSpeakerName: plan.targetSpeakerName,
            threadLabel: plan.threadLabel,
            arcPhase: plan.arcPhase,
            preparationMode: plan.preparationMode,
            referenceStyle: plan.referenceStyle,
            wordCount,
            estimatedAirtimeSeconds: airtime,
            origin: "human",
            content: input.content,
            createdAt: new Date(),
          },
        },
        $set: {
          status: transition.completed ? "completed" : "idle",
          phase: transition.phase,
          participantTurnCount: transition.participantTurnCount,
          nextParticipantIndex: transition.nextParticipantIndex,
          estimatedAirtimeSeconds: transition.estimatedAirtimeSeconds,
          discussionState,
          ...(transition.completed ? { completedAt: new Date() } : {}),
        },
        $unset: {
          generationStartedAt: 1,
          activeTurn: 1,
          preparedTurn: 1,
          error: 1,
        },
      },
      { new: true },
    ).exec();
    if (!saved) throw new Error("Talk run disappeared while saving the human turn");
    return serializeTalkRun(saved);
  } catch (error) {
    if (error instanceof AdvanceTalkRunError) {
      await TalkRunModel.updateOne(
        { _id: claimed._id },
        {
          $set: { status: "waiting_for_human" },
          $unset: { generationStartedAt: 1 },
        },
      ).exec();
      throw error;
    }
    const failed = await failRun(
      claimed,
      error instanceof Error ? error.message : "Unable to save human intervention",
    );
    throw new AdvanceTalkRunError(
      failed.error ?? "Unable to save human intervention",
      500,
      serializeTalkRun(failed),
    );
  }
}

export async function advanceTalkRun(
  id: string,
  hooks: AdvanceHooks = {},
  options: AdvanceOptions = {},
): Promise<TalkRunResponse> {
  if (!Types.ObjectId.isValid(id)) {
    throw new AdvanceTalkRunError("Talk run not found", 404);
  }

  await connectToDatabase();
  const claimed = await TalkRunModel.findOneAndUpdate(
    { _id: id, status: { $in: ["idle", "failed"] } },
    {
      $set: { status: "generating", generationStartedAt: new Date() },
      $unset: { error: 1, activeTurn: 1 },
    },
    { new: true },
  ).exec();

  if (!claimed) {
    const current = await TalkRunModel.findById(id).exec();
    if (!current) throw new AdvanceTalkRunError("Talk run not found", 404);
    const serialized = serializeTalkRun(current);
    if (current.status === "completed") return serialized;
    throw new AdvanceTalkRunError(
      "A turn is already being generated",
      409,
      serialized,
    );
  }

  try {
    const talkDocument = claimed.talkSnapshot
      ? null
      : await TalkModel.findById(claimed.talkId).exec();
    if (!claimed.talkSnapshot && !talkDocument) {
      const failed = await failRun(claimed, "The source talk no longer exists");
      throw new AdvanceTalkRunError(
        failed.error ?? "Talk not found",
        409,
        serializeTalkRun(failed),
      );
    }

    const talk = claimed.talkSnapshot ?? serializeTalk(talkDocument!);
    if (!claimed.talkSnapshot) {
      claimed.talkSnapshot = talk;
      await TalkRunModel.updateOne(
        { _id: claimed._id },
        { $set: { talkSnapshot: talk } },
      ).exec();
    }
    const blockCode = getTalkRunBlockCode(talk);
    if (blockCode) {
      const failed = await failRun(
        claimed,
        "The talk configuration is no longer supported by this runner",
      );
      throw new AdvanceTalkRunError(
        failed.error ?? "Talk configuration is not runnable",
        409,
        serializeTalkRun(failed),
        blockCode,
      );
    }

    let run = serializeTalkRun(claimed);
    run = {
      ...run,
      discussionState: completeInitialState(
        run.discussionState,
        createInitialDiscussionState(talk),
      ),
    };

    const storedPrepared =
      claimed.preparedTurn?.basedOnSequence === claimed.messages.length
        ? claimed.preparedTurn
        : undefined;
    const plan = storedPrepared
      ? normalizePlan(storedPrepared.plan)
      : chooseNextTurn(talk, run);

    if (!plan) {
      const completed = await TalkRunModel.findByIdAndUpdate(
        claimed._id,
        {
          $set: {
            status: "completed",
            phase: "completed",
            completedAt: new Date(),
          },
          $unset: {
            generationStartedAt: 1,
            activeTurn: 1,
            preparedTurn: 1,
            error: 1,
          },
        },
        { new: true },
      ).exec();
      return serializeTalkRun(completed ?? claimed);
    }

    await TalkRunModel.updateOne(
      { _id: claimed._id, status: "generating" },
      { $set: { activeTurn: plan, discussionState: run.discussionState } },
    ).exec();
    await hooks.onPlan?.(plan);

    if (planIsHuman(talk, plan)) {
      const waiting = await TalkRunModel.findByIdAndUpdate(
        claimed._id,
        {
          $set: {
            status: "waiting_for_human",
            activeTurn: plan,
            discussionState: run.discussionState,
          },
          $unset: {
            generationStartedAt: 1,
            preparedTurn: 1,
            error: 1,
          },
        },
        { new: true },
      ).exec();
      return serializeTalkRun(waiting ?? claimed);
    }

    const model = storedPrepared?.model ?? modelForPlan(talk, plan);
    const editorialReviewNeeded = shouldReviewAfterTurn(run, plan);
    let streamedContent = "";
    let preparationPromise:
      | Promise<TalkRunPreparedTurnRecord | undefined>
      | undefined;
    const startPreparation = () => {
      if (
        preparationPromise ||
        options.prepareNext !== true ||
        editorialReviewNeeded ||
        plan.intent === "closing"
      ) {
        return;
      }

      preparationPromise = prepareFollowingTurn(
        talk,
        run,
        plan,
        streamedContent.trim(),
        model,
        hooks,
        options.signal,
      ).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "unknown error";
        console.error("Speculative turn preparation failed", message);
        return undefined;
      });
    };
    const preparationThreshold = Math.max(
      10,
      Math.min(24, Math.round(plan.minWords * 0.45)),
    );
    const emitDelta = async (delta: string) => {
      streamedContent += delta;
      await hooks.onDelta?.(delta);
      if (
        streamedContent.split(/\s+/u).filter(Boolean).length >=
        preparationThreshold
      ) {
        startPreparation();
      }
    };

    let generation: GenerationResult;
    if (storedPrepared) {
      generation = {
        content: storedPrepared.content,
        provider: storedPrepared.provider,
        model: storedPrepared.model,
        inputTokens: storedPrepared.inputTokens,
        outputTokens: storedPrepared.outputTokens,
      };
      await replayPreparedText(generation.content, emitDelta);
    } else {
      const prompt = buildTurnPrompt(talk, run, plan);
      generation = await generateLlmTextStream(
        {
          model,
          ...prompt,
          maxOutputTokens: Math.max(800, plan.maxWords * 5),
          signal: options.signal,
        },
        emitDelta,
      );
    }

    if (!preparationPromise && !editorialReviewNeeded) startPreparation();

    let projected = projectedRunAfterTurn(
      talk,
      run,
      plan,
      generation.content,
      generation,
    );
    let discussionState = projected.discussionState;
    if (editorialReviewNeeded) {
      const generatedMessage = projected.messages.at(-1);
      if (generatedMessage) await hooks.onSpeechReady?.(generatedMessage);
      await hooks.onEditorialReviewStarted?.();
      try {
        const review = await reviewEditorialArc(talk, projected);
        discussionState = review.state;
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown error";
        console.error("Editorial review failed", message);
        discussionState = fallbackEditorialState(talk, projected);
      }
      await hooks.onEditorialReviewCompleted?.(discussionState);
    }

    const interventionAirtime =
      projected.estimatedAirtimeSeconds - run.estimatedAirtimeSeconds;
    const transition = transitionAfterTurn(
      talk,
      run,
      plan,
      discussionState,
      interventionAirtime,
    );
    projected = {
      ...projected,
      status: transition.completed ? "completed" : "idle",
      phase: transition.phase,
      participantTurnCount: transition.participantTurnCount,
      nextParticipantIndex: transition.nextParticipantIndex,
      estimatedAirtimeSeconds: transition.estimatedAirtimeSeconds,
      discussionState,
      completedAt: transition.completed
        ? new Date().toISOString()
        : undefined,
    };

    if (
      editorialReviewNeeded &&
      options.prepareNext === true &&
      !transition.completed
    ) {
      preparationPromise = prepareTurnFromProjectedRun(
        talk,
        projected,
        hooks,
        false,
        true,
        options.signal,
      ).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "unknown error";
        console.error("Post-review turn preparation failed", message);
        return undefined;
      });
    }
    const wordCount = generation.content.split(/\s+/u).filter(Boolean).length;
    const estimatedAirtime = estimateAirtimeSeconds(wordCount, plan.speakerType);
    const waitingForPreparation = Boolean(preparationPromise);
    const savedCurrent = await TalkRunModel.findByIdAndUpdate(
      claimed._id,
      {
        $push: {
          messages: {
            sequence: claimed.messages.length + 1,
            speakerType: plan.speakerType,
            participantIndex: plan.participantIndex,
            speakerName: plan.speakerName,
            speakerRole: plan.speakerRole,
            intent: plan.intent,
            targetParticipantIndex: plan.targetParticipantIndex,
            targetSpeakerName: plan.targetSpeakerName,
            threadLabel: plan.threadLabel,
            arcPhase: plan.arcPhase,
            preparationMode: plan.preparationMode,
            referenceStyle: plan.referenceStyle,
            wordCount,
            estimatedAirtimeSeconds: estimatedAirtime,
            origin: "ai",
            provider: generation.provider,
            model: generation.model,
            content: generation.content,
            inputTokens: generation.inputTokens,
            outputTokens: generation.outputTokens,
            createdAt: new Date(),
          },
        },
        $set: {
          status: transition.completed
            ? "completed"
            : waitingForPreparation
              ? "generating"
              : "idle",
          phase: transition.phase,
          participantTurnCount: transition.participantTurnCount,
          nextParticipantIndex: transition.nextParticipantIndex,
          estimatedAirtimeSeconds: transition.estimatedAirtimeSeconds,
          discussionState,
          ...(transition.completed ? { completedAt: new Date() } : {}),
        },
        $unset: {
          activeTurn: 1,
          preparedTurn: 1,
          error: 1,
          ...(waitingForPreparation && !transition.completed
            ? {}
            : { generationStartedAt: 1 }),
        },
      },
      { new: true },
    ).exec();

    if (!savedCurrent) {
      throw new Error("Talk run disappeared while saving the turn");
    }
    await hooks.onTurnSaved?.(serializeTalkRun(savedCurrent));

    const prepared = transition.completed
      ? undefined
      : await preparationPromise;
    const finalized = await TalkRunModel.findByIdAndUpdate(
      claimed._id,
      {
        ...(prepared ? { $set: { status: "idle", preparedTurn: prepared } } : { $set: { status: transition.completed ? "completed" : "idle" } }),
        $unset: { generationStartedAt: 1, activeTurn: 1, error: 1 },
      },
      { new: true },
    ).exec();

    if (!finalized) {
      throw new Error("Talk run disappeared while finalizing preparation");
    }
    return serializeTalkRun(finalized);
  } catch (error) {
    if (error instanceof AdvanceTalkRunError) throw error;

    if (requestWasAborted(error, options.signal)) {
      const released = await TalkRunModel.findByIdAndUpdate(
        claimed._id,
        {
          $set: { status: "idle" },
          $unset: {
            generationStartedAt: 1,
            activeTurn: 1,
            error: 1,
          },
        },
        { new: true },
      ).exec();
      throw new AdvanceTalkRunError(
        "Generation cancelled",
        499,
        serializeTalkRun(released ?? claimed),
        "cancelled",
      );
    }

    const message =
      error instanceof ProviderError
        ? error.message
        : "Unable to generate the next intervention";
    console.error("Talk run generation failed", message);
    const failed = await failRun(claimed, message);
    throw new AdvanceTalkRunError(message, 502, serializeTalkRun(failed));
  }
}
