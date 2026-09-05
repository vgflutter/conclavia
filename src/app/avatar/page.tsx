import type { Metadata } from "next";
import Link from "next/link";

import { AvatarSettingsForm } from "@/components/AvatarSettingsForm";
import { getRequestLocale } from "@/i18n/server";
import { getAssistantProfile } from "@/lib/assistant-profile";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  return { title: locale === "it" ? "Avatar" : "Avatar" };
}

export default async function AvatarPage() {
  const locale = await getRequestLocale();
  const isItalian = locale === "it";
  const profile = await getAssistantProfile();

  return (
    <div className="container-page py-10 sm:py-14">
      <div className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#295c43]">{isItalian ? "Avatar" : "Avatar"}</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">{isItalian ? "Il collega che entra nei meeting" : "The colleague that joins meetings"}</h1>
          <p className="mt-3 text-sm leading-6 text-slate-600 sm:text-base">{isItalian ? "Gestisci una sola identità visiva e vocale. È volutamente non realistica, professionale e riconoscibile." : "Manage one visual and vocal identity. It is deliberately non-realistic, professional and recognizable."}</p>
        </div>
        <Link href="/avatar/test" className="button-secondary shrink-0">
          {isItalian ? "Prova avatar" : "Test avatar"}
        </Link>
      </div>
      <AvatarSettingsForm profile={profile} />
    </div>
  );
}
