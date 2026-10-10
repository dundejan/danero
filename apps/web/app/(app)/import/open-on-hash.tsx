'use client';

import { useEffect } from 'react';

/**
 * Rozbalí `<details>`, na který míří kotva v adrese, a dojede k němu.
 *
 * Odkaz „Napojit automaticky“ nebo „jak šablonu vyplnit“ vede na zavřený
 * rozbalovací řádek — bez tohohle by stránka jen poskočila a člověk by hledal,
 * kam ho odkaz poslal. Prohlížeč sám rozbaluje jen obsah UVNITŘ zavřeného
 * detailu (a ne každý), ne detail, který kotvu nese.
 */
export function OpenOnHash() {
  useEffect(() => {
    const reveal = (): void => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (!id) return;
      const target = document.getElementById(id);
      if (!(target instanceof HTMLDetailsElement) || target.open) return;
      target.open = true;
      target.scrollIntoView({ block: 'start' });
    };
    reveal();
    window.addEventListener('hashchange', reveal);
    return () => window.removeEventListener('hashchange', reveal);
  }, []);
  return null;
}
