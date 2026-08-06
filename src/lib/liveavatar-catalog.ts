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
    id: "9c59a215-4c9f-478f-9d95-edca74c7b0d0",
    voiceId: "8a5c5875-acdf-4571-b535-6f1000d6e480",
    name: "Alessandra",
    image: "/studio/avatars/alessandra.webp",
    sex: "female",
  },
  {
    id: "42700a53-38ab-4485-b46f-26be6e0953dc",
    voiceId: "6a928a3e-8c89-458a-988e-879ee71635d2",
    name: "Amina",
    image: "/studio/avatars/amina.webp",
    sex: "female",
  },
  {
    id: "38ad67ed-98f0-407c-a2d2-4f0998b306fc",
    voiceId: "bcfbff2a-ab47-46e4-914d-1b3066b8a62b",
    name: "Anthony",
    image: "/studio/avatars/anthony.webp",
    sex: "male",
  },
  {
    id: "26393b8e-e944-4367-98ef-e2bc75c4b792",
    voiceId: "8a5c5875-acdf-4571-b535-6f1000d6e480",
    name: "Katya",
    image: "/studio/avatars/katya.webp",
    sex: "female",
  },
  {
    id: "200eba85-74c0-4210-8670-81ceab4efd0d",
    voiceId: "1117684b-8b5b-463f-97d5-9b21c06b6c1b",
    name: "Pedro",
    image: "/studio/avatars/pedro.webp",
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
