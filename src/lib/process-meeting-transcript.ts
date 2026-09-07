import {
  detectImportantCorrection,
  executeMeetingCommand,
} from "@/lib/execute-meeting-command";
import {
  isMeetingWakePhrase,
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
  const latestSpeaker = meeting.transcript.at(-1)?.speakerName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "") || "";
  const normalizedWakeWord = wakeWord
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "");
  if (latestSpeaker && normalizedWakeWord && latestSpeaker.startsWith(normalizedWakeWord)) {
    return undefined;
  }

  let voiceCommand = parseMeetingVoiceCommand(text, wakeWord);
  if (!voiceCommand) {
    const currentSegment = meeting.transcript.at(-1);
    const previousSegment = meeting.transcript.at(-2);
    const isSameSpeaker = Boolean(
      currentSegment &&
        previousSegment &&
        currentSegment.speakerName.toLocaleLowerCase() ===
          previousSegment.speakerName.toLocaleLowerCase(),
    );
    const isRecent = Boolean(
      currentSegment &&
        previousSegment &&
        currentSegment.createdAt.getTime() - previousSegment.createdAt.getTime() <= 8_000,
    );
    if (
      isSameSpeaker &&
      isRecent &&
      previousSegment &&
      isMeetingWakePhrase(previousSegment.text, wakeWord)
    ) {
      voiceCommand = parseMeetingVoiceCommand(
        `${previousSegment.text} ${text}`,
        wakeWord,
      );
    }
  }
  if (voiceCommand) {
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
  const correctionDue =
    meeting.assistant.correctionPolicy === "important_only" &&
    (text.length >= 30 || conciseObjectiveClaim) &&
    !text.trim().endsWith("?") &&
    Date.now() - lastCheck >= 30_000;
  if (!correctionDue) return undefined;

  meeting.bot.lastCorrectionCheckAt = new Date();
  await meeting.save();
  const correction = await detectImportantCorrection(meeting, text);
  const latest = meeting.commandHistory.at(-1);
  return correction && latest
    ? { id: latest.id, kind: "correct", response: correction }
    : undefined;
}
