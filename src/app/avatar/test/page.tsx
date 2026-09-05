import type { Metadata } from "next";
import Link from "next/link";

import { AvatarTestStudio } from "@/components/AvatarTestStudio";
import { getRequestLocale } from "@/i18n/server";
import { getAssistantProfile } from "@/lib/assistant-profile";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  return { title: locale === "it" ? "Prova avatar" : "Test avatar" };
}

export default async function AvatarTestPage() {
  const locale = await getRequestLocale();
  const isItalian = locale === "it";
  const profile = await getAssistantProfile();

  return (
    <div className="container-page py-10 sm:py-14">
      <Link
        href="/avatar"
        className="mb-6 inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-950"
      >
        <span aria-hidden="true">←</span>
        {isItalian ? "Torna all’avatar" : "Back to avatar"}
      </Link>
      <header className="mb-8 max-w-3xl">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#295c43]">
          {isItalian ? "Prova avatar" : "Avatar test"}
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
          {isItalian ? "Prova il collega digitale" : "Test the digital colleague"}
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-600 sm:text-base">
          {isItalian
            ? "Prova voce, espressioni e gesti senza creare o avviare una riunione."
            : "Test voice, expressions and gestures without creating or starting a meeting."}
        </p>
      </header>
      <AvatarTestStudio profile={profile} locale={locale} />
    </div>
  );
}
