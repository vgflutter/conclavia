import {
  getMeetingBotAdapter,
  MeetingBotConfigurationError,
  MeetingBotProviderError,
} from "@/lib/meeting-bot-adapter";
import { getMeetingBotRuntimeConfig } from "@/lib/meeting-bot-config";
import { serializeMeeting } from "@/lib/serialize-meeting";
import { MeetingModel, type MeetingDocument } from "@/models/Meeting";

const CUSTOMER_SCHEDULING_ERROR =
  "Non siamo riusciti a programmare l’ingresso. Controlla il collegamento Teams e riprova.";

function providerFailureCode(error: unknown): string | undefined {
  return error instanceof MeetingBotProviderError
    ? error.code || (error.status ? `http_${error.status}` : undefined)
    : undefined;
}

export async function scheduleMeetingBot(
  meeting: MeetingDocument,
): Promise<MeetingDocument> {
  const config = getMeetingBotRuntimeConfig();
  if (!meeting.autoJoin || !config.ready) return meeting;

  if (meeting.platform !== "microsoft_teams") {
    meeting.status = "failed";
    meeting.bot.status = "failed";
    meeting.bot.lastError =
      "L’ingresso automatico è disponibile al momento solo per Microsoft Teams.";
    meeting.bot.lastStatusAt = new Date();
    await meeting.save();
    return meeting;
  }

  if (meeting.bot.externalBotId && meeting.bot.status === "scheduled") {
    return meeting;
  }

  const claim = await MeetingModel.updateOne(
    {
      _id: meeting._id,
      "bot.status": { $in: ["not_scheduled", "failed"] },
    },
    {
      $set: {
        "bot.status": "scheduling",
        "bot.lastStatusAt": new Date(),
        "bot.lastError": null,
      },
    },
  ).exec();
  if (claim.modifiedCount === 0) {
    return (await MeetingModel.findById(meeting._id).exec()) || meeting;
  }
  meeting.bot.status = "scheduling";
  meeting.bot.lastStatusAt = new Date();
  meeting.bot.lastError = undefined;

  const joiningNow = meeting.scheduledStart.getTime() - Date.now() <= 2 * 60_000;
  if (joiningNow) {
    const activeColleague = await MeetingModel.exists({
      _id: { $ne: meeting._id },
      meetingUrl: meeting.meetingUrl,
      "bot.status": { $in: ["scheduling", "joining", "waiting_room", "joined"] },
    });
    if (activeColleague) {
      meeting.status = "failed";
      meeting.bot.status = "failed";
      meeting.bot.lastError =
        "Il collega digitale è già stato inviato a questo meeting.";
      meeting.bot.lastStatusAt = new Date();
      await meeting.save();
      return meeting;
    }
  }

  const botIdentityFilter = config.accountEmail
    ? { "bot.accountEmail": config.accountEmail }
    : { "bot.accessMode": config.accessMode };
  const overlappingMeeting = await MeetingModel.exists({
    _id: { $ne: meeting._id },
    autoJoin: true,
    ...botIdentityFilter,
    "bot.status": { $in: ["scheduled", "joining", "waiting_room", "joined"] },
    scheduledStart: { $lt: meeting.scheduledEnd },
    scheduledEnd: { $gt: meeting.scheduledStart },
  });
  if (overlappingMeeting) {
    meeting.status = "failed";
    meeting.bot.status = "failed";
    meeting.bot.lastError =
      "Il collega digitale è già impegnato in un altro meeting in questo orario.";
    meeting.bot.lastStatusAt = new Date();
    await meeting.save();
    return meeting;
  }

  try {
    const adapter = getMeetingBotAdapter();
    const session = joiningNow
      ? await adapter.join(serializeMeeting(meeting), config.publicBaseUrl || "")
      : await adapter.schedule(serializeMeeting(meeting));
    meeting.status = joiningNow ? "joining" : "scheduled";
    meeting.bot.provider = session.provider;
    meeting.bot.accessMode = config.accessMode;
    meeting.bot.status = joiningNow ? "joining" : "scheduled";
    meeting.bot.externalBotId = session.externalBotId;
    meeting.bot.accountEmail = config.accountEmail;
    meeting.bot.outputUrl = session.outputUrl;
    meeting.bot.scheduledFor = session.scheduledFor || meeting.scheduledStart;
    meeting.bot.joinedAt = undefined;
    meeting.bot.leftAt = undefined;
    meeting.bot.providerStatusCode = joiningNow ? "joining" : "scheduled";
    meeting.bot.lastStatusAt = new Date();
    meeting.bot.lastError = undefined;
    await meeting.save();
  } catch (error) {
    console.error("Unable to schedule meeting bot", error);
    meeting.status = "failed";
    meeting.bot.provider = config.provider === "attendee" ? "attendee" : "recall";
    meeting.bot.accessMode = config.accessMode;
    meeting.bot.status = "failed";
    meeting.bot.accountEmail = config.accountEmail;
    meeting.bot.providerStatusCode = providerFailureCode(error) || "schedule_failed";
    meeting.bot.lastStatusAt = new Date();
    meeting.bot.lastError = CUSTOMER_SCHEDULING_ERROR;
    await meeting.save();
  }

  return meeting;
}

export async function cancelMeetingBot(meeting: MeetingDocument): Promise<void> {
  if (
    !meeting.bot.externalBotId ||
    !["recall", "attendee"].includes(meeting.bot.provider)
  ) return;

  const adapter = getMeetingBotAdapter(meeting.bot.provider);
  if (!adapter.live) {
    throw new MeetingBotConfigurationError(
      "Automatic entry must be connected before this meeting can be removed.",
    );
  }

  if (meeting.bot.status === "scheduled") {
    try {
      await adapter.cancel(meeting.bot.externalBotId);
      meeting.bot.status = "left";
      meeting.bot.leftAt = new Date();
      meeting.bot.providerStatusCode = "cancelled";
      meeting.bot.lastStatusAt = new Date();
      await meeting.save();
      return;
    } catch (error) {
      if (
        !(error instanceof MeetingBotProviderError) ||
        ![400, 405].includes(error.status || 0)
      ) {
        throw error;
      }
      const result = await adapter.leave(meeting.bot.externalBotId);
      meeting.bot.status = "left";
      meeting.bot.leftAt = result.leftAt;
      meeting.bot.providerStatusCode = "removed";
      meeting.bot.lastStatusAt = result.leftAt;
      await meeting.save();
      return;
    }
  }

  if (meeting.bot.status === "scheduling") {
    throw new MeetingBotConfigurationError(
      "Wait for automatic entry scheduling to finish before removing this meeting.",
    );
  }

  if (["joining", "waiting_room", "joined"].includes(meeting.bot.status)) {
    const result = await adapter.leave(meeting.bot.externalBotId);
    meeting.bot.status = "left";
    meeting.bot.leftAt = result.leftAt;
    meeting.bot.providerStatusCode = "removed";
    meeting.bot.lastStatusAt = result.leftAt;
    await meeting.save();
  }
}
