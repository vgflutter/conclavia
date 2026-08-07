import type { AudienceRoomDocument } from "@/models/AudienceRoom";
import type {
  AudienceMessageResponse,
  AudienceRoomResponse,
} from "@/types/audience";

function serializeMessage(
  message: AudienceRoomDocument["messages"][number],
): AudienceMessageResponse {
  return {
    id: message.id,
    authorChannelId: message.authorChannelId,
    authorName: message.authorName,
    authorImageUrl: message.authorImageUrl,
    content: message.content,
    publishedAt: message.publishedAt.toISOString(),
    status: message.status,
    isSponsor: message.isSponsor,
    isModerator: message.isModerator,
    amountDisplayString: message.amountDisplayString,
    action: message.action,
    targetParticipantIndex: message.targetParticipantIndex,
    onAirUntil: message.onAirUntil?.toISOString(),
    selectedAt: message.selectedAt?.toISOString(),
    usedAt: message.usedAt?.toISOString(),
  };
}

export function emptyAudienceRoom(configured: boolean): AudienceRoomResponse {
  return {
    configured,
    connected: false,
    provider: "youtube",
    moderationEnabled: false,
    pollingIntervalMillis: 5_000,
    messages: [],
  };
}

export function serializeAudienceRoom(
  room: AudienceRoomDocument,
  configured: boolean,
): AudienceRoomResponse {
  const messages = room.messages.map(serializeMessage).reverse();
  const activeMessage = room.activeMessageId
    ? messages.find(
        (message) =>
          message.id === room.activeMessageId &&
          message.onAirUntil !== undefined &&
          new Date(message.onAirUntil).getTime() > Date.now(),
      )
    : undefined;

  return {
    configured,
    connected: room.connected,
    provider: room.provider,
    videoId: room.videoId,
    videoTitle: room.videoTitle,
    moderationEnabled: room.moderationEnabled,
    pollingIntervalMillis: room.pollingIntervalMillis,
    messages,
    activeMessage,
    error: room.error,
    updatedAt: room.updatedAt.toISOString(),
  };
}
