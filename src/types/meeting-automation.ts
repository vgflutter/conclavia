import type { MeetingAccessMode } from "@/types/meeting";

export type MeetingAutomationState = "ready" | "setup_required" | "preview";

export interface MeetingAutomationPublicConfig {
  state: MeetingAutomationState;
  provider: "attendee" | "recall" | "preview";
  accessMode: MeetingAccessMode;
  accountEmail?: string;
  teamsOnly: true;
}
