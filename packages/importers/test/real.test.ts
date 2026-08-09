/**
 * Akceptační test F2 na REÁLNÝCH datech (docs/05): vlož své Trading212 exporty
 * (CSV za každý rok od prvního nákupu) do `test/fixtures/real/` (gitignored)
 * a spusť `pnpm --filter @danero/importers test`. Bez souborů se přeskakuje.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TaxpayerProfileSchema, yearOf, type Transaction } from '@danero/shared';
import {
  analyzeTaxYear,
  TAX_YEAR_2025,
  TAX_YEAR_2026_DRAFT,
  type TaxYearConfig,
} from '@danero/engine';
import { dedupeTransactions, parseTrading212Csv, TRADING212_BROKER } from '../src';

const realDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'real');
const files = existsSync(realDir)
  ? readdirSync(realDir)
      .filter((f) => f.toLowerCase().endsWith('.csv'))
      .sort()
  : [];

/**
 * ⚠️ ORIENTAČNÍ jednotné kurzy pro lokální běh (doplnit přesné z pokynů řady D,
 * viz docs/02 runbook). Rok 2025 je přesně dle pokynu GFŘ D-75; kurz za 2026
 * vyjde až v lednu 2027 — pro celoroční hlídání je placeholder v pořádku.
 */
const UNIFIED_RATES: Record<number, Record<string, string>> = {
  2020: { USD: '23.14', EUR: '26.50', GBP: '29.80', PLN: '5.90', AUD: '16.00', CAD: '17.30' },
  2021: { USD: '21.72', EUR: '25.65', GBP: '29.90', PLN: '5.60', AUD: '16.30', CAD: '17.30' },
  2022: { USD: '23.41', EUR: '24.54', GBP: '28.90', PLN: '5.25', AUD: '16.20', CAD: '18.00' },
  2023: { USD: '22.14', EUR: '23.97', GBP: '27.60', PLN: '5.30', AUD: '14.70', CAD: '16.40' },
  2024: { USD: '23.30', EUR: '25.15', GBP: '29.20', PLN: '5.85', AUD: '15.40', CAD: '17.00' },
  2025: { ...TAX_YEAR_2025.unifiedRatesByYear[2025], GBP: '28.40', PLN: '5.80', AUD: '14.30', CAD: '15.80' },
  // placeholder do vydání pokynu za 2026:
  2026: { USD: '20.80', EUR: '24.40', GBP: '28.00', PLN: '5.75', AUD: '13.80', CAD: '15.20' },
};

const txDate = (tx: Transaction): string =>
  tx.type === 'BUY' || tx.type === 'SELL' ? tx.tradeDate : tx.date;

/** Konfigurace pro rok s nejnovější transakcí (typicky běžný rok — hlídač limitů). */
const configForYear = (year: number): TaxYearConfig => {
  const base = year >= 2026 ? TAX_YEAR_2026_DRAFT : TAX_YEAR_2025;
  return { ...base, year, unifiedRatesByYear: UNIFIED_RATES };
};

describe.skipIf(files.length === 0)('reálné exporty (fixtures/real)', () => {
  it('kompletní historie se naimportuje bez chyb a engine ji spočítá', () => {
    const all: Transaction[] = [];
    for (const file of files) {
      const result = parseTrading212Csv(readFileSync(join(realDir, file), 'utf8'));
      console.info(
        `[real] ${file}: ${result.transactions.length} transakcí, ${result.errors.length} chyb, ` +
          `${result.warnings.length} varování, ${result.skipped.length} přeskočeno`,
      );
      for (const error of result.errors) console.error(`[real] ${file}:${error.line} ${error.message}`);
      for (const warning of result.warnings) console.warn(`[real] ${file}:${warning.line} ${warning.message}`);
      expect(result.errors).toEqual([]);
      all.push(...result.transactions);
    }

    const outcome = dedupeTransactions(TRADING212_BROKER, all);
    const fresh = outcome.fresh.map((row) => row.tx);
    console.info(
      `[real] ${fresh.length} unikátních transakcí (${outcome.duplicates} duplicit napříč soubory)`,
    );

    const targetYear = Math.max(...fresh.map((tx) => yearOf(txDate(tx))));
    const result = analyzeTaxYear({
      transactions: fresh,
      profile: TaxpayerProfileSchema.parse({ regime: 'PAUSAL' }),
      config: configForYear(targetYear),
    });

    console.info(
      `[real] ${targetYear}: tržby CP ${result.securities.totalGrossProceedsCzk.toFixed(2)} Kč, ` +
        `základ §10 ${result.securities.base10Czk.toFixed(2)} Kč, ` +
        `§8 ${result.dividends.base8Czk.toFixed(2)} Kč, ` +
        `limit 50k: ${result.limits.flatTax50k.status.usedCzk.toFixed(2)} Kč (${result.limits.flatTax50k.status.zone})`,
    );
    for (const position of result.positions) {
      const nearest = position.lots.find((l) => !l.isExempt);
      console.info(
        `[real] pozice ${position.isin}: ${position.totalRemaining.toFixed(4)} ks` +
          (nearest ? `, nejbližší osvobození ${nearest.exemptFrom}` : ', vše osvobozeno'),
      );
    }
    for (const warning of result.warnings) {
      console.warn(`[real][${warning.level}] ${warning.code}: ${warning.message}`);
    }
  });
});
