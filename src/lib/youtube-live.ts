import type { AudienceMessageRecord } from "@/models/AudienceRoom";

interface YouTubeErrorBody {
  error?: {
    message?: string;
  };
}

interface YouTubeVideoResponse extends YouTubeErrorBody {
  items?: Array<{
    snippet?: { title?: string };
    liveStreamingDetails?: { activeLiveChatId?: string };
  }>;
}

interface YouTubeChatResponse extends YouTubeErrorBody {
  nextPageToken?: string;
  pollingIntervalMillis?: number;
  offlineAt?: string;
  items?: Array<{
    id?: string;
    snippet?: {
      type?: string;
      displayMessage?: string;
      publishedAt?: string;
      textMessageDetails?: { messageText?: string };
      superChatDetails?: {
        amountDisplayString?: string;
        userComment?: string;
      };
      memberMilestoneChatDetails?: { userComment?: string };
    };
    authorDetails?: {
      channelId?: string;
      displayName?: string;
      profileImageUrl?: string;
      isChatSponsor?: boolean;
      isChatModerator?: boolean;
      isChatOwner?: boolean;
    };
  }>;
}

export class YouTubeLiveError extends Error {
  constructor(message: string, public readonly status = 502) {
    super(message);
    this.name = "YouTubeLiveError";
  }
}

export function isYouTubeAudienceConfigured(): boolean {
  return Boolean(process.env.YOUTUBE_API_KEY?.trim());
}

function apiKey(): string {
  const value = process.env.YOUTUBE_API_KEY?.trim();
  if (!value) {
    throw new YouTubeLiveError("YouTube audience integration is not configured", 503);
  }
  return value;
}

async function youtubeRequest<T extends YouTubeErrorBody>(
  endpoint: string,
  params: URLSearchParams,
): Promise<T> {
  params.set("key", apiKey());
  const response = await fetch(
    `https://www.googleapis.com/youtube/v3/${endpoint}?${params.toString()}`,
    { cache: "no-store", signal: AbortSignal.timeout(12_000) },
  );
  const payload = (await response.json()) as T;
  if (!response.ok) {
    throw new YouTubeLiveError(
      payload.error?.message || "YouTube Live API request failed",
      response.status,
    );
  }
  return payload;
}

export function extractYouTubeVideoId(input: string): string | undefined {
  const value = input.trim();
  if (/^[A-Za-z0-9_-]{11}$/u.test(value)) return value;

  try {
    const url = new URL(value.startsWith("http") ? value : `https://${value}`);
    if (url.hostname === "youtu.be") {
      const id = url.pathname.split("/").filter(Boolean)[0];
      return id && /^[A-Za-z0-9_-]{11}$/u.test(id) ? id : undefined;
    }
    if (url.hostname.endsWith("youtube.com")) {
      const queryId = url.searchParams.get("v");
      if (queryId && /^[A-Za-z0-9_-]{11}$/u.test(queryId)) return queryId;
      const parts = url.pathname.split("/").filter(Boolean);
      if (["live", "shorts", "embed"].includes(parts[0] ?? "")) {
        const id = parts[1];
        return id && /^[A-Za-z0-9_-]{11}$/u.test(id) ? id : undefined;
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export async function resolveYouTubeLiveVideo(videoId: string): Promise<{
  videoId: string;
  videoTitle: string;
  liveChatId: string;
}> {
  const params = new URLSearchParams({
    part: "snippet,liveStreamingDetails",
    id: videoId,
  });
  const payload = await youtubeRequest<YouTubeVideoResponse>("videos", params);
  const video = payload.items?.[0];
  const liveChatId = video?.liveStreamingDetails?.activeLiveChatId;
  if (!video) throw new YouTubeLiveError("YouTube video not found", 404);
  if (!liveChatId) {
    throw new YouTubeLiveError("This video has no active live chat", 409);
  }
  return {
    videoId,
    videoTitle: video.snippet?.title?.trim() || "YouTube Live",
    liveChatId,
  };
}

function chatContent(item: NonNullable<YouTubeChatResponse["items"]>[number]) {
  return (
    item.snippet?.textMessageDetails?.messageText ||
    item.snippet?.superChatDetails?.userComment ||
    item.snippet?.memberMilestoneChatDetails?.userComment ||
    item.snippet?.displayMessage ||
    ""
  ).trim();
}

export async function fetchYouTubeLiveMessages(
  liveChatId: string,
  moderationEnabled: boolean,
  pageToken?: string,
): Promise<{
  messages: AudienceMessageRecord[];
  nextPageToken?: string;
  pollingIntervalMillis: number;
  ended: boolean;
}> {
  const params = new URLSearchParams({
    liveChatId,
    part: "snippet,authorDetails",
    maxResults: "200",
    profileImageSize: "88",
  });
  if (pageToken) params.set("pageToken", pageToken);
  const payload = await youtubeRequest<YouTubeChatResponse>(
    "liveChat/messages",
    params,
  );
  const messages = (payload.items ?? []).flatMap((item) => {
    const content = chatContent(item).slice(0, 1_000);
    if (!item.id || !content || item.snippet?.type === "tombstone") return [];
    return [{
      id: item.id,
      authorChannelId: item.authorDetails?.channelId,
      authorName: item.authorDetails?.displayName?.trim() || "YouTube viewer",
      authorImageUrl: item.authorDetails?.profileImageUrl,
      content,
      publishedAt: item.snippet?.publishedAt
        ? new Date(item.snippet.publishedAt)
        : new Date(),
      status: moderationEnabled ? "pending" as const : "available" as const,
      isSponsor: Boolean(item.authorDetails?.isChatSponsor),
      isModerator: Boolean(
        item.authorDetails?.isChatModerator || item.authorDetails?.isChatOwner,
      ),
      amountDisplayString: item.snippet?.superChatDetails?.amountDisplayString,
    }];
  });

  return {
    messages,
    nextPageToken: payload.nextPageToken,
    pollingIntervalMillis: Math.max(2_000, payload.pollingIntervalMillis ?? 5_000),
    ended: Boolean(payload.offlineAt),
  };
}
