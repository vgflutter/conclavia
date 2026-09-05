import Link from "next/link";

import { getRequestLocale } from "@/i18n/server";

export default async function MeetingNotFound() {
  const locale = await getRequestLocale();
  const isItalian = locale === "it";

  return (
    <div className="container-page py-14">
      <div className="card mx-auto max-w-xl p-7 text-center sm:p-10">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#295c43]">
          Meeting
        </p>
        <h1 className="mt-3 text-2xl font-bold">
          {isItalian ? "Meeting non trovato" : "Meeting not found"}
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-500">
          {isItalian
            ? "Il meeting non esiste oppure è stato rimosso."
            : "This meeting does not exist or has been removed."}
        </p>
        <Link href="/meetings" className="button-primary mt-6">
          {isItalian ? "Torna ai meeting" : "Back to meetings"}
        </Link>
      </div>
    </div>
  );
}
