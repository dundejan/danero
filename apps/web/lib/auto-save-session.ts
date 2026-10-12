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
 * Odhlášení proto všechno zahodí (`resetAutoSave`). Vedle toho je stav
 * auto-save vedený zvlášť pro každý účet (`lib/owner-tag.ts`) — konec
 * přihlášení, o kterém se stránka nedozví (vypršelo, odhlášení v jiném
 * panelu), tak cizí stav k formuláři taky nepustí.
 *
 * Samostatný modul, aby tlačítko odhlášení nemuselo načítat kód formulářů.
 */
const resets = new Set<() => void>();

/** Přihlásí úklid, který se má provést při odhlášení. */
export function onAutoSaveReset(reset: () => void): void {
  resets.add(reset);
}

/** Odhlášení: zahodí rozdělanou práci auto-save i všechno, co si pamatuje. */
export function resetAutoSave(): void {
  for (const reset of resets) reset();
}
