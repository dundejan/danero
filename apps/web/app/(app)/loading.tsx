/** Skeleton pro všechny aplikační stránky (G9b) — vzhled kopíruje mřížku karet. */
export default function AppLoading() {
  return (
    <div role="status" className="animate-pulse space-y-6" aria-busy="true" aria-label="Načítám">
      <div className="h-9 w-56 rounded-md bg-linka/60" />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="h-36 rounded-lg border border-linka bg-plocha p-4">
            <div className="h-4 w-2/3 rounded bg-linka/60" />
            <div className="mt-3 h-7 w-1/2 rounded bg-linka/40" />
            <div className="mt-4 h-3 w-full rounded bg-linka/30" />
          </div>
        ))}
      </div>
    </div>
  );
}
