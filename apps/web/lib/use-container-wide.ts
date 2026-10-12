'use client';

import { useEffect, useState, type RefObject } from 'react';

/**
 * Je okno s obsahem aspoň `minRem` široké? Pro rozvržení „seznam + inspektor“,
 * kde šířka mění nejen vzhled (to umí `@container` v CSS), ale i chování:
 * v širokém okně klik řádek vybírá a detail stojí vedle, v úzkém otevírá sheet
 * nebo vede na podstránku.
 *
 * Měří se prvek z `ref`, ne okno prohlížeče — postranní panel ubírá šířku
 * a práh má sedět s `@container` třídami v témže prvku. Práh je v rem, takže
 * respektuje nastavenou velikost písma.
 *
 * `initial` je hodnota do prvního měření (server šířku nezná): zvol tu, pro
 * kterou je vykreslení bez JavaScriptu použitelné.
 */
export function useContainerWide(
  ref: RefObject<HTMLElement | null>,
  minRem: number,
  initial: boolean,
): boolean {
  const [wide, setWide] = useState(initial);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const measure = () => {
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      setWide(root.clientWidth >= minRem * rem);
    };
    // pozorovatel ohlásí první měření sám hned po připojení
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => observer.disconnect();
  }, [ref, minRem]);

  return wide;
}
