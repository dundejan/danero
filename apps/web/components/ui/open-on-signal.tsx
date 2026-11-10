'use client';

import { useEffect } from 'react';

/**
 * Otevře `<details>` s daným `id`, kdykoli přijde nový neprázdný `signal`.
 *
 * `defaultOpen` (`DetailsOnce`) platí jen při prvním vykreslení. Řádek, který
 * na stránce už je — skupina platformy v historii importů —, by po nahrání
 * dalšího výpisu zůstal zavřený a nově nahraná dávka v něm schovaná: stránka
 * se po akci jen překreslí, komponenty zůstávají. Signál nese id právě
 * nahraných dávek, takže se mění jen s novým nahráním; když z adresy zmizí
 * (úklid adresy, obnovení ze serveru), nic se nezavírá — o tom rozhoduje
 * uživatel.
 */
export function OpenOnSignal({ targetId, signal }: { targetId: string; signal: string }) {
  useEffect(() => {
    if (!signal) return;
    const target = document.getElementById(targetId);
    if (target instanceof HTMLDetailsElement) target.open = true;
  }, [targetId, signal]);
  return null;
}
