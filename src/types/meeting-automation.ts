export type MeetingAutomationState = "ready" | "setup_required" | "preview";

export interface MeetingAutomationPublicConfig {
  state: MeetingAutomationState;
  provider: "recall" | "preview";
  accessMode: "verified_guest";
  accountEmail?: string;
  teamsOnly: true;
}
