import type { Metadata } from "next";
import Link from "next/link";

import { MeetingCreateForm } from "@/components/MeetingCreateForm";
import { getRequestLocale } from "@/i18n/server";
import { getMeetingAutomationPublicConfig } from "@/lib/meeting-bot-config";
import { getAssistantProfile } from "@/lib/assistant-profile";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  return { title: locale === "it" ? "Nuovo meeting" : "New meeting" };
}

export default async function NewMeetingPage() {
  const locale = await getRequestLocale();
  const isItalian = locale === "it";
  const automation = getMeetingAutomationPublicConfig();
  const profile = await getAssistantProfile();

  return (
    <div className="container-page py-10 sm:py-14">
      <Link
        href="/meetings"
        className="mb-6 inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-950"
      >
        <span aria-hidden="true">←</span>
        {isItalian ? "Tutti i meeting" : "All meetings"}
      </Link>
      <div className="mb-8 max-w-3xl">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#295c43]">
          {isItalian ? "Nuova programmazione" : "New schedule"}
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
          {isItalian ? "Prepara il collega digitale" : "Prepare the digital colleague"}
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-600 sm:text-base">
          {isItalian
            ? "Scegli un meeting singolo oppure una serie con più date e link. Gli appuntamenti della serie condivideranno automaticamente la memoria."
            : "Choose a single meeting or a series with multiple dates and links. Appointments in a series automatically share memory."}
        </p>
      </div>
      <MeetingCreateForm automation={automation} assistantName={profile.displayName} />
    </div>
  );
}
