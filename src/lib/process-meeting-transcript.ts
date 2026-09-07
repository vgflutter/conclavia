import { randomUUID } from "node:crypto";

import {
  detectImportantIntervention,
  executeMeetingCommand,
} from "@/lib/execute-meeting-command";
import {
  detectElementaryArithmetic,
  isMeetingWakePhrase,
  meetingPermissionDecision,
  parseMeetingVoiceCommand,
} from "@/lib/meeting-command";
import type { MeetingDocument } from "@/models/Meeting";
import type { MeetingCommandKind } from "@/types/meeting";

export interface IncomingMeetingTranscript {
  speakerName: string;
  text: string;
  language?: "it" | "en";
  startMs?: number;
  endMs?: number;
}

export interface SpokenMeetingCommand {
  id: string;
  kind: MeetingCommandKind;
  response: string;
}

function normalizeSpeech(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export async function storeMeetingTranscript(
  meeting: MeetingDocument,
  transcript: IncomingMeetingTranscript,
): Promise<{ duplicate: boolean }> {
  const duplicate = meeting.transcript.slice(-8).some(
    (segment) =>
      segment.speakerName === transcript.speakerName &&
      segment.text === transcript.text &&
      (transcript.startMs === undefined || segment.startMs === transcript.startMs),
  );
  if (duplicate) return { duplicate: true };

  const previousSequence = meeting.transcript.at(-1)?.sequence || 0;
  meeting.transcript.push({
    sequence: previousSequence + 1,
    speakerName: transcript.speakerName,
    text: transcript.text,
    language: transcript.language,
    startMs: transcript.startMs,
    endMs: transcript.endMs,
    createdAt: new Date(),
  });
  if (
    !meeting.participants.some(
      (name) => name.toLocaleLowerCase() === transcript.speakerName.toLocaleLowerCase(),
    )
  ) {
    meeting.participants.push(transcript.speakerName);
  }
  if (meeting.transcript.length > 4_000) {
    meeting.transcript.splice(0, meeting.transcript.length - 4_000);
  }
  await meeting.save();
  return { duplicate: false };
}

export async function processMeetingTranscriptAutomation(
  meeting: MeetingDocument,
  text: string,
): Promise<SpokenMeetingCommand | undefined> {
  const wakeWord = meeting.assistant.wakeWord || "Conclavia";
  const latestSpeaker = normalizeSpeech(meeting.transcript.at(-1)?.speakerName || "")
    .replace(/\s+/g, "");
  const normalizedWakeWord = normalizeSpeech(wakeWord).replace(/\s+/g, "");
  if (latestSpeaker && normalizedWakeWord && latestSpeaker.startsWith(normalizedWakeWord)) {
    return undefined;
  }

  const currentSegment = meeting.transcript.at(-1);
  const previousSegment = meeting.transcript.at(-2);
  const continuesWakePhrase = Boolean(
    currentSegment &&
      previousSegment &&
      currentSegment.speakerName.toLocaleLowerCase() ===
        previousSegment.speakerName.toLocaleLowerCase() &&
      currentSegment.createdAt.getTime() - previousSegment.createdAt.getTime() <= 8_000 &&
      isMeetingWakePhrase(previousSegment.text, wakeWord),
  );
  const actionableText = continuesWakePhrase && previousSegment
    ? `${previousSegment.text} ${text}`
    : text;

  if (
    meeting.pendingIntervention &&
    meeting.pendingIntervention.expiresAt.getTime() <= Date.now()
  ) {
    meeting.set("pendingIntervention", undefined);
    await meeting.save();
  }

  if (meeting.pendingIntervention && meetingPermissionDecision(actionableText, wakeWord) === "grant") {
    const pending = meeting.pendingIntervention;
    const kind = pending.type === "correction" ? "correct" : "inform";
    meeting.commandHistory.push({
      id: randomUUID(),
      kind,
      prompt: pending.sourceStatement,
      response: pending.response,
      createdAt: new Date(),
    });
    meeting.set("pendingIntervention", undefined);
    if (meeting.commandHistory.length > 50) {
      meeting.commandHistory.splice(0, meeting.commandHistory.length - 50);
    }
    await meeting.save();
    const latest = meeting.commandHistory.at(-1);
    return latest
      ? { id: latest.id, kind: latest.kind, response: latest.response }
      : undefined;
  }
  if (meeting.pendingIntervention && meetingPermissionDecision(actionableText, wakeWord) === "decline") {
    meeting.set("pendingIntervention", undefined);
    await meeting.save();
    return undefined;
  }

  const voiceCommand = parseMeetingVoiceCommand(actionableText, wakeWord);
  if (voiceCommand) {
    if (meeting.pendingIntervention) meeting.set("pendingIntervention", undefined);
    await executeMeetingCommand(meeting, voiceCommand.kind, voiceCommand.prompt);
    const latest = meeting.commandHistory.at(-1);
    return latest
      ? { id: latest.id, kind: latest.kind, response: latest.response }
      : undefined;
  }

  const lastCheck = meeting.bot.lastCorrectionCheckAt?.getTime() || 0;
  const conciseObjectiveClaim =
    text.length >= 12 &&
    /\b(?:0|1|2|3|4|5|6|7|8|9|zero|uno|due|tre|quattro|cinque|sei|sette|otto|nove|dieci|one|two|three|four|five|six|seven|eight|nine|ten)\b/iu.test(text) &&
    /\b(?:fa|uguale|equals?|is|are)\b/iu.test(text);
  const interventionDue =
    meeting.assistant.correctionPolicy === "important_only" &&
    (text.length >= 30 || conciseObjectiveClaim) &&
    !text.trim().endsWith("?") &&
    Date.now() - lastCheck >= 30_000;
  if (!interventionDue || meeting.pendingIntervention) return undefined;

  meeting.bot.lastCorrectionCheckAt = new Date();
  await meeting.save();
  const arithmetic = detectElementaryArithmetic(text);
  const intervention = arithmetic
    ? { type: "correction" as const, ...arithmetic }
    : await detectImportantIntervention(meeting, text);
  if (!intervention) return undefined;

  meeting.pendingIntervention = {
    id: randomUUID(),
    type: intervention.type,
    sourceSpeaker: currentSegment?.speakerName,
    sourceStatement: text.slice(0, 2_000),
    reason: intervention.reason.slice(0, 1_000),
    response: intervention.response.slice(0, 2_000),
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 90_000),
  };
  await meeting.save();
  return undefined;
}
