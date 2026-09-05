"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";

import { useTranslations } from "@/i18n/I18nProvider";
import type { Locale } from "@/i18n/locale";

export function Header() {
  const { locale, setLocale } = useTranslations();
  const pathname = usePathname();

  if (pathname.startsWith("/meeting-room/")) {
    return null;
  }

  return (
    <header className="border-b border-[#dfe4dc] bg-white/90 backdrop-blur">
      <div className="container-page flex min-h-16 items-center justify-between gap-3 py-2">
        <Link href="/meetings" aria-label="Conclavia" className="shrink-0">
          <Image
            src="/conclavia-logo.png"
            alt="Conclavia"
            width={2079}
            height={756}
            priority
            className="h-11 w-auto sm:h-12"
          />
        </Link>
        <nav
          aria-label={locale === "it" ? "Navigazione principale" : "Primary navigation"}
          className="flex items-center gap-1.5 sm:gap-2"
        >
          <Link
            href="/meetings"
            aria-current={pathname.startsWith("/meetings") ? "page" : undefined}
            className="hidden rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-950 md:inline-flex"
          >
            {locale === "it" ? "Meeting" : "Meetings"}
          </Link>
          <Link
            href="/memory"
            aria-current={pathname.startsWith("/memory") ? "page" : undefined}
            className="hidden rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-950 md:inline-flex"
          >
            {locale === "it" ? "Memoria" : "Memory"}
          </Link>
          <Link
            href="/avatar"
            aria-current={pathname.startsWith("/avatar") ? "page" : undefined}
            className="hidden rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-950 md:inline-flex"
          >
            Avatar
          </Link>
          <label className="sr-only" htmlFor="interface-language">
            {locale === "it" ? "Lingua dell’interfaccia" : "Interface language"}
          </label>
          <select
            id="interface-language"
            value={locale}
            onChange={(event) => setLocale(event.target.value as Locale)}
            className="min-h-10 rounded-lg border border-[#dfe4dc] bg-white px-2 text-sm font-medium outline-none focus:border-[#295c43] focus:ring-2 focus:ring-[#295c43]/20"
          >
            <option value="en">EN</option>
            <option value="it">IT</option>
          </select>
          <Link href="/meetings/new" className="button-primary whitespace-nowrap">
            {locale === "it" ? "Nuovo meeting" : "New meeting"}
          </Link>
        </nav>
      </div>
      <nav
        aria-label={locale === "it" ? "Navigazione mobile" : "Mobile navigation"}
        className="container-page grid grid-cols-3 border-t border-[#edf0eb] py-1.5 md:hidden"
      >
        {[
          { href: "/meetings", it: "Meeting", en: "Meetings" },
          { href: "/memory", it: "Memoria", en: "Memory" },
          { href: "/avatar", it: "Avatar", en: "Avatar" },
        ].map((item) => {
          const active = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`rounded-lg px-2 py-2 text-center text-xs font-semibold transition ${active ? "bg-[#edf4ef] text-[#295c43]" : "text-slate-500 hover:bg-slate-50"}`}
            >
              {locale === "it" ? item.it : item.en}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
