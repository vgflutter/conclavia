export default function MeetingsLoading() {
  return (
    <div className="container-page animate-pulse py-10 sm:py-14" aria-label="Caricamento meeting / Loading meetings">
      <div className="h-64 rounded-[2rem] bg-slate-200" />
      <div className="mt-10 grid gap-4 md:grid-cols-2">
        <div className="h-44 rounded-2xl bg-slate-200" />
        <div className="h-44 rounded-2xl bg-slate-200" />
      </div>
    </div>
  );
}
