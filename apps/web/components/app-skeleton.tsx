'use client';

import { usePathname } from 'next/navigation';

/**
 * Co má lišta stránky na telefonu navíc proti samotnému titulku. Přepínač
 * (rok, sekce nastavení) se tam láme na druhý řádek a akce je tlačítko vysoké
 * 44 px — kostra s jedním řádkem byla o 30 až 52 px nižší než hotová lišta
 * a obsah po načtení o tolik poskočil.
 *
 * Kostra je jedna pro celou skořápku (`loading.tsx` o stránce nic neví), tak
 * si tvar lišty čte z adresy, na kterou se jde. Nová stránka s přepínačem
 * nebo akcí v liště sem patří taky — jinak jí kostra neposedí.
 */
const TOOLBAR_SHAPES: readonly { match: RegExp; switcher?: true; action?: true }[] = [
  { match: /\/prehled$/, switcher: true, action: true },
  { match: /^\/report$/, switcher: true, action: true },
  // demo XML nestahuje, v liště mu zbývá jen přepínač roku
  { match: /^\/demo\/report$/, switcher: true },
  { match: /^\/nastaveni/, switcher: true },
  { match: /\/portfolio\/.+/, action: true },
];

export function toolbarShape(pathname: string): { switcher: boolean; action: boolean } {
  const shape = TOOLBAR_SHAPES.find((candidate) => candidate.match.test(pathname));
  return { switcher: shape?.switcher === true, action: shape?.action === true };
}

/**
 * Načítání stránky aplikace i dema (G9b). Kostra drží místo tomu, co přijde:
 * nahoře lišta ve stejné výšce, jakou bude mít hotová (i s druhým řádkem na
 * telefonu), pod ní titulek, dvě čísla a řádky seznamu. Je vysoká aspoň jako
 * okno, takže patička skořápky během načítání nevyskočí doprostřed obrazovky
 * a zase neodjede. Tvary jsou tiché výplně bez rámečků; s omezeným pohybem
 * nepulzují.
 */
export function AppSkeleton() {
  const { switcher, action } = toolbarShape(usePathname());
  return (
    <div
      // bez JavaScriptu kostru schová sdělení v `NoScriptNotice`; podle ní
      // taky `RefreshOnRestore` pozná, že si směrovač pro stránku došel sám
      data-app-skeleton=""
      role="status"
      aria-busy="true"
      aria-label="Načítám"
      className="min-h-dvh animate-pulse motion-reduce:animate-none"
    >
      {/* stejné rozměry a lámání jako `AppToolbar`: titulek 1,375rem na výšku,
          akce jako tlačítko `sm`, přepínač jako segmentový přepínač `sm` */}
      <div className="-mt-(--page-top) mb-(--page-top) flex min-h-(--toolbar-height) flex-wrap items-center gap-x-4 gap-y-2 py-2.5">
        <div className="flex h-[1.375rem] min-w-24 flex-1 items-center md:flex-initial">
          <div className="h-5 w-28 rounded-md bg-control" />
        </div>
        {switcher && (
          <div className="order-last flex w-full md:order-none md:ml-2 md:w-auto md:flex-1">
            <div className="h-7 w-64 max-w-full rounded-lg bg-canvas pointer-coarse:h-8" />
          </div>
        )}
        {action && (
          <div className="h-7 w-32 shrink-0 rounded-full bg-canvas md:ml-auto pointer-coarse:h-11" />
        )}
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
