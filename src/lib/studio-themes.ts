export const STUDIO_THEME_IDS = [
  "after_hours",
  "color_block_club",
  "electric_commons",
  "soft_social",
  "broadcast_panel",
  "pop_garage",
  "pulp_podcast",
  "rooftop_hangout",
  "late_night",
  "neon_playground",
] as const;

export type StudioThemeId = (typeof STUDIO_THEME_IDS)[number];
export type StudioEditorialTone = "creator" | "editorial";

export interface StudioTheme {
  id: StudioThemeId;
  image: string;
  foregroundImage?: string;
  foregroundStartPercent?: number;
  avatarBottomPercent?: number;
  proceduralForeground?: "midnight_arc";
  editorialTone: StudioEditorialTone;
  productionTier: "premium" | "creative";
}

export const DEFAULT_STUDIO_THEME: StudioThemeId = "after_hours";

export const STUDIO_THEMES: readonly StudioTheme[] = [
  {
    id: "after_hours",
    image: "/studio/studio-after-hours.webp",
    avatarBottomPercent: 25,
    proceduralForeground: "midnight_arc",
    editorialTone: "creator",
    productionTier: "premium",
  },
  {
    id: "color_block_club",
    image: "/studio/studio-color-block-club.webp",
    foregroundImage: "/studio/studio-color-block-club-foreground.webp",
    avatarBottomPercent: 33,
    editorialTone: "creator",
    productionTier: "premium",
  },
  {
    id: "electric_commons",
    image: "/studio/studio-electric-commons.webp",
    foregroundImage: "/studio/studio-electric-commons-foreground.webp",
    avatarBottomPercent: 41,
    editorialTone: "editorial",
    productionTier: "premium",
  },
  {
    id: "soft_social",
    image: "/studio/studio-soft-social.webp",
    foregroundImage: "/studio/studio-soft-social-foreground.webp",
    avatarBottomPercent: 38,
    editorialTone: "editorial",
    productionTier: "premium",
  },
  {
    id: "pop_garage",
    image: "/studio/studio-pop-garage.webp",
    editorialTone: "creator",
    productionTier: "creative",
  },
  {
    id: "pulp_podcast",
    image: "/studio/studio-pulp-podcast.webp",
    editorialTone: "creator",
    productionTier: "creative",
  },
  {
    id: "rooftop_hangout",
    image: "/studio/studio-rooftop-hangout.webp",
    editorialTone: "creator",
    productionTier: "creative",
  },
  {
    id: "late_night",
    image: "/studio/studio-late-night.webp",
    editorialTone: "creator",
    productionTier: "creative",
  },
  {
    id: "neon_playground",
    image: "/studio/studio-neon-playground.webp",
    editorialTone: "creator",
    productionTier: "creative",
  },
  {
    id: "broadcast_panel",
    image: "/studio/studio-broadcast-panel-seated.webp",
    foregroundImage: "/studio/studio-broadcast-panel-foreground.png",
    avatarBottomPercent: 38,
    editorialTone: "editorial",
    productionTier: "premium",
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
