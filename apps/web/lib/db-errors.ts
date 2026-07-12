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
