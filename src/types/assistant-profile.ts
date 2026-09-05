export type AssistantVoiceStyle = "executive_warm" | "executive_clear";
export type AssistantResponseStyle = "concise" | "balanced" | "detailed";
export type AssistantAttitude = "discreet" | "collaborative" | "proactive";

export interface AssistantPersonality {
  responseStyle: AssistantResponseStyle;
  attitude: AssistantAttitude;
}

export interface AssistantProfileRecord {
  key: "default";
  displayName: string;
  role: string;
  appearance: "business_clay";
  personality: AssistantPersonality;
  voice: {
    provider: "local";
    model: "supertonic_3";
    style: AssistantVoiceStyle;
    speakingRate: number;
    pronunciationProfile: string;
  };
  createdAt: Date;
  updatedAt: Date;
}

export interface AssistantProfileResponse {
  displayName: string;
  role: string;
  appearance: "business_clay";
  personality: AssistantPersonality;
  voice: {
    provider: "local";
    model: "supertonic_3";
    style: AssistantVoiceStyle;
    speakingRate: number;
    pronunciationProfile: string;
  };
  connected: boolean;
  updatedAt?: string;
}
