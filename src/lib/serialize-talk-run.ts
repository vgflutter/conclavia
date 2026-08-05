import type { TalkRunDocument } from "@/models/TalkRun";
import type { TalkRunResponse } from "@/types/talk-run";

export function serializeTalkRun(run: TalkRunDocument): TalkRunResponse {
  const discussionState = run.discussionState;
  const talkSnapshot = run.talkSnapshot
    ? JSON.parse(JSON.stringify(run.talkSnapshot)) as TalkRunResponse["talkSnapshot"]
    : undefined;
  if (talkSnapshot) {
    talkSnapshot.participants = talkSnapshot.participants.map(
      (participant, index) => ({
        ...participant,
        sex:
          participant.sex === "male" || participant.sex === "female"
            ? participant.sex
            : index % 2 === 0
              ? "female"
              : "male",
      }),
    );
  }

  return {
    id: run._id.toString(),
    talkId: run.talkId.toString(),
    status: run.status,
    phase: run.phase,
    participantTurnCount: run.participantTurnCount,
    maxTurns: run.maxTurns,
    targetDurationMinutes:
      run.targetDurationMinutes ?? run.talkSnapshot?.settings.targetDurationMinutes ?? 30,
    estimatedAirtimeSeconds: run.estimatedAirtimeSeconds ?? 0,
    nextParticipantIndex: run.nextParticipantIndex,
    activeTurn: run.activeTurn
      ? {
          speakerType: run.activeTurn.speakerType,
          participantIndex: run.activeTurn.participantIndex,
          speakerName: run.activeTurn.speakerName,
          speakerRole: run.activeTurn.speakerRole,
          intent: run.activeTurn.intent,
          targetParticipantIndex: run.activeTurn.targetParticipantIndex,
          targetSpeakerName: run.activeTurn.targetSpeakerName,
          threadLabel: run.activeTurn.threadLabel,
          arcPhase:
            run.activeTurn.arcPhase ??
            discussionState?.arcPhase ??
            "positions",
          preparationMode: run.activeTurn.preparationMode ?? "reactive",
          referenceStyle: run.activeTurn.referenceStyle ?? "idea_first",
          minWords: run.activeTurn.minWords,
          maxWords: run.activeTurn.maxWords,
        }
      : undefined,
    hasPreparedTurn:
      Boolean(run.preparedTurn) &&
      run.preparedTurn?.basedOnSequence === run.messages.length,
    discussionState: {
      arcPhase: discussionState?.arcPhase ?? "positions",
      centralQuestion: discussionState?.centralQuestion ?? "",
      phaseObjective: discussionState?.phaseObjective ?? "",
      currentFocus: discussionState?.currentFocus ?? "",
      corePositions: (discussionState?.corePositions ?? []).map((position) => ({
        participantIndex: position.participantIndex,
        summary: position.summary,
      })),
      keyConflict: discussionState?.keyConflict ?? "",
      contestedClaims: [...(discussionState?.contestedClaims ?? [])],
      evidenceAndTradeoffs: [
        ...(discussionState?.evidenceAndTradeoffs ?? []),
      ],
      openQuestions: [...(discussionState?.openQuestions ?? [])],
      agreements: [...(discussionState?.agreements ?? [])],
      unresolvedConflicts: [...(discussionState?.unresolvedConflicts ?? [])],
      turningPoints: (discussionState?.turningPoints ?? []).map((point) => ({
        participantIndex: point.participantIndex,
        summary: point.summary,
      })),
      floorQueue: (discussionState?.floorQueue ?? []).map((request) => ({
        participantIndex: request.participantIndex,
        targetParticipantIndex: request.targetParticipantIndex,
        intent: request.intent,
        reason: request.reason,
        threadLabel: request.threadLabel,
        priority: request.priority,
        expiresAfterSequence: request.expiresAfterSequence,
      })),
      conclusionReadiness:
        discussionState?.conclusionReadiness ?? "not_ready",
      conclusionReason: discussionState?.conclusionReason ?? "",
      conclusion: discussionState?.conclusion
        ? {
            kind: discussionState.conclusion.kind,
            answer: discussionState.conclusion.answer,
            agreements: [...discussionState.conclusion.agreements],
            disagreements: [...discussionState.conclusion.disagreements],
            conditions: [...discussionState.conclusion.conditions],
            openQuestions: [...discussionState.conclusion.openQuestions],
          }
        : undefined,
      editorialReviewCount: discussionState?.editorialReviewCount ?? 0,
      editorialInputTokens: discussionState?.editorialInputTokens ?? 0,
      editorialOutputTokens: discussionState?.editorialOutputTokens ?? 0,
      participantMemories: (discussionState?.participantMemories ?? []).map(
        (memory) => ({
          participantIndex: memory.participantIndex,
          statements: [...memory.statements],
        }),
      ),
    },
    messages: run.messages.map((message) => ({
      sequence: message.sequence,
      speakerType: message.speakerType,
      participantIndex: message.participantIndex,
      speakerName: message.speakerName,
      speakerRole: message.speakerRole,
      intent: message.intent ?? "argument",
      targetParticipantIndex: message.targetParticipantIndex,
      targetSpeakerName: message.targetSpeakerName,
      threadLabel: message.threadLabel ?? "",
      arcPhase:
        message.arcPhase ?? discussionState?.arcPhase ?? "positions",
      preparationMode: message.preparationMode ?? "reactive",
      referenceStyle: message.referenceStyle ?? "idea_first",
      wordCount:
        message.wordCount ??
        message.content.trim().split(/\s+/u).filter(Boolean).length,
      estimatedAirtimeSeconds:
        message.estimatedAirtimeSeconds ??
        Math.max(2, Math.ceil((message.content.trim().split(/\s+/u).filter(Boolean).length / 150) * 60) + 2),
      origin: message.origin ?? (message.provider ? "ai" : "human"),
      provider: message.provider,
      model: message.model,
      content: message.content,
      inputTokens: message.inputTokens,
      outputTokens: message.outputTokens,
      createdAt: message.createdAt.toISOString(),
    })),
    talkSnapshot,
    error: run.error,
    startedAt: run.startedAt.toISOString(),
    completedAt: run.completedAt?.toISOString(),
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
  };
}
