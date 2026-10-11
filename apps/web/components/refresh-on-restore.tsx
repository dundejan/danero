'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { cameFromHistoryCache, type NavigationInfo } from '@/lib/restored-page';

/**
 * Po návratu v historii obnoví stránku ze serveru, když ji ukázala paměť —
 * prohlížeče (`lib/restored-page.ts`), nebo směrovače aplikace. Bez toho Zpět
 * ukázalo Nastavení tak, jak vypadalo před odchodem, i když se mezitím
 * změnilo jinde.
 *
 * Cesty jsou tři:
 * - dokument z mezipaměti prohlížeče při Zpět/Vpřed,
 * - stránka rozmrazená z bfcache (`pageshow` s `persisted`),
 * - Zpět/Vpřed UVNITŘ aplikace (`popstate`): směrovač Nextu vrátí stránku ze
 *   své paměti a serveru se nezeptá vůbec (změřeno 11. 10. 2026 v Chromiu
 *   i Firefoxu: po změně na druhém zařízení ukázalo Zpět i Vpřed starou
 *   hodnotu a žádný dotaz neodešel).
 *
 * Patří do rozložení aplikace, ne do jedné stránky: starý stav je stejně
 * špatně na přehledu i ve Zdrojích dat. `router.refresh()` vymění jen data
 * ze serveru; co má člověk na stránce rozdělané (rozbalený řádek, vybraný
 * limit, rozepsaná částka), zůstává. A kdo se mezitím odhlásil, toho
 * serverová část pošle na přihlášení, místo aby mu prohlížeč ukázal poslední
 * obrazovku s daty.
 */
export function RefreshOnRestore() {
  const router = useRouter();
  useEffect(() => {
    // dokument načtený z mezipaměti při Zpět/Vpřed — efekt běží jednou na
    // načtení dokumentu (rozložení přechody uvnitř aplikace přežívá)
    const [navigation] = performance.getEntriesByType('navigation') as NavigationInfo[];
    if (cameFromHistoryCache(navigation)) router.refresh();
    // Obnovení se pouští až po doběhu události: `pageshow` i `popstate`
    // poslouchá také směrovač Nextu a po nich vrací svůj stav z historie —
    // obnovení spuštěné dřív jako rozdělanou práci zahodí (změřeno: dotaz na
    // server odešel, čerstvá odpověď přišla a stránka zůstala stará).
    let deferred: ReturnType<typeof setTimeout> | undefined;
    const refreshAfterEvent = () => {
      clearTimeout(deferred);
      deferred = setTimeout(() => router.refresh(), 0);
    };
    // stránka rozmrazená z bfcache: nic se nenačítalo, efekty neběží znovu
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) refreshAfterEvent();
    };
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('popstate', refreshAfterEvent);
    return () => {
      clearTimeout(deferred);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('popstate', refreshAfterEvent);
    };
  }, [router]);
  return null;
}
