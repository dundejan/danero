'use client';

import { useEffect } from 'react';

/**
 * Rozbalí `<details>`, na který míří kotva v adrese, a dojede k němu.
 *
 * Odkaz „Napojit automaticky“ nebo „jak šablonu vyplnit“ vede na zavřený
 * rozbalovací řádek — bez tohohle by stránka jen poskočila a člověk by hledal,
 * kam ho odkaz poslal. Prohlížeč sám rozbaluje jen obsah UVNITŘ zavřeného
 * detailu (a ne každý), ne detail, který kotvu nese.
 *
 * Otevírá i všechny zavřené `<details>` NAD cílem: řádek importu (`#import-…`,
 * odkaz z hlášky číselníku) leží uvnitř skupiny své platformy a ta bývá
 * zavřená — otevřený řádek v zavřené skupině by pořád nebyl vidět.
 */
export function OpenOnHash() {
  useEffect(() => {
    const reveal = (): void => {
      let id: string;
      try {
        id = decodeURIComponent(window.location.hash.slice(1));
      } catch {
        // rozbitá procenta v kotvě (odkaz může poslat kdokoli) — nic neotvírej,
        // neodchycená výjimka v efektu by shodila celou stránku
        return;
      }
      if (!id) return;
      const target = document.getElementById(id);
      if (!target) return;
      const closed: HTMLDetailsElement[] = [];
      for (
        let element: Element | null = target;
        element;
        element = element.parentElement?.closest('details') ?? null
      ) {
        if (element instanceof HTMLDetailsElement && !element.open) closed.push(element);
      }
      if (closed.length === 0) return;
      for (const details of closed) details.open = true;
      target.scrollIntoView({ block: 'start' });
    };
    reveal();
    window.addEventListener('hashchange', reveal);
    return () => window.removeEventListener('hashchange', reveal);
  }, []);
  return null;
}
