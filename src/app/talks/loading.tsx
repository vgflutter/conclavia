import { getRequestLocale } from "@/i18n/server";
import { translate } from "@/i18n/translations";

export default async function TalksLoading() {
  const locale = await getRequestLocale();

  return (
    <div
      className="container-page animate-pulse py-10 sm:py-14"
      aria-label={translate(locale, "loadingTalks")}
    >
      <div className="mb-8 h-10 w-48 rounded-lg bg-slate-200" />
      <div className="grid gap-4 md:grid-cols-2">
        {[0, 1, 2, 3].map((item) => (
          <div key={item} className="card p-5">
            <div className="mb-4 h-6 w-2/3 rounded bg-slate-200" />
            <div className="mb-2 h-4 w-full rounded bg-slate-100" />
            <div className="h-4 w-1/2 rounded bg-slate-100" />
          </div>
        ))}
      </div>
    </div>
  );
}
