import { MeetingModel, type MeetingDocument } from "@/models/Meeting";
import type {
  MeetingContinuityBriefing,
  MeetingParticipantNote,
} from "@/types/meeting";

function uniqueStrings(values: string[], limit: number): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = value.trim().toLocaleLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(value.trim());
    if (result.length >= limit) break;
  }

  return result;
}

function briefingFromMeetings(
  seriesKey: string,
  meetings: MeetingDocument[],
  seriesId?: string,
): MeetingContinuityBriefing {
  const participantNotes = new Map<string, MeetingParticipantNote>();
  for (const previous of meetings) {
    for (const note of previous.summary.participantNotes) {
      const key = note.displayName.trim().toLocaleLowerCase();
      if (key && !participantNotes.has(key)) {
        participantNotes.set(key, {
          displayName: note.displayName,
          note: note.note,
        });
      }
    }
  }

  return {
    seriesId,
    seriesKey,
    previousMeetingIds: meetings.map((item) => item._id.toString()),
    lastMeetingAt: meetings[0]?.scheduledStart.toISOString(),
    overview: meetings.find((item) => item.summary.overview)?.summary.overview || undefined,
    rememberedFacts: uniqueStrings(
      meetings.flatMap((item) => item.summary.rememberedFacts || []),
      20,
    ),
    decisions: uniqueStrings(meetings.flatMap((item) => item.summary.decisions), 10),
    actionItems: meetings
      .flatMap((item) => item.summary.actionItems)
      .filter((item) => !item.completed)
      .slice(0, 10)
      .map((item) => ({
        description: item.description,
        owner: item.owner || undefined,
        dueAt: item.dueAt?.toISOString(),
        completed: item.completed,
      })),
    openQuestions: uniqueStrings(
      meetings.flatMap((item) => item.summary.openQuestions),
      10,
    ),
    participantNotes: [...participantNotes.values()].slice(0, 12),
  };
}

export async function buildMeetingContinuity(
  meeting: MeetingDocument,
  maximumMeetings = 5,
): Promise<MeetingContinuityBriefing> {
  const groupFilter = meeting.seriesId
    ? { seriesId: meeting.seriesId }
    : { seriesKey: meeting.seriesKey };
  const previousMeetings = await MeetingModel.find({
    _id: { $ne: meeting._id },
    ...groupFilter,
    status: "completed",
    scheduledStart: { $lt: meeting.scheduledStart },
  })
    .sort({ scheduledStart: -1 })
    .limit(maximumMeetings)
    .exec();

  return briefingFromMeetings(
    meeting.seriesKey,
    previousMeetings,
    meeting.seriesId?.toString(),
  );
}

export async function buildMeetingSeriesContinuity(
  seriesId: string,
  seriesKey: string,
  maximumMeetings = 5,
): Promise<MeetingContinuityBriefing> {
  const meetings = await MeetingModel.find({ seriesId, status: "completed" })
    .sort({ scheduledStart: -1 })
    .limit(maximumMeetings)
    .exec();
  return briefingFromMeetings(seriesKey, meetings, seriesId);
}
