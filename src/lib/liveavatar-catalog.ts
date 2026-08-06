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
    voiceId: "c84af063-5ce2-4370-8ef8-dcd0ef903d43",
    name: "Alessandra Casual",
    image: "/studio/avatars/alessandra-sweater.webp",
    sex: "female",
  },
  {
    id: "b4fc2d60-3b82-4694-b243-93e9d2bb0242",
    voiceId: "3607df3c-9de0-4274-b0be-7e035775ead5",
    name: "Anastasia Casual",
    image: "/studio/avatars/anastasia-grey-shirt.webp",
    sex: "female",
  },
  {
    id: "bb1f6ebc-b388-4a39-9e2b-8df618e0377c",
    voiceId: "e04e9d57-853f-4d72-a8ff-8e3c768f4c9c",
    name: "Graham Casual",
    image: "/studio/avatars/graham-black-shirt.webp",
    sex: "male",
  },
  {
    id: "09919247-f4b2-45d8-a75e-86fc2fceaebf",
    voiceId: "864a26b8-bfba-4435-9cc5-1dd593de5ca7",
    name: "Katya Pop",
    image: "/studio/avatars/katya-pink-suit.webp",
    sex: "female",
  },
  {
    id: "7001c332-8101-4e5a-b695-eac2a72d9568",
    voiceId: "98a984cd-5f25-49b1-8844-2195c3d50e0f",
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
