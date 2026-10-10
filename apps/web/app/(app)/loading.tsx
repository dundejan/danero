/**
 * Načítání stránky aplikace i dema (G9b). Kostra drží místo tomu, co přijde:
 * nahoře pruh ve výšce nástrojové lišty, pod ním titulek, dvě čísla a řádky
 * seznamu — obsah se pak objeví na svém místě a nic neposkočí. Tvary jsou
 * tiché výplně bez rámečků; s omezeným pohybem nepulzují.
 */
export default function AppLoading() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Načítám"
      className="animate-pulse motion-reduce:animate-none"
    >
      <div className="-mt-(--page-top) mb-(--page-top) flex min-h-(--toolbar-height) items-center py-2.5">
        <div className="h-5 w-28 rounded-md bg-control" />
      </div>
      <div className="max-w-[72rem] space-y-14 pt-2 md:pt-4">
        <div className="flex flex-wrap items-end justify-between gap-x-12 gap-y-6">
          <div className="space-y-3">
            <div className="h-4 w-44 rounded-md bg-canvas" />
            <div className="h-9 w-72 max-w-full rounded-lg bg-control" />
          </div>
          <div className="flex gap-10">
            <div className="h-14 w-28 rounded-lg bg-canvas" />
            <div className="h-14 w-28 rounded-lg bg-canvas" />
          </div>
        </div>
        <div className="space-y-4">
          <div className="h-6 w-36 rounded-md bg-control" />
          <div className="divide-y divide-line/70">
            {Array.from({ length: 4 }, (_, index) => (
              <div key={index} className="flex items-center justify-between gap-6 py-4">
                <div className="h-4 w-1/3 rounded-md bg-canvas" />
                <div className="h-4 w-20 rounded-md bg-canvas" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
