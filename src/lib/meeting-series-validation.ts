import { validateMeetingInput } from "@/lib/meeting-validation";
import type { MeetingAgendaInput, MeetingSeriesCreateInput } from "@/types/meeting";

export type MeetingSeriesValidationResult =
  | { success: true; data: MeetingSeriesCreateInput }
  | { success: false; issues: string[] };

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cleanText(value: unknown, maximumLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maximumLength) : "";
}

export function validateMeetingSeriesInput(
  body: unknown,
): MeetingSeriesValidationResult {
  if (!isObject(body)) {
    return { success: false, issues: ["The request must be a JSON object"] };
  }

  const title = cleanText(body.title, 160);
  const objective = cleanText(body.objective, 2_000);
  const timezone = cleanText(body.timezone, 100) || "Europe/Rome";
  const appointments = Array.isArray(body.appointments) ? body.appointments : [];
  const issues: string[] = [];
  let normalizedAgenda: MeetingAgendaInput[] = [];

  if (!title) issues.push("Series title is required");
  if (!objective) issues.push("Objective is required");
  if (appointments.length < 1 || appointments.length > 24) {
    issues.push("A series must contain between 1 and 24 appointments");
  }

  const normalizedAppointments = appointments.flatMap((appointment, index) => {
    if (!isObject(appointment)) {
      issues.push(`Appointment ${index + 1} is invalid`);
      return [];
    }

    const label = cleanText(appointment.label, 120) || undefined;
    const validation = validateMeetingInput({
      title: label ? `${title} · ${label}` : title,
      meetingUrl: appointment.meetingUrl,
      scheduledStart: appointment.scheduledStart,
      durationMinutes: appointment.durationMinutes,
      timezone,
      objective,
      seriesLabel: title,
      language: body.language,
      autoJoin: body.autoJoin,
      agenda: body.agenda,
      correctionPolicy: body.correctionPolicy,
    });

    if (!validation.success) {
      issues.push(
        ...validation.issues.map((issue) => `Appointment ${index + 1}: ${issue}`),
      );
      return [];
    }
    normalizedAgenda = validation.data.agenda;

    return [
      {
        label,
        meetingUrl: validation.data.meetingUrl,
        scheduledStart: validation.data.scheduledStart,
        durationMinutes: validation.data.durationMinutes,
      },
    ];
  });

  const appointmentKeys = new Set<string>();
  for (const appointment of normalizedAppointments) {
    const key = `${appointment.scheduledStart}|${appointment.meetingUrl.toLocaleLowerCase()}`;
    if (appointmentKeys.has(key)) {
      issues.push("The same meeting link and start time cannot be added twice");
      break;
    }
    appointmentKeys.add(key);
  }

  if (issues.length > 0) return { success: false, issues };

  return {
    success: true,
    data: {
      title,
      objective,
      timezone,
      language: body.language as MeetingSeriesCreateInput["language"],
      autoJoin: body.autoJoin as boolean,
      agenda: normalizedAgenda,
      correctionPolicy: body.correctionPolicy as MeetingSeriesCreateInput["correctionPolicy"],
      appointments: normalizedAppointments.sort(
        (left, right) =>
          new Date(left.scheduledStart).getTime() -
          new Date(right.scheduledStart).getTime(),
      ),
    },
  };
}
