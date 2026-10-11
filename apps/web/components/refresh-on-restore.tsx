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
/** Kostra načítání stránky (`components/app-skeleton.tsx`). */
const SKELETON_SELECTOR = '[data-app-skeleton]';

/** Jak dlouho po kroku v historii počkat, než je jasné, co směrovač ukázal (ms). */
const SETTLE_MS = 100;

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
    // stránka rozmrazená z bfcache: nic se nenačítalo, efekty neběží znovu
    const onPageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      clearTimeout(deferred);
      deferred = setTimeout(() => router.refresh(), 0);
    };
    // Zpět/Vpřed uvnitř aplikace. Směrovač stránku buď vrátí z paměti (pak je
    // obnovení potřeba), nebo si pro ni sám dojde na server a mezitím ukáže
    // kostru načítání — tam by druhý dotaz byl navíc a pral se s dalším
    // krokem v historii (změřeno ve Firefoxu: zhruba v jednom běhu z osmi
    // skončil krok Vpřed načtením celého dokumentu). Krátké čekání nechá
    // směrovač vykreslit, co má, a další krok v historii čekání ruší.
    const onPopState = () => {
      clearTimeout(deferred);
      deferred = setTimeout(() => {
        if (!document.querySelector(SKELETON_SELECTOR)) router.refresh();
      }, SETTLE_MS);
    };
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('popstate', onPopState);
    return () => {
      clearTimeout(deferred);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('popstate', onPopState);
    };
  }, [router]);
  return null;
}
