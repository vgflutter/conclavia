import type { Metadata } from "next";
import Link from "next/link";
import { Types } from "mongoose";
import { notFound } from "next/navigation";

import { TalkRunner } from "@/components/TalkRunner";
import { getRequestLocale } from "@/i18n/server";
import { translate } from "@/i18n/translations";
import { connectToDatabase } from "@/lib/mongodb";
import { serializeTalk } from "@/lib/serialize-talk";
import { serializeTalkRun } from "@/lib/serialize-talk-run";
import { TalkModel } from "@/models/Talk";
import { TalkRunModel } from "@/models/TalkRun";

export const dynamic = "force-dynamic";

interface TalkRunPageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({
  params,
}: TalkRunPageProps): Promise<Metadata> {
  const { id } = await params;
  const locale = await getRequestLocale();
  if (!Types.ObjectId.isValid(id)) {
    return { title: translate(locale, "notFoundTitle") };
  }

  await connectToDatabase();
  const talk = await TalkModel.findById(id).select("title").exec();
  return {
    title: talk
      ? `${translate(locale, "runTalk")}: ${talk.title}`
      : translate(locale, "notFoundTitle"),
  };
}

export default async function TalkRunPage({ params }: TalkRunPageProps) {
  const { id } = await params;
  const locale = await getRequestLocale();
  const t = (key: Parameters<typeof translate>[1]) => translate(locale, key);

  if (!Types.ObjectId.isValid(id)) {
    notFound();
  }

  await connectToDatabase();
  const [talkDocument, latestRun] = await Promise.all([
    TalkModel.findById(id).exec(),
    TalkRunModel.findOne({ talkId: id }).sort({ createdAt: -1 }).exec(),
  ]);

  if (!talkDocument) {
    notFound();
  }

  const talk = serializeTalk(talkDocument);

  return (
    <div className="container-page py-10 sm:py-14">
      <Link
        href={`/talks/${talk.id}`}
        className="mb-6 inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-950"
      >
        <span aria-hidden="true">←</span> {t("backToConfiguration")}
      </Link>

      <header className="mb-8">
        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[#295c43]">
          {t("runnerEyebrow")}
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
          {talk.title}
        </h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600 sm:text-base">
          {talk.topic}
        </p>
      </header>

      <TalkRunner
        talk={talk}
        initialRun={latestRun ? serializeTalkRun(latestRun) : null}
      />
    </div>
  );
}
