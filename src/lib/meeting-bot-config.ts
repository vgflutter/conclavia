import type { MeetingAutomationPublicConfig } from "@/types/meeting-automation";
import type { MeetingAccessMode } from "@/types/meeting";

const DEFAULT_ATTENDEE_API_BASE_URL = "https://app.attendee.dev/api/v1";
const DEFAULT_RECALL_API_BASE_URL = "https://eu-central-1.recall.ai/api/v1";

type MeetingBotRuntimeProvider = "preview" | "recall" | "attendee";

function normalizedHttpsUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;

  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return undefined;
    return url.toString().replace(/\/$/, "");
  } catch {
    return undefined;
  }
}

function normalizedProviderApiUrl(
  value: string | undefined,
  fallback: string,
  allowedDomain: string,
): string {
  const normalized = normalizedHttpsUrl(value) || fallback;
  const url = new URL(normalized);
  if (url.hostname !== allowedDomain && !url.hostname.endsWith(`.${allowedDomain}`)) {
    return fallback;
  }
  return normalized.replace(/\/$/, "");
}

function requestedProvider(): MeetingBotRuntimeProvider {
  if (process.env.MEETING_BOT_PROVIDER === "attendee") return "attendee";
  if (process.env.MEETING_BOT_PROVIDER === "recall") return "recall";
  return "preview";
}

export interface MeetingBotRuntimeConfig {
  provider: MeetingBotRuntimeProvider;
  liveRequested: boolean;
  ready: boolean;
  apiBaseUrl: string;
  apiKey?: string;
  webhookSecret?: string;
  publicBaseUrl?: string;
  accountEmail?: string;
  accessMode: MeetingAccessMode;
  displayName: string;
  signedInConfirmed: boolean;
}

export function getMeetingBotRuntimeConfig(): MeetingBotRuntimeConfig {
  const provider = requestedProvider();
  const liveRequested = provider !== "preview";
  const apiKey = provider === "attendee"
    ? process.env.ATTENDEE_API_KEY?.trim() || undefined
    : provider === "recall"
      ? process.env.RECALL_API_KEY?.trim() || undefined
      : undefined;
  const webhookSecret = provider === "attendee"
    ? process.env.ATTENDEE_WEBHOOK_SECRET?.trim() || undefined
    : provider === "recall"
      ? process.env.RECALL_WEBHOOK_SECRET?.trim() || undefined
      : undefined;
  const publicBaseUrl = normalizedHttpsUrl(process.env.CONCLAVIA_PUBLIC_URL);
  const accountEmail = process.env.TEAMS_GUEST_ACCOUNT_EMAIL?.trim().toLowerCase() || undefined;
  const signedInConfirmed = process.env.TEAMS_SIGNED_IN_CONFIRMED === "true";
  const accessMode: MeetingAccessMode =
    process.env.TEAMS_ACCESS_MODE === "signed_in"
      ? "verified_guest"
      : "anonymous_guest";
  const identityReady = provider === "attendee"
    ? accessMode === "anonymous_guest"
    : accessMode === "anonymous_guest" || Boolean(accountEmail && signedInConfirmed);
  const verificationReady =
    provider === "attendee" || Boolean(webhookSecret?.startsWith("whsec_"));

  return {
    provider,
    liveRequested,
    ready: Boolean(
      liveRequested &&
        apiKey &&
        publicBaseUrl &&
        identityReady &&
        verificationReady,
    ),
    apiBaseUrl: provider === "attendee"
      ? normalizedProviderApiUrl(
          process.env.ATTENDEE_API_BASE_URL,
          DEFAULT_ATTENDEE_API_BASE_URL,
          "attendee.dev",
        )
      : normalizedProviderApiUrl(
          process.env.RECALL_API_BASE_URL,
          DEFAULT_RECALL_API_BASE_URL,
          "recall.ai",
        ),
    apiKey,
    webhookSecret,
    publicBaseUrl,
    accountEmail,
    accessMode,
    displayName: process.env.TEAMS_GUEST_DISPLAY_NAME?.trim().slice(0, 100) || "Conclavia",
    signedInConfirmed,
  };
}

export function getMeetingAutomationPublicConfig(): MeetingAutomationPublicConfig {
  const config = getMeetingBotRuntimeConfig();

  if (config.ready && config.provider !== "preview") {
    return {
      state: "ready",
      provider: config.provider,
      accessMode: config.accessMode,
      accountEmail: config.accountEmail,
      teamsOnly: true,
    };
  }

  return {
    state: config.liveRequested ? "setup_required" : "preview",
    provider: "preview",
    accessMode: config.accessMode,
    accountEmail: config.accountEmail,
    teamsOnly: true,
  };
}
