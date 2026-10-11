'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { cameFromHistoryCache, type NavigationInfo } from '@/lib/restored-page';

/**
 * Po návratu v historii obnoví stránku ze serveru, když ji prohlížeč vytáhl
 * ze své paměti (`lib/restored-page.ts`). Bez toho Zpět ukázalo Nastavení
 * tak, jak vypadalo před odchodem — i když se mezitím změnilo jinde.
 *
 * Patří do rozložení aplikace, ne do jedné stránky: starý stav je stejně
 * špatně na přehledu i ve Zdrojích dat. `router.refresh()` vymění jen data
 * ze serveru; co má člověk na stránce rozdělané (rozbalený řádek, vybraný
 * limit), zůstává. A kdo se mezitím odhlásil, toho serverová část pošle na
 * přihlášení, místo aby mu prohlížeč ukázal poslední obrazovku s daty.
 */
export function RefreshOnRestore() {
  const router = useRouter();
  useEffect(() => {
    // dokument načtený z mezipaměti při Zpět/Vpřed — efekt běží jednou na
    // načtení dokumentu (rozložení přechody uvnitř aplikace přežívá)
    const [navigation] = performance.getEntriesByType('navigation') as NavigationInfo[];
    if (cameFromHistoryCache(navigation)) router.refresh();
    // Stránka rozmrazená z bfcache: nic se nenačítalo, efekty neběží znovu.
    // Obnovení se pouští až po doběhu události: tutéž událost poslouchá
    // i směrovač Nextu a po ní vrací svůj stav z historie — obnovení
    // spuštěné dřív jako rozdělanou práci zahodí (změřeno: dotaz na server
    // odešel, čerstvá odpověď přišla a stránka zůstala stará).
    let deferred: ReturnType<typeof setTimeout> | undefined;
    const onPageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      clearTimeout(deferred);
      deferred = setTimeout(() => router.refresh(), 0);
    };
    window.addEventListener('pageshow', onPageShow);
    return () => {
      clearTimeout(deferred);
      window.removeEventListener('pageshow', onPageShow);
    };
  }, [router]);
  return null;
}
