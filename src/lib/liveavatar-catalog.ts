import type { ParticipantSex } from "@/types/talk";

export interface StudioAvatar {
  id: string;
  voiceId: string;
  name: string;
  image: string;
  sex: ParticipantSex;
}

export const STUDIO_AVATARS: readonly StudioAvatar[] = [
  {
    id: "ab0765ad-69de-41fb-9f8a-bd01c3c52d6f",
    voiceId: "8a5c5875-acdf-4571-b535-6f1000d6e480",
    name: "Alessandra Casual",
    image: "/studio/avatars/alessandra-sweater.webp",
    sex: "female",
  },
  {
    id: "b4fc2d60-3b82-4694-b243-93e9d2bb0242",
    voiceId: "6a928a3e-8c89-458a-988e-879ee71635d2",
    name: "Anastasia Casual",
    image: "/studio/avatars/anastasia-grey-shirt.webp",
    sex: "female",
  },
  {
    id: "bb1f6ebc-b388-4a39-9e2b-8df618e0377c",
    voiceId: "bcfbff2a-ab47-46e4-914d-1b3066b8a62b",
    name: "Graham Casual",
    image: "/studio/avatars/graham-black-shirt.webp",
    sex: "male",
  },
  {
    id: "09919247-f4b2-45d8-a75e-86fc2fceaebf",
    voiceId: "8a5c5875-acdf-4571-b535-6f1000d6e480",
    name: "Katya Pop",
    image: "/studio/avatars/katya-pink-suit.webp",
    sex: "female",
  },
  {
    id: "7001c332-8101-4e5a-b695-eac2a72d9568",
    voiceId: "1117684b-8b5b-463f-97d5-9b21c06b6c1b",
    name: "Pedro Casual",
    image: "/studio/avatars/pedro-blue-shirt.webp",
    sex: "male",
  },
] as const;

export function getStudioAvatar(
  index: number,
  sex?: ParticipantSex,
): StudioAvatar {
  const avatars = sex
    ? STUDIO_AVATARS.filter((avatar) => avatar.sex === sex)
    : STUDIO_AVATARS;
  return avatars[index % avatars.length] ?? STUDIO_AVATARS[0];
}

export function findStudioAvatar(id: string): StudioAvatar | undefined {
  return STUDIO_AVATARS.find((avatar) => avatar.id === id);
}
