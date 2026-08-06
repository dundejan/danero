import { sql, type SQL } from 'drizzle-orm';

/**
 * Datum do syrového `sql` fragmentu.
 *
 * ⚠️ Proč to existuje: `Date` předaný přímo do sql`` skončí u driveru
 * postgres.js jako netypovaný parametr a ten ho odmítne s „The string argument
 * must be of type string… Received an instance of Date". PGlite je tolerantní
 * a spolkne ho, takže se to v testech ani v dev režimu neprojeví — a rozbije se
 * to až na produkčním Postgresu. Přesně tak 6. 8. 2026 padal import výpisů
 * a hodinová záchrana zaseknutých jobů.
 *
 * V hodnotách `.values()` a `.set()` problém není, tam typ zná drizzle sám;
 * tenhle helper je jen pro syrové fragmenty.
 */
export function ts(date: Date): SQL {
  // sloupce jsou `timestamp` bez zóny a držíme v nich UTC — ISO řetězec
  // s explicitním přetypováním je jednoznačný pro Postgres i PGlite
  return sql`${date.toISOString()}::timestamp`;
}
