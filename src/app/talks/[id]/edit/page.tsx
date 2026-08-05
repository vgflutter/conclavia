import type { Metadata } from "next";
import Link from "next/link";
import { Types } from "mongoose";
import { notFound } from "next/navigation";

import { TalkForm } from "@/components/TalkForm";
import { getRequestLocale } from "@/i18n/server";
import { translate } from "@/i18n/translations";
import { connectToDatabase } from "@/lib/mongodb";
import { serializeTalk } from "@/lib/serialize-talk";
import { TalkModel } from "@/models/Talk";

export const dynamic = "force-dynamic";

interface EditTalkPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ duplicate?: string }>;
}

export async function generateMetadata({ params, searchParams }: EditTalkPageProps): Promise<Metadata> {
  const [{ id }, query, locale] = await Promise.all([
    params,
    searchParams,
    getRequestLocale(),
  ]);
  if (!Types.ObjectId.isValid(id)) return { title: translate(locale, "notFoundTitle") };
  await connectToDatabase();
  const talk = await TalkModel.findById(id).select("title").exec();
  if (!talk) return { title: translate(locale, "notFoundTitle") };
  return {
    title: `${translate(locale, query.duplicate === "1" ? "duplicateTalk" : "editTalk")} · ${talk.title}`,
  };
}

export default async function EditTalkPage({ params, searchParams }: EditTalkPageProps) {
  const [{ id }, query, locale] = await Promise.all([
    params,
    searchParams,
    getRequestLocale(),
  ]);
  if (!Types.ObjectId.isValid(id)) notFound();

  await connectToDatabase();
  const document = await TalkModel.findById(id).exec();
  if (!document) notFound();

  const talk = serializeTalk(document);
  const duplicate = query.duplicate === "1";
  const t = (key: Parameters<typeof translate>[1]) => translate(locale, key);

  return (
    <div className="container-page py-10 sm:py-14">
      <Link
        href={`/talks/${talk.id}`}
        className="mb-6 inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-950"
      >
        <span aria-hidden="true">←</span> {t("backToConfiguration")}
      </Link>
      <header className="mb-8">
        <p className="mb-2 text-sm font-semibold uppercase tracking-[0.16em] text-[#295c43]">
          {t("configuration")}
        </p>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          {t(duplicate ? "duplicateTalkTitle" : "editTalkTitle")}
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600 sm:text-base">
          {t(duplicate ? "duplicateTalkIntro" : "editTalkIntro")}
        </p>
      </header>
      <TalkForm
        initialTalk={talk}
        mode={duplicate ? "duplicate" : "edit"}
      />
    </div>
  );
}
