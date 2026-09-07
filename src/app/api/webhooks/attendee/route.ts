import { Types } from "mongoose";
import { after, NextResponse } from "next/server";

import {
  attendeeTranscript,
  parseAttendeeWebhook,
  verifyAttendeeWebhook,
  type AttendeeWebhookEvent,
} from "@/lib/attendee-webhook";
import { getMeetingBotRuntimeConfig } from "@/lib/meeting-bot-config";
import { finalizeMeeting } from "@/lib/finalize-meeting";
import { connectToDatabase } from "@/lib/mongodb";
import {
  processMeetingTranscriptAutomation,
  storeMeetingTranscript,
} from "@/lib/process-meeting-transcript";
import { MeetingModel, type MeetingDocument } from "@/models/Meeting";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function customerFailureMessage(subType: string | undefined): string {
  if (subType === "request_to_join_denied") {
    return "Il collega digitale non è stato ammesso al meeting.";
  }
  if (subType === "waiting_room_timeout_exceeded") {
    return "Il collega digitale non è stato ammesso dalla sala d’attesa.";
  }
  if (subType === "meeting_not_found") {
    return "Il collegamento Teams non è più valido o il meeting non è disponibile.";
  }
  if (subType === "login_required") {
    return "Questo meeting richiede l’accesso con un account Microsoft autorizzato.";
  }
  if (subType === "out_of_credits") {
    return "Il servizio di ingresso nei meeting non ha credito disponibile.";
  }
  if (subType === "blocked_by_captcha") {
    return "Microsoft ha richiesto una verifica che ha impedito l’ingresso automatico.";
  }
  if (subType === "auto_leave_could_not_enable_closed_captions") {
    return "La trascrizione del meeting non è stata attivata.";
  }
  return "Il collega digitale non è riuscito a entrare nel meeting.";
}

function applyAttendeeStatus(
  meeting: MeetingDocument,
  event: AttendeeWebhookEvent,
): void {
  const state = typeof event.data.new_state === "string"
    ? event.data.new_state
    : "";
  const eventType = typeof event.data.event_type === "string"
    ? event.data.event_type
    : undefined;
  const eventSubType = typeof event.data.event_sub_type === "string"
    ? event.data.event_sub_type
    : undefined;
  const occurredAt = typeof event.data.created_at === "string"
    ? new Date(event.data.created_at)
    : new Date();
  const validOccurredAt = Number.isNaN(occurredAt.getTime()) ? new Date() : occurredAt;

  meeting.bot.providerStatusCode = [state, eventType, eventSubType]
    .filter(Boolean)
    .join(":")
    .slice(0, 160);
  if (meeting.bot.lastStatusAt && meeting.bot.lastStatusAt > validOccurredAt) return;
  meeting.bot.lastStatusAt = validOccurredAt;

  if (["ready", "scheduled", "staged"].includes(state)) {
    if (!["joining", "waiting_room", "joined", "left", "failed"].includes(meeting.bot.status)) {
      meeting.bot.status = "scheduled";
    }
    return;
  }
  if (["joining", "connecting"].includes(state)) {
    meeting.status = "joining";
    meeting.bot.status = "joining";
    return;
  }
  if (state === "waiting_room") {
    meeting.status = "waiting_room";
    meeting.bot.status = "waiting_room";
    return;
  }
  if (
    [
      "joined_not_recording",
      "joined_recording",
      "joined_recording_paused",
      "joined_recording_permission_denied",
      "connected",
    ].includes(state)
  ) {
    meeting.status = "live";
    meeting.bot.status = "joined";
    meeting.bot.joinedAt ||= validOccurredAt;
    meeting.bot.lastError = undefined;
    return;
  }
  if (state === "fatal_error") {
    meeting.status = "failed";
    meeting.bot.status = "failed";
    meeting.bot.lastError = customerFailureMessage(eventSubType);
    return;
  }
  if (["leaving", "post_processing", "ended"].includes(state)) {
    if (eventSubType === "auto_leave_could_not_enable_closed_captions") {
      meeting.status = "failed";
      meeting.bot.status = "failed";
      meeting.bot.lastError = customerFailureMessage(eventSubType);
    } else {
      if (!["completed", "cancelled", "failed"].includes(meeting.status)) {
        meeting.status = "processing";
      }
      if (meeting.bot.status !== "failed") meeting.bot.status = "left";
    }
    meeting.bot.leftAt ||= validOccurredAt;
  }
}

async function runTranscriptAutomation(meetingId: string, text: string): Promise<void> {
  try {
    await connectToDatabase();
    const meeting = await MeetingModel.findById(meetingId).exec();
    if (!meeting) return;
    await processMeetingTranscriptAutomation(meeting, text);
  } catch (error) {
    console.error("Unable to process Attendee transcript automation", error);
  }
}

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const event = parseAttendeeWebhook(payload);
  if (!event) {
    return NextResponse.json({ error: "Invalid event" }, { status: 400 });
  }

  const config = getMeetingBotRuntimeConfig();
  if (config.webhookSecret) {
    try {
      verifyAttendeeWebhook(config.webhookSecret, request.headers, payload);
    } catch {
      return NextResponse.json({ error: "Request not verified" }, { status: 401 });
    }
  }

  await connectToDatabase();
  const metadataMeetingId = event.botMetadata?.conclavia_meeting_id;
  const meetingToken = new URL(request.url).searchParams.get("meeting_token");
  const meeting = await MeetingModel.findOne({
    $or: [
      {
        "bot.provider": "attendee",
        "bot.externalBotId": event.botId,
      },
      ...(typeof metadataMeetingId === "string" &&
      Types.ObjectId.isValid(metadataMeetingId) &&
      meetingToken
        ? [
            {
              _id: metadataMeetingId,
              "bot.outputToken": meetingToken,
            },
          ]
        : []),
    ],
  }).exec();
  if (!meeting) return NextResponse.json({ received: true });

  if (!config.webhookSecret) {
    if (!meetingToken || meetingToken !== meeting.bot.outputToken) {
      return NextResponse.json({ error: "Request not verified" }, { status: 401 });
    }
  }

  meeting.bot.provider = "attendee";
  meeting.bot.externalBotId ||= event.botId;

  meeting.bot.processedWebhookIds ||= [];
  if (meeting.bot.processedWebhookIds.includes(event.idempotencyKey)) {
    return NextResponse.json({ received: true });
  }
  meeting.bot.processedWebhookIds.push(event.idempotencyKey);
  if (meeting.bot.processedWebhookIds.length > 200) {
    meeting.bot.processedWebhookIds.splice(
      0,
      meeting.bot.processedWebhookIds.length - 200,
    );
  }

  let transcriptStored = false;
  const transcript = attendeeTranscript(event);
  if (event.trigger === "bot.state_change") {
    applyAttendeeStatus(meeting, event);
    await meeting.save();
  } else if (transcript) {
    const stored = await storeMeetingTranscript(meeting, {
      ...transcript,
      language: meeting.language === "auto" ? undefined : meeting.language,
    });
    transcriptStored = !stored.duplicate;
    if (stored.duplicate) await meeting.save();
  } else if (
    event.trigger === "participant_events.join_leave" &&
    event.data.event_type === "join" &&
    typeof event.data.participant_name === "string" &&
    event.data.participant_name.trim()
  ) {
    const participantName = event.data.participant_name.trim().slice(0, 160);
    if (
      !meeting.participants.some(
        (name) => name.toLocaleLowerCase() === participantName.toLocaleLowerCase(),
      )
    ) {
      meeting.participants.push(participantName);
    }
    await meeting.save();
  } else {
    await meeting.save();
  }

  if (transcriptStored && transcript) {
    const meetingId = meeting._id.toString();
    after(() => runTranscriptAutomation(meetingId, transcript.text));
  }
  if (
    event.trigger === "bot.state_change" &&
    event.data.new_state === "ended" &&
    !meeting.summary.generatedAt
  ) {
    const meetingId = meeting._id.toString();
    after(() => finalizeMeeting(meetingId));
  }

  return NextResponse.json({ received: true });
}
