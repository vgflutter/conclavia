import type { MeetingAutomationPublicConfig } from "@/types/meeting-automation";

const DEFAULT_RECALL_API_BASE_URL = "https://eu-central-1.recall.ai/api/v1";

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

function normalizedRecallApiUrl(value: string | undefined): string {
  const normalized = normalizedHttpsUrl(value) || DEFAULT_RECALL_API_BASE_URL;
  const url = new URL(normalized);
  if (url.hostname !== "recall.ai" && !url.hostname.endsWith(".recall.ai")) {
    return DEFAULT_RECALL_API_BASE_URL;
  }
  return normalized.replace(/\/$/, "");
}

export interface MeetingBotRuntimeConfig {
  liveRequested: boolean;
  ready: boolean;
  apiBaseUrl: string;
  apiKey?: string;
  webhookSecret?: string;
  publicBaseUrl?: string;
  accountEmail?: string;
  displayName: string;
  signedInConfirmed: boolean;
}

export function getMeetingBotRuntimeConfig(): MeetingBotRuntimeConfig {
  const liveRequested = process.env.MEETING_BOT_PROVIDER === "recall";
  const apiKey = process.env.RECALL_API_KEY?.trim() || undefined;
  const webhookSecret = process.env.RECALL_WEBHOOK_SECRET?.trim() || undefined;
  const publicBaseUrl = normalizedHttpsUrl(process.env.CONCLAVIA_PUBLIC_URL);
  const accountEmail = process.env.TEAMS_GUEST_ACCOUNT_EMAIL?.trim().toLowerCase() || undefined;
  const signedInConfirmed = process.env.TEAMS_SIGNED_IN_CONFIRMED === "true";

  return {
    liveRequested,
    ready: Boolean(
      liveRequested &&
        apiKey &&
        webhookSecret?.startsWith("whsec_") &&
        publicBaseUrl &&
        accountEmail &&
        signedInConfirmed,
    ),
    apiBaseUrl: normalizedRecallApiUrl(process.env.RECALL_API_BASE_URL),
    apiKey,
    webhookSecret,
    publicBaseUrl,
    accountEmail,
    displayName: process.env.TEAMS_GUEST_DISPLAY_NAME?.trim().slice(0, 100) || "Conclavia",
    signedInConfirmed,
  };
}

export function getMeetingAutomationPublicConfig(): MeetingAutomationPublicConfig {
  const config = getMeetingBotRuntimeConfig();

  if (config.ready) {
    return {
      state: "ready",
      provider: "recall",
      accessMode: "verified_guest",
      accountEmail: config.accountEmail,
      teamsOnly: true,
    };
  }

  return {
    state: config.liveRequested ? "setup_required" : "preview",
    provider: "preview",
    accessMode: "verified_guest",
    accountEmail: config.accountEmail,
    teamsOnly: true,
  };
}
