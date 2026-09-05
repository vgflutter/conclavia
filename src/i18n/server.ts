import { cookies, headers } from "next/headers";

import {
  isLocale,
  LOCALE_COOKIE,
  localeFromLanguageTag,
  type Locale,
} from "@/i18n/locale";

export async function getRequestLocale(): Promise<Locale> {
  const cookieLocale = (await cookies()).get(LOCALE_COOKIE)?.value;

  if (isLocale(cookieLocale)) {
    return cookieLocale;
  }

  return localeFromLanguageTag((await headers()).get("accept-language"));
}
