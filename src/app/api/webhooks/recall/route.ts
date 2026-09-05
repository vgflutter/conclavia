import { NextResponse } from "next/server";

import { getMeetingBotRuntimeConfig } from "@/lib/meeting-bot-config";
import { connectToDatabase } from "@/lib/mongodb";
import {
  parseRecallStatusWebhook,
  verifyRecallWebhook,
} from "@/lib/recall-webhook";
import { MeetingModel, type MeetingDocument } from "@/models/Meeting";

export const runtime = "nodejs";

function customerFailureMessage(subCode: string | null, accountEmail?: string): string {
  if (subCode === "microsoft_teams_bot_not_invited") {
    return accountEmail
      ? `Invita ${accountEmail} al meeting e riprova.`
      : "Invita il collega digitale al meeting e riprova.";
  }
  if (subCode === "microsoft_teams_2fa_required") {
    return "L’accesso Microsoft del collega digitale richiede una verifica dell’amministratore.";
  }
  if (subCode?.includes("waiting_room")) {
    return "Il collega digitale non è stato ammesso dalla sala d’attesa.";
  }
  if (subCode === "timeout_exceeded_noone_joined") {
    return "Nessun partecipante è entrato nel meeting entro il tempo previsto.";
  }
  if (subCode?.includes("meeting_not_found")) {
    return "Il collegamento Teams non è più valido o il meeting non è disponibile.";
  }
  return "Il collega digitale non è riuscito a entrare nel meeting.";
}

function applyStatus(
  meeting: MeetingDocument,
  code: string,
  subCode: string | null,
  occurredAt: Date,
): void {
  meeting.bot.providerStatusCode = subCode ? `${code}:${subCode}` : code;
  meeting.bot.lastStatusAt = occurredAt;

  switch (code) {
    case "ready":
      meeting.bot.status = "scheduled";
      break;
    case "joining_call":
      meeting.status = "joining";
      meeting.bot.status = "joining";
      break;
    case "in_waiting_room":
      meeting.status = "waiting_room";
      meeting.bot.status = "waiting_room";
      break;
    case "in_call_not_recording":
    case "in_call_recording":
      meeting.status = "live";
      meeting.bot.status = "joined";
      meeting.bot.joinedAt ||= occurredAt;
      meeting.bot.lastError = undefined;
      break;
    case "call_ended":
      if (
        meeting.status !== "completed" &&
        meeting.status !== "cancelled" &&
        meeting.status !== "failed"
      ) {
        meeting.status = "processing";
      }
      if (meeting.bot.status !== "failed") meeting.bot.status = "left";
      meeting.bot.leftAt ||= occurredAt;
      break;
    case "done":
      if (meeting.status !== "failed") {
        if (meeting.status !== "completed" && meeting.status !== "cancelled") {
          meeting.status = "processing";
        }
        meeting.bot.status = "left";
        meeting.bot.leftAt ||= occurredAt;
      }
      break;
    case "fatal":
      meeting.status = "failed";
      meeting.bot.status = "failed";
      meeting.bot.lastError = customerFailureMessage(subCode, meeting.bot.accountEmail);
      break;
    default:
      break;
  }
}

export async function POST(request: Request) {
  const config = getMeetingBotRuntimeConfig();
  if (!config.webhookSecret) {
    return NextResponse.json({ error: "Webhook unavailable" }, { status: 503 });
  }

  const rawPayload = await request.text();
  try {
    verifyRecallWebhook(config.webhookSecret, request.headers, rawPayload);
  } catch {
    return NextResponse.json({ error: "Request not verified" }, { status: 401 });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawPayload);
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const event = parseRecallStatusWebhook(parsed);
  if (!event) return NextResponse.json({ received: true });

  const occurredAt = new Date(event.data.status.created_at);
  if (Number.isNaN(occurredAt.getTime())) {
    return NextResponse.json({ error: "Invalid event timestamp" }, { status: 400 });
  }

  await connectToDatabase();
  const meeting = await MeetingModel.findOne({
    "bot.externalBotId": event.data.bot_id,
  }).exec();
  if (!meeting) return NextResponse.json({ received: true });

  if (meeting.bot.lastStatusAt && meeting.bot.lastStatusAt > occurredAt) {
    return NextResponse.json({ received: true });
  }

  applyStatus(
    meeting,
    event.data.status.code,
    event.data.status.sub_code,
    occurredAt,
  );
  await meeting.save();

  return NextResponse.json({ received: true });
}
