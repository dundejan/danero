import { and, gte, lte, sql } from 'drizzle-orm';
import { d, type Money } from '@danero/shared';
import type { DailyRateProvider } from '@danero/engine';
import type { Db } from '@/db';
import { fxRates } from '@/db/schema';

/**
 * Denní kurzy ČNB (R-06b): oficiální roční textový export ČNB → cache v DB
 * (fx_rates). Kurzy se normalizují na CZK za 1 jednotku (ČNB kotuje např.
 * JPY za 100). Víkendy/svátky kurz nemají — provider bere poslední vyhlášený
 * kurz přede dnem (praxe finanční správy).
 */

const CNB_YEAR_URL = (year: number) =>
  `https://www.cnb.cz/cs/financni-trhy/devizovy-trh/kurzy-devizoveho-trhu/kurzy-devizoveho-trhu/rok.txt?rok=${year}`;

/** Parsuje roční export ČNB: 1. řádek hlavička „Datum|1 AUD|100 JPY|…“, pak dny. */
export function parseCnbYearText(
  text: string,
): Array<{ day: string; currency: string; rate: string }> {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];

  // ČNB při změně kurzovního lístku uprostřed roku vloží NOVOU hlavičku
  // (ověřeno na roce 2022 — vypadl RUB) — mapování sloupců se musí přepočítat,
  // jinak se všechny měny za změnou posunou.
  const parseHeader = (line: string) =>
    line
      .split('|')
      .slice(1)
      .map((cell) => {
        const [amount, code] = cell.trim().split(/\s+/);
        return { amount: d(amount ?? '1'), code: (code ?? '').toUpperCase() };
      });

  let columns = parseHeader(lines[0]!);

  const rows: Array<{ day: string; currency: string; rate: string }> = [];
  for (const line of lines.slice(1)) {
    if (line.startsWith('Datum|')) {
      columns = parseHeader(line);
      continue;
    }
    const cells = line.split('|');
    const dateCz = cells[0]?.trim();
    if (!dateCz || !/^\d{2}\.\d{2}\.\d{4}$/.test(dateCz)) continue;
    const [dd, mm, yyyy] = dateCz.split('.');
    const day = `${yyyy}-${mm}-${dd}`;
    columns.forEach((column, index) => {
      const raw = cells[index + 1]?.trim().replace(',', '.');
      if (!raw || !column.code) return;
      const value = d(raw);
      if (!value.isFinite() || value.lte(0) || column.amount.lte(0)) return;
      rows.push({ day, currency: column.code, rate: value.div(column.amount).toString() });
    });
  }
  return rows;
}

/** Stáhne a uloží kurzy jednoho roku (idempotentně). Vrací počet uložených dní×měn. */
export async function fetchCnbYear(
  db: Db,
  year: number,
  fetchImpl: typeof fetch = fetch,
): Promise<number> {
  const response = await fetchImpl(CNB_YEAR_URL(year), {
    signal: AbortSignal.timeout(60_000),
    headers: { 'User-Agent': 'danero/1.0' },
  });
  if (!response.ok) {
    throw new Error(`ČNB kurzy pro rok ${year}: HTTP ${response.status} — zkus to později.`);
  }
  const rows = parseCnbYearText(await response.text());
  // dávkový upsert po dnech (řádově tisíce řádků za rok)
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    await db
      .insert(fxRates)
      .values(chunk.map((row) => ({ day: row.day, currency: row.currency, rate: row.rate })))
      .onConflictDoUpdate({
        target: [fxRates.day, fxRates.currency],
        set: { rate: sql`excluded.rate` },
      });
  }
  return rows.length;
}

/** Zajistí kurzy pro dané roky — stáhne jen ty, které v DB citelně chybí. */
export async function ensureCnbYears(
  db: Db,
  years: number[],
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  for (const year of [...new Set(years)]) {
    const existing = await db
      .select({ n: sql<number>`count(*)` })
      .from(fxRates)
      .where(and(gte(fxRates.day, `${year}-01-01`), lte(fxRates.day, `${year}-12-31`)));
    // plný rok má ~250 pracovních dní × ~30 měn; < 1000 řádků = evidentně chybí
    const count = Number(existing[0]?.n ?? 0);
    const isCurrentYear = year === new Date().getUTCFullYear();
    if (!isCurrentYear && count >= 1000) continue;
    if (isCurrentYear && count > 0) {
      // běžný rok drží čerstvý denní cron — stahovat znovu jen když data
      // očividně zaostávají (např. cron neběží), ne při každém renderu
      const newest = await db
        .select({ day: sql<string>`max(${fxRates.day})` })
        .from(fxRates)
        .where(and(gte(fxRates.day, `${year}-01-01`), lte(fxRates.day, `${year}-12-31`)));
      const maxDay = newest[0]?.day;
      if (maxDay) {
        const ageDays = (Date.now() - Date.parse(`${maxDay}T00:00:00Z`)) / 86_400_000;
        if (ageDays < 5) continue;
      }
    }
    await fetchCnbYear(db, year, fetchImpl);
  }
}

/**
 * Provider pro engine: kurzy načtené do paměti, s dohledáním posledního
 * vyhlášeného kurzu až 7 dní zpět (víkendy/svátky).
 */
export async function loadCnbRateProvider(
  db: Db,
  fromYear: number,
  toYear: number,
): Promise<DailyRateProvider & { isEmpty: boolean }> {
  const rows = await db
    .select()
    .from(fxRates)
    .where(and(gte(fxRates.day, `${fromYear}-01-01`), lte(fxRates.day, `${toYear}-12-31`)));
  const map = new Map<string, Money>();
  for (const row of rows) map.set(`${row.day}|${row.currency}`, d(row.rate));

  const shiftDay = (iso: string, days: number): string => {
    const date = new Date(`${iso}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  };

  return {
    isEmpty: map.size === 0,
    getRate(currency: string, date: string): Money | undefined {
      if (currency === 'CZK') return d(1);
      for (let back = 0; back <= 7; back += 1) {
        const rate = map.get(`${back === 0 ? date : shiftDay(date, -back)}|${currency}`);
        if (rate) return rate;
      }
      return undefined;
    },
  };
}
