import type { TalkRunDocument } from "@/models/TalkRun";
import type { TalkRunAudienceCue } from "@/types/audience";
import type { TalkRunResponse } from "@/types/talk-run";
import { normalizeTalkOnAirNames } from "@/lib/on-air-names";

function serializeAudienceCue(
  cue: TalkRunAudienceCue,
): TalkRunAudienceCue {
  return {
    provider: cue.provider,
    messageId: cue.messageId,
    authorName: cue.authorName,
    authorImageUrl: cue.authorImageUrl,
    content: cue.content,
    mode: cue.mode,
    targetParticipantIndex: cue.targetParticipantIndex,
  };
}

export function serializeTalkRun(run: TalkRunDocument): TalkRunResponse {
  const discussionState = run.discussionState;
  const rawTalkSnapshot = run.talkSnapshot
    ? JSON.parse(JSON.stringify(run.talkSnapshot)) as TalkRunResponse["talkSnapshot"]
    : undefined;
  const talkSnapshot = rawTalkSnapshot
    ? normalizeTalkOnAirNames(rawTalkSnapshot)
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

  const participantName = (index: number | undefined, fallback: string) =>
    index === undefined
      ? fallback
      : talkSnapshot?.participants[index]?.name ?? fallback;

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
          speakerName:
            run.activeTurn.speakerType === "participant"
              ? participantName(
                  run.activeTurn.participantIndex,
                  run.activeTurn.speakerName,
                )
              : talkSnapshot?.moderator.name ?? run.activeTurn.speakerName,
          speakerRole:
            run.activeTurn.speakerType === "participant" &&
            run.activeTurn.participantIndex !== undefined
              ? talkSnapshot?.participants[run.activeTurn.participantIndex]
                  ?.role ?? run.activeTurn.speakerRole
              : talkSnapshot?.moderator.role ?? run.activeTurn.speakerRole,
          intent: run.activeTurn.intent,
          targetParticipantIndex: run.activeTurn.targetParticipantIndex,
          targetSpeakerName: run.activeTurn.targetSpeakerName
            ? participantName(
                run.activeTurn.targetParticipantIndex,
                run.activeTurn.targetSpeakerName,
              )
            : undefined,
          threadLabel: run.activeTurn.threadLabel,
          arcPhase:
            run.activeTurn.arcPhase ??
            discussionState?.arcPhase ??
            "positions",
          preparationMode: run.activeTurn.preparationMode ?? "reactive",
          referenceStyle: run.activeTurn.referenceStyle ?? "idea_first",
          minWords: run.activeTurn.minWords,
          maxWords: run.activeTurn.maxWords,
          audienceCue: run.activeTurn.audienceCue
            ? serializeAudienceCue(run.activeTurn.audienceCue)
            : undefined,
        }
      : undefined,
    audienceCue: run.audienceCue
      ? serializeAudienceCue(run.audienceCue)
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
      speakerName:
        message.speakerType === "participant"
          ? participantName(message.participantIndex, message.speakerName)
          : talkSnapshot?.moderator.name ?? message.speakerName,
      speakerRole:
        message.speakerType === "participant" &&
        message.participantIndex !== undefined
          ? talkSnapshot?.participants[message.participantIndex]?.role ??
            message.speakerRole
          : talkSnapshot?.moderator.role ?? message.speakerRole,
      intent: message.intent ?? "argument",
      targetParticipantIndex: message.targetParticipantIndex,
      targetSpeakerName: message.targetSpeakerName
        ? participantName(
            message.targetParticipantIndex,
            message.targetSpeakerName,
          )
        : undefined,
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
      audienceCue: message.audienceCue
        ? serializeAudienceCue(message.audienceCue)
        : undefined,
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
