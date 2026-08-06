import type { Metadata } from "next";
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

interface BroadcastPageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({
  params,
}: BroadcastPageProps): Promise<Metadata> {
  const { id } = await params;
  const locale = await getRequestLocale();
  if (!Types.ObjectId.isValid(id)) {
    return { title: translate(locale, "notFoundTitle") };
  }

  await connectToDatabase();
  const talk = await TalkModel.findById(id).select("title").exec();
  return {
    title: talk
      ? `${translate(locale, "openBroadcast")}: ${talk.title}`
      : translate(locale, "notFoundTitle"),
  };
}

export default async function BroadcastPage({ params }: BroadcastPageProps) {
  const { id } = await params;
  if (!Types.ObjectId.isValid(id)) notFound();

  await connectToDatabase();
  const [talkDocument, latestRun] = await Promise.all([
    TalkModel.findById(id).exec(),
    TalkRunModel.findOne({ talkId: id }).sort({ createdAt: -1 }).exec(),
  ]);

  if (!talkDocument) notFound();

  return (
    <TalkRunner
      talk={serializeTalk(talkDocument)}
      initialRun={latestRun ? serializeTalkRun(latestRun) : null}
      presentation="broadcast"
    />
  );
}
