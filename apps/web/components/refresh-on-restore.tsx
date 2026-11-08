'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
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
/**
 * Kolikrát čekání zopakovat, když směrovač krok v historii ještě nedokončil
 * (stojí na jiné cestě než adresa) — pak už obnovuje tak jako tak.
 */
const SETTLE_ATTEMPTS = 30;

export function RefreshOnRestore() {
  const router = useRouter();
  // Cesta, na které směrovač stojí — adresa se při `popstate` mění hned,
  // směrovač stránku přepne až po svém kroku v historii.
  const pathname = usePathname();
  const routerPath = useRef(pathname);
  useEffect(() => {
    routerPath.current = pathname;
  }, [pathname]);
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
    // krokem v historii (změřeno ve Firefoxu: ve dvou z 28 běhů skončil krok
    // Vpřed načtením celého dokumentu, po úpravě v žádném z 24). Krátké čekání nechá
    // směrovač vykreslit, co má, a další krok v historii čekání ruší.
    // Čeká se, dokud směrovač nestojí na nové cestě: Next 16.4 krok v historii
    // za 100 ms nestihl (v dev režimu pokaždé), obnovení pak dotáhlo stránku,
    // ze které se odcházelo, a nová zůstala stará (8. 11. 2026, test Zpět
    // a Vpřed v `e2e/nastaveni.spec.ts`).
    const onPopState = () => {
      clearTimeout(deferred);
      let attempts = 0;
      const settle = () => {
        attempts += 1;
        if (routerPath.current !== window.location.pathname && attempts < SETTLE_ATTEMPTS) {
          deferred = setTimeout(settle, SETTLE_MS);
          return;
        }
        if (!document.querySelector(SKELETON_SELECTOR)) router.refresh();
      };
      deferred = setTimeout(settle, SETTLE_MS);
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
