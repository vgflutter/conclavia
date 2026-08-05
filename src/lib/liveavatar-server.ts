import "server-only";

const LIVEAVATAR_API_URL = "https://api.liveavatar.com";

interface LiveAvatarEnvelope<T> {
  code?: number;
  message?: string;
  data?: T;
}

export class LiveAvatarApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function getApiKey(): string | undefined {
  return process.env.LIVEAVATAR_API_KEY?.trim() || undefined;
}

export function isLiveAvatarConfigured(): boolean {
  return Boolean(getApiKey());
}

export function isLiveAvatarProductionEnabled(): boolean {
  return process.env.LIVEAVATAR_PRODUCTION_ENABLED === "true";
}

export function liveAvatarMaxSessionSeconds(): number {
  const requested = Number(process.env.LIVEAVATAR_MAX_SESSION_SECONDS ?? 45);
  return Number.isFinite(requested)
    ? Math.min(300, Math.max(20, Math.round(requested)))
    : 45;
}

export async function liveAvatarRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new LiveAvatarApiError("LiveAvatar is not configured", 503);
  }

  const response = await fetch(`${LIVEAVATAR_API_URL}${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      "X-API-KEY": apiKey,
      ...init.headers,
    },
    signal: AbortSignal.timeout(15_000),
  });

  let payload: LiveAvatarEnvelope<T> | undefined;
  try {
    payload = (await response.json()) as LiveAvatarEnvelope<T>;
  } catch {
    throw new LiveAvatarApiError("LiveAvatar returned an invalid response", 502);
  }

  if (!response.ok || payload.code !== 1000 || payload.data === undefined) {
    throw new LiveAvatarApiError(
      payload.message || "LiveAvatar request failed",
      response.status >= 400 ? response.status : 502,
    );
  }

  return payload.data;
}
