export const STUDIO_THEME_IDS = [
  "broadcast_panel",
  "pop_garage",
  "pulp_podcast",
  "rooftop_hangout",
  "late_night",
  "neon_playground",
] as const;

export type StudioThemeId = (typeof STUDIO_THEME_IDS)[number];

export interface StudioTheme {
  id: StudioThemeId;
  image: string;
  foregroundStartPercent?: number;
  avatarBottomPercent?: number;
}

export const DEFAULT_STUDIO_THEME: StudioThemeId = "broadcast_panel";

export const STUDIO_THEMES: readonly StudioTheme[] = [
  {
    id: "broadcast_panel",
    image: "/studio/studio-broadcast-panel.webp",
    foregroundStartPercent: 57,
    avatarBottomPercent: 38,
  },
  {
    id: "pop_garage",
    image: "/studio/studio-pop-garage.webp",
  },
  {
    id: "pulp_podcast",
    image: "/studio/studio-pulp-podcast.webp",
  },
  {
    id: "rooftop_hangout",
    image: "/studio/studio-rooftop-hangout.webp",
  },
  {
    id: "late_night",
    image: "/studio/studio-late-night.webp",
  },
  {
    id: "neon_playground",
    image: "/studio/studio-neon-playground.webp",
  },
] as const;

export function isStudioThemeId(value: unknown): value is StudioThemeId {
  return (
    typeof value === "string" &&
    (STUDIO_THEME_IDS as readonly string[]).includes(value)
  );
}

export function normalizeStudioTheme(value: unknown): StudioThemeId {
  if (value === "midnight") {
    return "pop_garage";
  }

  if (value === "podcast_loft") {
    return "rooftop_hangout";
  }

  if (value === "civic") {
    return "pulp_podcast";
  }

  if (value === "future_forum") {
    return "neon_playground";
  }

  return isStudioThemeId(value) ? value : DEFAULT_STUDIO_THEME;
}

export function getStudioTheme(value: unknown): StudioTheme {
  const id = normalizeStudioTheme(value);
  return STUDIO_THEMES.find((theme) => theme.id === id) ?? STUDIO_THEMES[0];
}
