import { and, gte, lte, sql } from 'drizzle-orm';
import { d, type Money } from '@danero/shared';
import type { DailyRateProvider } from '@danero/engine';
import type { Db } from '@/db';
import { fxRates } from '@/db/schema';
import { logEvent } from '@/lib/log';

/**
 * Denní kurzy ČNB (R-06b): oficiální roční textový export ČNB → cache v DB
 * (fx_rates). Kurzy se normalizují na CZK za 1 jednotku (ČNB kotuje např.
 * JPY za 100). Víkendy/svátky kurz nemají — provider bere poslední vyhlášený
 * kurz přede dnem (praxe finanční správy).
 */

const CNB_YEAR_URL = (year: number) =>
  `https://www.cnb.cz/cs/financni-trhy/devizovy-trh/kurzy-devizoveho-trhu/kurzy-devizoveho-trhu/rok.txt?rok=${year}`;

/** Číslo s desetinnou tečkou — cokoli jiného (`N/A`, pomlčka, prázdno) přeskočíme. */
const NUMBER_RE = /^-?\d+(\.\d+)?$/;

/** Vypadá text jako kurzovní lístek ČNB, nebo jsme dostali chybovou stránku? */
export function looksLikeCnbYearText(text: string): boolean {
  return /^Datum\s*\|/.test(text.trimStart());
}

/** Parsuje roční export ČNB: 1. řádek hlavička „Datum|1 AUD|100 JPY|…“, pak dny. */
export function parseCnbYearText(
  text: string,
): Array<{ day: string; currency: string; rate: string }> {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];
  let invalidCells = 0;

  // ČNB při změně kurzovního lístku uprostřed roku vloží NOVOU hlavičku
  // (ověřeno na roce 2022 — vypadl RUB) — mapování sloupců se musí přepočítat,
  // jinak se všechny měny za změnou posunou.
  const parseHeader = (line: string) =>
    line
      .split('|')
      .slice(1)
      .map((cell) => {
        const [amount, code] = cell.trim().split(/\s+/);
        // nečíselné množství v hlavičce (poškozený soubor) nesmí shodit celý
        // rok — nula ho níž vyřadí stejně jako sloupec bez kódu měny
        return {
          amount: d(NUMBER_RE.test(amount ?? '') ? amount! : '0'),
          code: (code ?? '').toUpperCase(),
        };
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
      // G-4: tvar se musí ověřit PŘED d(raw) — Decimal na „N/A“ nebo pomlčce
      // vyhodí a jedna taková buňka by shodila kurzy celého roku
      if (!NUMBER_RE.test(raw)) {
        invalidCells += 1;
        return;
      }
      const value = d(raw);
      if (!value.isFinite() || value.lte(0) || column.amount.lte(0)) return;
      rows.push({ day, currency: column.code, rate: value.div(column.amount).toString() });
    });
  }
  if (invalidCells > 0) {
    logEvent('warn', 'cnb.cells_skipped', { invalidCells, rows: rows.length });
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
  const text = await response.text();
  // G-6: ČNB umí při výpadku vrátit HTTP 200 s HTML chybovou stránkou. Ta se
  // rozparsuje na nula řádků a cron by hlásil úspěch, zatímco kurzy stojí.
  if (!looksLikeCnbYearText(text)) {
    throw new Error(
      `ČNB kurzy pro rok ${year}: odpověď není kurzovní lístek (chybí hlavička „Datum|“) — služba nejspíš hlásí výpadek. Zkus to později.`,
    );
  }
  const rows = parseCnbYearText(text);
  if (rows.length === 0) {
    logEvent('warn', 'cnb.year_empty', { year });
  }

  // G-5: duplicitní (den, měna) — třeba táž měna dvakrát v hlavičce — shodí
  // celý upsert („ON CONFLICT DO UPDATE cannot affect row a second time“,
  // jen na skutečném Postgresu, PGlite to spolkne). Poslední hodnota vyhrává.
  const unique = new Map<string, { day: string; currency: string; rate: string }>();
  for (const row of rows) unique.set(`${row.day}|${row.currency}`, row);
  const values = [...unique.values()];

  // dávkový upsert po dnech (řádově tisíce řádků za rok)
  for (let i = 0; i < values.length; i += 500) {
    await db
      .insert(fxRates)
      .values(values.slice(i, i + 500))
      .onConflictDoUpdate({
        target: [fxRates.day, fxRates.currency],
        set: { rate: sql`excluded.rate` },
      });
  }
  return values.length;
}

/**
 * Poslední den roku, ke kterému ČNB kurz vyhlašuje: 31. 12., pokud je pracovní
 * den, jinak nejbližší předchozí pátek (31. 12. není státní svátek).
 */
export function lastCnbDayOfYear(year: number): string {
  const date = new Date(Date.UTC(year, 11, 31));
  while (date.getUTCDay() === 0 || date.getUTCDay() === 6) {
    date.setUTCDate(date.getUTCDate() - 1);
  }
  return date.toISOString().slice(0, 10);
}

/**
 * Je rok v DB pokrytý natolik, že se z něj dá počítat?
 *
 * Jediné místo, kde se to rozhoduje — stahování i kontrola před výpočtem se
 * musí ptát stejně, jinak se rozejdou. Přesně to se stalo: `ensureCnbYears`
 * považovala rok bez řádků za „ke stažení“, ale výpočet se ptal jen
 * `provider.isEmpty` (tj. „je prázdná CELÁ tabulka?“), takže chybějící rok
 * uprostřed rozsahu nikdo nepoznal (nález F-3-2).
 */
export async function cnbYearCoverage(
  db: Db,
  year: number,
  now: Date = new Date(),
): Promise<{ rows: number; maxDay: string | null; complete: boolean }> {
  const existing = await db
    .select({ n: sql<number>`count(*)`, maxDay: sql<string | null>`max(${fxRates.day})` })
    .from(fxRates)
    .where(and(gte(fxRates.day, `${year}-01-01`), lte(fxRates.day, `${year}-12-31`)));
  const rows = Number(existing[0]?.n ?? 0);
  const maxDay = existing[0]?.maxDay ?? null;
  const isCurrentYear = year === now.getUTCFullYear();

  if (isCurrentYear) {
    // běžný rok je „kompletní“, dokud data znatelně nezaostávají za dneškem
    if (rows === 0 || maxDay === null) return { rows, maxDay, complete: false };
    const ageDays = (now.getTime() - Date.parse(`${maxDay}T00:00:00Z`)) / 86_400_000;
    return { rows, maxDay, complete: ageDays < 5 };
  }
  // plný rok má ~250 pracovních dní × ~30 měn; < 1000 řádků = evidentně chybí.
  // Uzavřený rok je kompletní, jen když sahá až k poslednímu vyhlášenému dni:
  // rok stažený naposledy jako BĚŽNÝ (ranní cron) končí před 31. 12., a kurz
  // z 31. 12. ČNB vyhlašuje ~14:30, takže by bez dotažení chyběl navždy.
  const complete = rows >= 1000 && maxDay !== null && maxDay >= lastCnbDayOfYear(year);
  return { rows, maxDay, complete };
}

/** Zajistí kurzy pro dané roky — stáhne jen ty, které v DB citelně chybí. */
// Uzavřené roky dotažené už v tomto procesu: když roční soubor ČNB kurz
// z 31. 12. trvale neobsahuje (výpadek na straně ČNB), refetch by se jinak
// opakoval při každém renderu — jednou za život procesu stačí.
const refetchedClosedYears = new Set<number>();

export async function ensureCnbYears(
  db: Db,
  years: number[],
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  for (const year of [...new Set(years)]) {
    const { rows, complete } = await cnbYearCoverage(db, year);
    if (complete) continue;
    // uzavřený rok, který vypadá plný, ale nesahá k poslednímu dni: dotáhnout
    // jednou za život procesu, ne při každém renderu
    if (rows >= 1000) {
      if (refetchedClosedYears.has(year)) continue;
      refetchedClosedYears.add(year);
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
): Promise<DailyRateProvider & { isEmpty: boolean; missingYears: number[] }> {
  const rows = await db
    .select()
    .from(fxRates)
    .where(and(gte(fxRates.day, `${fromYear}-01-01`), lte(fxRates.day, `${toYear}-12-31`)));
  const map = new Map<string, Money>();
  const yearsWithRates = new Set<number>();
  for (const row of rows) {
    map.set(`${row.day}|${row.currency}`, d(row.rate));
    yearsWithRates.add(Number(row.day.slice(0, 4)));
  }
  // Které roky rozsahu nemají ANI JEDEN kurz. Počítá se z týchž řádků, žádný
  // dotaz navíc — a je to jediná informace, která chyběla: `isEmpty` se ptá na
  // celou tabulku, takže díru uprostřed rozsahu nepoznalo (F-3-2).
  const missingYears: number[] = [];
  for (let year = fromYear; year <= toYear; year += 1) {
    if (!yearsWithRates.has(year)) missingYears.push(year);
  }

  const shiftDay = (iso: string, days: number): string => {
    const date = new Date(`${iso}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  };

  return {
    isEmpty: map.size === 0,
    missingYears,
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
