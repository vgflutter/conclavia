export type Locale = "en" | "it";

export const LOCALE_COOKIE = "conclavia_locale";

export function isLocale(value: string | undefined): value is Locale {
  return value === "en" || value === "it";
}

export function localeFromLanguageTag(value: string | null): Locale {
  return value?.toLowerCase().startsWith("it") ? "it" : "en";
}
