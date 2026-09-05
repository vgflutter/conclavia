import type {
  MeetingCreateInput,
  MeetingAgendaInput,
  CorrectionPolicy,
  MeetingLanguage,
} from "@/types/meeting";

export type MeetingValidationResult =
  | { success: true; data: MeetingCreateInput }
  | { success: false; issues: string[] };

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cleanText(value: unknown, maximumLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maximumLength) : "";
}

function cleanAgenda(value: unknown, issues: string[]): MeetingAgendaInput[] {
  if (!Array.isArray(value)) {
    issues.push("Agenda must be an array");
    return [];
  }
  if (value.length > 20) issues.push("Agenda cannot contain more than 20 items");

  return value
    .slice(0, 20)
    .flatMap((item, index) => {
      if (!isObject(item)) {
        issues.push(`Agenda item ${index + 1} is invalid`);
        return [];
      }
      const title = cleanText(item.title, 500);
      if (!title) return [];
      if (typeof item.mandatory !== "boolean") {
        issues.push(`Agenda item ${index + 1} must specify whether it is mandatory`);
        return [];
      }
      return [{ title, mandatory: item.mandatory }];
    });
}

export function meetingSeriesKey(seriesLabel: string | undefined, title: string): string {
  const source = seriesLabel?.trim() || title.trim();
  const normalized = source
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);

  return normalized || "meeting";
}

export function isMicrosoftTeamsMeetingUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      (url.hostname.toLowerCase() === "teams.microsoft.com" ||
        url.hostname.toLowerCase() === "teams.live.com")
    );
  } catch {
    return false;
  }
}

export function validateMeetingInput(body: unknown): MeetingValidationResult {
  if (!isObject(body)) {
    return { success: false, issues: ["The request must be a JSON object"] };
  }

  const issues: string[] = [];
  const title = cleanText(body.title, 160);
  const meetingUrl = cleanText(body.meetingUrl, 2_000);
  const objective = cleanText(body.objective, 2_000);
  const seriesLabel = cleanText(body.seriesLabel, 160) || undefined;
  const timezone = cleanText(body.timezone, 100) || "Europe/Rome";
  const language = body.language as MeetingLanguage;
  const correctionPolicy = body.correctionPolicy as CorrectionPolicy;
  const durationMinutes = Number(body.durationMinutes);
  const scheduledStart = new Date(String(body.scheduledStart ?? ""));

  if (!title) issues.push("Title is required");
  if (!objective) issues.push("Objective is required");
  const agenda = cleanAgenda(body.agenda, issues);

  if (!isMicrosoftTeamsMeetingUrl(meetingUrl)) {
    issues.push("A valid Microsoft Teams meeting link is required");
  }

  if (Number.isNaN(scheduledStart.getTime())) {
    issues.push("A valid meeting start is required");
  }
  if (!Number.isInteger(durationMinutes) || durationMinutes < 15 || durationMinutes > 480) {
    issues.push("Duration must be between 15 and 480 minutes");
  }
  if (!["auto", "it", "en"].includes(language)) {
    issues.push("Language must be auto, it, or en");
  }
  if (!["important_only", "on_request", "off"].includes(correctionPolicy)) {
    issues.push("Correction policy is invalid");
  }
  if (typeof body.autoJoin !== "boolean") {
    issues.push("Auto join must be a boolean");
  } else if (body.autoJoin && scheduledStart.getTime() <= Date.now()) {
    issues.push("Automatic entry requires a future meeting start");
  }
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone }).format();
  } catch {
    issues.push("Timezone is invalid");
  }

  if (issues.length > 0) return { success: false, issues };

  return {
    success: true,
    data: {
      title,
      meetingUrl,
      scheduledStart: scheduledStart.toISOString(),
      durationMinutes,
      timezone,
      objective,
      seriesLabel,
      language,
      autoJoin: body.autoJoin as boolean,
      agenda,
      correctionPolicy,
    },
  };
}
