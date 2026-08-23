/**
 * Rozpoznávání chyb Postgresu napříč vrstvami: Drizzle chyby balí
 * (DrizzleQueryError) — pg kód bývá v `cause`, ne na chybě samotné.
 */

/** 23505 = unique_violation (souběžný insert / obsazený unikátní sloupec). */
export function isUniqueViolation(error: unknown): boolean {
  for (let e = error; e instanceof Error; e = e.cause as Error) {
    if ((e as { code?: string }).code === '23505') return true;
    if (!(e.cause instanceof Error)) break;
  }
  return false;
}

/**
 * Chyba z databázové vrstvy, ne z obsahu souboru.
 *
 * Rozlišení je potřeba tam, kde se ze selhání odvozuje, jestli je vada NA NAŠÍ
 * straně (K5-08): výpadek spojení uprostřed importu se dosud tvářil stejně jako
 * rozbitý výpis — uživatel četl „soubor je nejspíš poškozený“, originál se
 * uschoval do `failed_imports` a provozovateli přišel falešný poplach o formátu,
 * který ve skutečnosti umíme přečíst.
 *
 * Poznává se podle toho, že chybu vyrobil Drizzle nebo driver: `DrizzleQueryError`
 * má v řetězu `cause` chybu s pg kódem (pětimístný SQLSTATE), postgres.js hlásí
 * síťové pády jako `CONNECTION_*` / `ECONNRESET`, PGlite jako `PGlite…`.
 */
export function isDatabaseError(error: unknown): boolean {
  for (let e = error; e instanceof Error; e = e.cause as Error) {
    if (e.name === 'DrizzleQueryError' || e.name === 'PostgresError') return true;
    const code = (e as { code?: unknown }).code;
    if (typeof code === 'string' && (/^[0-9A-Z]{5}$/.test(code) || code.startsWith('CONNECTION_') || code === 'ECONNRESET' || code === 'ECONNREFUSED')) {
      return true;
    }
    if (!(e.cause instanceof Error)) break;
  }
  return false;
}
