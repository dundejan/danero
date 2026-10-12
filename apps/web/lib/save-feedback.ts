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
 *
 * Úložiště žije déle než rozložení aplikace (to zaniká s každým odchodem na
 * veřejnou stránku nebo na přihlášení), takže hláška nesmí přežít svoje
 * zobrazení: do revize R7 se „Uloženo…“ ukázalo znovu po návratu do aplikace
 * a po odhlášení i dalšímu účtu přihlášenému v témže panelu. Proto:
 * - hláška, kterou uživatel viděl odejít, se z úložiště maže (`dismissFeedback`),
 * - nese, čí formulář ji vyvolal (`owner`), a jinému účtu se neukáže,
 * - stará hláška (`FEEDBACK_MAX_AGE_MS`) se po návratu do aplikace neukazuje,
 * - odhlášení úložiště vyprázdní.
 */

export interface SaveFeedback {
  /** Pořadové číslo — nová hláška téhož znění se musí ukázat znovu. */
  id: number;
  kind: 'ok' | 'chyba';
  text: string;
  /** Čí formulář hlášku vyvolal (`lib/owner-tag.ts`). */
  owner: string;
  /** Kdy vznikla (ms od epochy). */
  at: number;
}

/**
 * Jak starou hlášku ještě ukázat rozložení, které právě vzniklo (návrat do
 * aplikace): uložení při odchodu se potvrzuje až na další stránce, ale ne
 * někomu, kdo se vrátil za čtvrt hodiny.
 */
export const FEEDBACK_MAX_AGE_MS = 15_000;

let current: SaveFeedback | null = null;
let nextId = 1;
const listeners = new Set<() => void>();

const notify = (): void => {
  for (const listener of listeners) listener();
};

/** Ukáže hlášku (nahradí předchozí). */
export function announce(
  kind: SaveFeedback['kind'],
  text: string,
  owner: string,
  now: number = Date.now(),
): void {
  current = { id: nextId++, kind, text, owner, at: now };
  notify();
}

/**
 * Smaže hlášku: tu s daným `id` (zmizela z obrazovky, nepatří tomuhle účtu,
 * je stará), nebo bez `id` jakoukoli (odhlášení).
 */
export function dismissFeedback(id?: number): void {
  if (current === null || (id !== undefined && current.id !== id)) return;
  current = null;
  notify();
}

/** Smí rozložení účtu `owner`, které vzniklo v čase `mountedAt`, hlášku ukázat? */
export function feedbackIsFor(feedback: SaveFeedback, owner: string, mountedAt: number): boolean {
  return feedback.owner === owner && feedback.at >= mountedAt - FEEDBACK_MAX_AGE_MS;
}

export function subscribeToFeedback(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const currentFeedback = (): SaveFeedback | null => current;

let refresher: (() => void) | null = null;
let awaitingRefresh: Array<() => void> = [];

/**
 * Rozložení aplikace sem dává `router.refresh()`; `null` při odmontování
 * (kdo na dotažení stránky čekal, se dočká — už není co dotahovat).
 */
export function setRefresher(refresh: (() => void) | null): void {
  refresher = refresh;
  if (refresh === null) refreshSettled();
}

/** Rozložení hlásí, že dotažení stránky doběhlo. */
export function refreshSettled(): void {
  const waiting = awaitingRefresh;
  awaitingRefresh = [];
  for (const resolve of waiting) resolve();
}

/**
 * Dotáhne stránku ze serveru; slib se splní, až je nový stav na obrazovce.
 * Uložení při odchodu jde mimo směrovač (musí přežít zavření panelu), takže
 * data na obrazovce po něm obnovit někdo musí.
 */
export function refreshFromServer(): Promise<void> {
  const refresh = refresher;
  if (!refresh) return Promise.resolve();
  return new Promise((resolve) => {
    awaitingRefresh.push(resolve);
    refresh();
  });
}
