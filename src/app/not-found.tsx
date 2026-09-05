import Link from "next/link";

import { getRequestLocale } from "@/i18n/server";

export default async function NotFoundPage() {
  const locale = await getRequestLocale();
  const isItalian = locale === "it";

  return (
    <div className="container-page py-16">
      <section className="card mx-auto max-w-xl p-8 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#295c43]">404</p>
        <h1 className="mt-3 text-2xl font-bold">
          {isItalian ? "Questa pagina non esiste" : "This page does not exist"}
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          {isItalian
            ? "Torna ai meeting per continuare a lavorare con il collega digitale."
            : "Return to meetings to continue working with the digital colleague."}
        </p>
        <Link href="/meetings" className="button-primary mt-6">
          {isItalian ? "Vai ai meeting" : "Go to meetings"}
        </Link>
      </section>
    </div>
  );
}
