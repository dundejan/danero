/**
 * Konec přihlášení z pohledu auto-save.
 *
 * Fronty automatického ukládání žijí s dokumentem (`components/ui/auto-submit.tsx`),
 * ne s přihlášením: odhlášení tlačítkem dokument nenačítá znovu, takže co po
 * účtu zbylo v paměti stránky, by tu bylo i pro účet, který se v témže panelu
 * přihlásí po něm. Revize R8 (M1): odeslání účtu A viselo v síti, A se
 * odhlásil, přihlásil se B — a formulář B převzal volbu účtu A jako „stav,
 * který právě odchází“ a s další změnou ji zapsal do svého profilu.
 *
 * Odhlášení proto probíhá ve dvou krocích:
 * 1. `flushAutoSave` PŘED odhlášením — co čeká na uložení, odejde hned, ještě
 *    pod tímhle přihlášením, a počká se, až doběhne. Jinak by změna udělaná
 *    těsně před klepnutím na „Odhlásit se“ zmizela beze slova;
 * 2. `resetAutoSave` PO potvrzeném odhlášení — zbytek se zahodí.
 *
 * Vedle toho je stav auto-save vedený zvlášť pro každý účet
 * (`lib/owner-tag.ts`) — konec přihlášení, o kterém se stránka nedozví
 * (vypršelo, odhlášení v jiném panelu), tak cizí stav k formuláři taky nepustí.
 *
 * Samostatný modul, aby tlačítko odhlášení nemuselo načítat kód formulářů.
 */
const flushes = new Set<() => Promise<void>>();
const resets = new Set<() => void>();

/** Jak dlouho smí odhlášení čekat na doběh ukládání (ms) — viset na něm nesmí. */
export const FLUSH_TIMEOUT_MS = 4000;

/** Přihlásí, co se má stihnout uložit před odhlášením, a úklid po něm. */
export function onAutoSaveSessionEnd(handlers: {
  flush: () => Promise<void>;
  reset: () => void;
}): void {
  flushes.add(handlers.flush);
  resets.add(handlers.reset);
}

/**
 * Před odhlášením: odešle, co čeká, a počká na doběh — nejdéle `timeoutMs`.
 * Nikdy nevyhazuje; odhlášení na ukládání nesmí ztroskotat.
 */
export async function flushAutoSave(timeoutMs: number = FLUSH_TIMEOUT_MS): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
  });
  const done = Promise.all(Array.from(flushes, (flush) => flush().catch(() => {})));
  await Promise.race([done, timeout]);
  clearTimeout(timer);
}

/** Po odhlášení: zahodí rozdělanou práci auto-save i všechno, co si pamatuje. */
export function resetAutoSave(): void {
  for (const reset of resets) reset();
}
