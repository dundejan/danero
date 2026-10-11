/**
 * Kam auto-save hlásí, jak dopadl.
 *
 * Formulář, který změnu odeslal, už ve chvíli odpovědi nemusí existovat:
 * uložení ho vykreslí znovu a při odchodu ze stránky zanikne úplně (rozepsaná
 * částka se ukládá právě při odchodu). Potvrzení i chyba proto jdou do
 * úložiště mimo komponenty a ukazuje je rozložení aplikace
 * (`components/auto-save-feedback.tsx`), které přechody mezi stránkami přežívá.
 *
 * Adresu stránky to nemění — dřív potvrzení neslo přesměrování s `?ok=`
 * a každá změna přidala krok do historie prohlížeče.
 */

export interface SaveFeedback {
  /** Pořadové číslo — nová hláška téhož znění se musí ukázat znovu. */
  id: number;
  kind: 'ok' | 'chyba';
  text: string;
}

let current: SaveFeedback | null = null;
let nextId = 1;
const listeners = new Set<() => void>();

/** Ukáže hlášku (nahradí předchozí). */
export function announce(kind: SaveFeedback['kind'], text: string): void {
  current = { id: nextId++, kind, text };
  for (const listener of listeners) listener();
}

export function subscribeToFeedback(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const currentFeedback = (): SaveFeedback | null => current;

let refresher: (() => void) | null = null;

/** Rozložení aplikace sem dává `router.refresh()`; `null` při odmontování. */
export function setRefresher(refresh: (() => void) | null): void {
  refresher = refresh;
}

/**
 * Dotáhne stránku ze serveru. Uložení při odchodu jde mimo směrovač (musí
 * přežít zavření panelu), takže data na obrazovce po něm obnovit někdo musí.
 */
export function refreshFromServer(): void {
  refresher?.();
}
