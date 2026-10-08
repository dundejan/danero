import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { d } from '@danero/shared';
import { LAST_VERIFIED_RATE_YEAR, UNIFIED_RATE_SOURCES, UNIFIED_RATES_VERIFIED } from '../src';

/**
 * R-06a: tabulka ověřených jednotných kurzů GFŘ proti podkladu, ze kterého
 * vznikla (nález L4-08 revize 5).
 *
 * `UNIFIED_RATES_VERIFIED` jsou vyhlášená čísla z pokynů řady D a vstupují do
 * každého přepočtu příjmu i výdaje. Do téhle chvíle je ale nedržel žádný test:
 * přepis kurzu GBP 2025 z 28,80 na 29,80 prošel celou sadou enginu, importérů
 * i webu, protože testy počítají s kulatými kurzy z fixtury (`CFG_2025`)
 * a reálné výpisy se v CI nepouštějí.
 *
 * Druhou kopií čísel je `docs/podklady/jednotne-kurzy-gfr.md` — tabulka opsaná
 * z oficiálních PDF. Test je porovnává buňku po buňce, takže překlep v jedné
 * z kopií shodí pipeline. Nový rok (runbook v docs/02, krok „leden roku R“)
 * se proto doplňuje do OBOU: do tabulky v kódu i do podkladu.
 */

const SOURCE_PATH = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  'docs',
  'podklady',
  'jednotne-kurzy-gfr.md',
);
const SOURCE_NAME = 'docs/podklady/jednotne-kurzy-gfr.md';

interface SourceCell {
  currency: string;
  year: number;
  /** CZK za 1 jednotku měny — u řádku „JPY/100“ už vydělené stem. */
  rate: string;
}

/** Tabulka z podkladu: řádek hlavičky s roky a pod ním řádky `| MĚNA | kurz | … |`. */
function readSourceTable(): { years: number[]; cells: SourceCell[] } {
  const rows = readFileSync(SOURCE_PATH, 'utf8')
    .split('\n')
    .filter((line) => line.trim().startsWith('|'))
    .map((line) =>
      line
        .split('|')
        .slice(1, -1)
        .map((cell) => cell.trim()),
    );

  const header = rows.find((row) => row[0] === 'Měna');
  const years = (header ?? []).slice(1).map(Number);

  const cells = rows.flatMap((row) => {
    // „JPY/100“ = pokyn kotuje za 100 jednotek, v kódu je kurz za 1 jednotku
    const match = /^([A-Z]{3})(\/100)?$/.exec(row[0] ?? '');
    if (!match) return [];
    const currency = match[1] ?? '';
    return years.map((year, index) => {
      const quoted = d(row[index + 1] ?? 'NaN');
      return { currency, year, rate: (match[2] ? quoted.div(100) : quoted).toString() };
    });
  });
  return { years, cells };
}

describe('R-06a: ověřené jednotné kurzy sedí na podklad z pokynů GFŘ', () => {
  const source = readSourceTable();

  it('podklad se podařilo přečíst celý (roky 2020–2025, aspoň 11 měn)', () => {
    // pojistka proti tichému „nic se neporovnalo“, kdyby se změnil tvar tabulky v podkladu
    expect(source.years.slice(0, 6)).toEqual([2020, 2021, 2022, 2023, 2024, 2025]);
    expect(source.years.every((year) => Number.isInteger(year))).toBe(true);
    expect(source.cells.length).toBeGreaterThanOrEqual(66);
    expect(source.cells.filter((cell) => d(cell.rate).isNaN())).toEqual([]);
  });

  it('R-06a: každý kurz z podkladu je v tabulce enginu ve stejné výši', () => {
    const mismatches = source.cells.flatMap(({ currency, year, rate }) => {
      const actual = UNIFIED_RATES_VERIFIED[year]?.[currency];
      return actual !== undefined && d(actual).eq(rate)
        ? []
        : [`${currency} ${year}: engine ${actual ?? 'chybí'}, ${SOURCE_NAME} ${rate}`];
    });
    expect(mismatches).toEqual([]);
  });

  it('R-06a: engine nemá kurz, který v podkladu není (rok ani měna navíc)', () => {
    const inSource = new Set(source.cells.map((cell) => `${cell.currency} ${cell.year}`));
    const extra = Object.entries(UNIFIED_RATES_VERIFIED).flatMap(([year, rates]) =>
      Object.keys(rates)
        .map((currency) => `${currency} ${year}`)
        .filter((key) => !inSource.has(key)),
    );
    expect(
      extra,
      `kurzy v unifiedRates.ts bez opory v ${SOURCE_NAME} — doplň je i do podkladu`,
    ).toEqual([]);
  });

  it('R-06a: roky tabulky, pokyny GFŘ a poslední ověřený rok mluví o stejných letech', () => {
    const years = Object.keys(UNIFIED_RATES_VERIFIED).map(Number);
    expect(Object.keys(UNIFIED_RATE_SOURCES).map(Number)).toEqual(years);
    expect(LAST_VERIFIED_RATE_YEAR).toBe(Math.max(...years));
    expect(source.years).toEqual(years);
  });
});
