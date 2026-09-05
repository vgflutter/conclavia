import type { Locale } from "@/i18n/locale";
import type { MeetingPlatform, MeetingStatus } from "@/types/meeting";

const statusLabels: Record<Locale, Record<MeetingStatus, string>> = {
  en: {
    scheduled: "Scheduled",
    joining: "Joining",
    waiting_room: "Waiting for admission",
    live: "In progress",
    processing: "To review",
    completed: "Completed",
    cancelled: "Cancelled",
    failed: "Needs attention",
  },
  it: {
    scheduled: "Programmato",
    joining: "In ingresso",
    waiting_room: "In attesa di ammissione",
    live: "In corso",
    processing: "Da completare",
    completed: "Concluso",
    cancelled: "Annullato",
    failed: "Da controllare",
  },
};

const platformLabels: Record<Locale, Record<MeetingPlatform, string>> = {
  it: {
    microsoft_teams: "Microsoft Teams",
  },
  en: {
    microsoft_teams: "Microsoft Teams",
  },
};

export function meetingStatusLabel(locale: Locale, status: MeetingStatus): string {
  return statusLabels[locale][status];
}

export function meetingPlatformLabel(platform: MeetingPlatform, locale: Locale): string {
  return platformLabels[locale][platform];
}

export function formatMeetingDate(
  value: string | Date,
  locale: Locale,
  timezone?: string,
): string {
  return new Intl.DateTimeFormat(locale === "it" ? "it-IT" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone,
  }).format(new Date(value));
}
