import type { ParticipantSex } from "@/types/talk";

export interface StudioVoice {
  id: string;
  name: string;
  sex: ParticipantSex;
  language: "it" | "en";
}

// A deliberately small on-air shortlist. Every entry is a public LiveAvatar
// voice with a preview endpoint; keeping the list curated makes casting usable.
export const STUDIO_VOICES: readonly StudioVoice[] = [
  { id: "ac4a161e-2160-43d5-ba02-4cecbe8b3393", name: "Luca Brasi", sex: "male", language: "it" },
  { id: "bcfbff2a-ab47-46e4-914d-1b3066b8a62b", name: "Giovanni Rossi", sex: "male", language: "it" },
  { id: "1117684b-8b5b-463f-97d5-9b21c06b6c1b", name: "Carmelo La Rosa", sex: "male", language: "it" },
  { id: "09b4de14-a09b-4e89-946f-d8cce012f100", name: "Linda Fiore", sex: "female", language: "it" },
  { id: "254ffe1e-c89f-430f-8c36-9e7611d310c0", name: "Elenora", sex: "female", language: "it" },
  { id: "c84af063-5ce2-4370-8ef8-dcd0ef903d43", name: "Alessandra", sex: "female", language: "it" },
  { id: "e04e9d57-853f-4d72-a8ff-8e3c768f4c9c", name: "Graham", sex: "male", language: "en" },
  { id: "98a984cd-5f25-49b1-8844-2195c3d50e0f", name: "Pedro", sex: "male", language: "en" },
  { id: "83a26e3f-bcff-4887-80a2-17531c342c9e", name: "Thaddeus", sex: "male", language: "en" },
  { id: "e948b062-7dce-4f2b-bcf6-98bd3511106b", name: "Amina", sex: "female", language: "en" },
  { id: "3607df3c-9de0-4274-b0be-7e035775ead5", name: "Anastasia", sex: "female", language: "en" },
  { id: "864a26b8-bfba-4435-9cc5-1dd593de5ca7", name: "Katya", sex: "female", language: "en" },
] as const;

export function findStudioVoice(id: string): StudioVoice | undefined {
  return STUDIO_VOICES.find((voice) => voice.id === id);
}

export function getStudioVoice(
  index: number,
  sex: ParticipantSex,
  language: string,
): StudioVoice {
  const desiredLanguage = language.trim().toLowerCase().startsWith("it")
    ? "it"
    : "en";
  const voices = STUDIO_VOICES.filter(
    (voice) => voice.sex === sex && voice.language === desiredLanguage,
  );
  return voices[index % voices.length] ?? STUDIO_VOICES[0];
}

export interface StudioAvatar {
  id: string;
  voiceId: string;
  name: string;
  image: string;
  sex: ParticipantSex;
  role: "guest" | "host";
  visual: {
    scale: number;
    offsetXPercent: number;
    offsetYPercent: number;
    brightness: number;
    contrast: number;
    saturation: number;
  };
}

// LiveAvatar identifies keyable studio looks by an alpha-channel preview rather
// than an API flag. Only those documented landscape IDs belong here: their live
// stream has a solid green background and is safe for the GPU compositor.
export const STUDIO_AVATARS: readonly StudioAvatar[] = [
  {
    id: "bb1f6ebc-b388-4a39-9e2b-8df618e0377c",
    voiceId: "e04e9d57-853f-4d72-a8ff-8e3c768f4c9c",
    name: "Graham in Black Shirt",
    image: "/studio/avatars/graham-black-shirt-studio.webp",
    sex: "male",
    role: "guest",
    visual: {
      scale: 0.97,
      offsetXPercent: 0,
      offsetYPercent: 0.7,
      brightness: 0.97,
      contrast: 1.04,
      saturation: 0.92,
    },
  },
  {
    id: "7001c332-8101-4e5a-b695-eac2a72d9568",
    voiceId: "98a984cd-5f25-49b1-8844-2195c3d50e0f",
    name: "Pedro in Blue Shirt",
    image: "/studio/avatars/pedro-blue-shirt-studio.webp",
    sex: "male",
    role: "guest",
    visual: {
      scale: 1.02,
      offsetXPercent: 0,
      offsetYPercent: 0,
      brightness: 0.96,
      contrast: 1.04,
      saturation: 0.93,
    },
  },
  {
    id: "16141106-96b5-4dd9-9846-593728c5d0ed",
    voiceId: "83a26e3f-bcff-4887-80a2-17531c342c9e",
    name: "Thaddeus in Black Shirt",
    image: "/studio/avatars/thaddeus-black-shirt.webp",
    sex: "male",
    role: "guest",
    visual: {
      scale: 1.015,
      offsetXPercent: 0,
      offsetYPercent: 0.1,
      brightness: 0.97,
      contrast: 1.03,
      saturation: 0.92,
    },
  },
  {
    id: "03f8332d-9046-42a1-bff3-3b2309f77b58",
    voiceId: "e04e9d57-853f-4d72-a8ff-8e3c768f4c9c",
    name: "Graham in Black Suit",
    image: "/studio/avatars/graham-black-suit-studio.webp",
    sex: "male",
    role: "guest",
    visual: {
      scale: 0.985,
      offsetXPercent: 0,
      offsetYPercent: 0.45,
      brightness: 0.97,
      contrast: 1.04,
      saturation: 0.91,
    },
  },
  {
    id: "200eba85-74c0-4210-8670-81ceab4efd0d",
    voiceId: "98a984cd-5f25-49b1-8844-2195c3d50e0f",
    name: "Pedro in Black Suit",
    image: "/studio/avatars/pedro-black-suit-studio.webp",
    sex: "male",
    role: "guest",
    visual: {
      scale: 1.015,
      offsetXPercent: 0,
      offsetYPercent: 0.05,
      brightness: 0.96,
      contrast: 1.04,
      saturation: 0.91,
    },
  },
  {
    id: "ab0765ad-69de-41fb-9f8a-bd01c3c52d6f",
    voiceId: "c84af063-5ce2-4370-8ef8-dcd0ef903d43",
    name: "Alessandra in Grey Sweater",
    image: "/studio/avatars/alessandra-grey-sweater.webp",
    sex: "female",
    role: "guest",
    visual: {
      scale: 0.97,
      offsetXPercent: -0.4,
      offsetYPercent: 0.65,
      brightness: 0.98,
      contrast: 1.03,
      saturation: 0.93,
    },
  },
  {
    id: "bfed3e3e-7d44-4fdb-b2be-ce9a9fd0b9b5",
    voiceId: "e948b062-7dce-4f2b-bcf6-98bd3511106b",
    name: "Amina in Blue Suit",
    image: "/studio/avatars/amina-blue-suit.webp",
    sex: "female",
    role: "guest",
    visual: {
      scale: 1.01,
      offsetXPercent: 0,
      offsetYPercent: 0.15,
      brightness: 0.97,
      contrast: 1.03,
      saturation: 0.94,
    },
  },
  {
    id: "b4fc2d60-3b82-4694-b243-93e9d2bb0242",
    voiceId: "3607df3c-9de0-4274-b0be-7e035775ead5",
    name: "Anastasia in Grey Shirt",
    image: "/studio/avatars/anastasia-grey-shirt-studio.webp",
    sex: "female",
    role: "guest",
    visual: {
      scale: 0.985,
      offsetXPercent: 0,
      offsetYPercent: 0.45,
      brightness: 0.99,
      contrast: 1.02,
      saturation: 0.92,
    },
  },
  {
    id: "09919247-f4b2-45d8-a75e-86fc2fceaebf",
    voiceId: "864a26b8-bfba-4435-9cc5-1dd593de5ca7",
    name: "Katya in Pink Suit",
    image: "/studio/avatars/katya-pink-suit-studio.webp",
    sex: "female",
    role: "guest",
    visual: {
      scale: 1,
      offsetXPercent: 0.25,
      offsetYPercent: 0.35,
      brightness: 0.98,
      contrast: 1.03,
      saturation: 0.94,
    },
  },
  {
    id: "0aae6046-0ab9-44fe-a08d-c5ac3f406d34",
    voiceId: "b2bd6569-a537-4342-aeca-a1f15d2a2c97",
    name: "Rika in Blue Suit",
    image: "/studio/avatars/rika-blue-suit.webp",
    sex: "female",
    role: "guest",
    visual: {
      scale: 1.01,
      offsetXPercent: 0,
      offsetYPercent: 0.15,
      brightness: 0.98,
      contrast: 1.03,
      saturation: 0.93,
    },
  },
  {
    id: "509609b9-cda3-4f74-b1b2-97b4d98834fd",
    voiceId: "c466083f-30f0-465b-a836-0b77abfe7956",
    name: "Anthony Host",
    image: "/studio/avatars/anthony-white-suit-host.webp",
    sex: "male",
    role: "host",
    visual: {
      scale: 1.01,
      offsetXPercent: 0,
      offsetYPercent: 0.15,
      brightness: 0.98,
      contrast: 1.03,
      saturation: 0.93,
    },
  },
] as const;

export function getStudioAvatar(
  index: number,
  sex?: ParticipantSex,
): StudioAvatar {
  const guests = STUDIO_AVATARS.filter(
    (avatar) => avatar.role === "guest" && (!sex || avatar.sex === sex),
  );
  return guests[index % guests.length] ?? STUDIO_AVATARS[0];
}

export function getStudioModeratorAvatar(): StudioAvatar {
  return (
    STUDIO_AVATARS.find((avatar) => avatar.role === "host") ??
    STUDIO_AVATARS[0]
  );
}

export function findStudioAvatar(id: string): StudioAvatar | undefined {
  return STUDIO_AVATARS.find((avatar) => avatar.id === id);
}
