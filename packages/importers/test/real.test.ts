/**
 * Akceptační test F2 na REÁLNÝCH datech (docs/05): vlož své Trading212 exporty
 * (CSV za každý rok od prvního nákupu) do `test/fixtures/real/` (gitignored)
 * a spusť `pnpm --filter @danero/importers test`. Bez souborů se přeskakuje.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TaxpayerProfileSchema, type Transaction } from '@danero/shared';
import { analyzeTaxYear, TAX_YEAR_2025, type TaxYearConfig } from '@danero/engine';
import { dedupeTransactions, parseTrading212Csv, TRADING212_BROKER } from '../src';

const realDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'real');
const files = existsSync(realDir)
  ? readdirSync(realDir)
      .filter((f) => f.toLowerCase().endsWith('.csv'))
      .sort()
  : [];

/**
 * ⚠️ ORIENTAČNÍ historické jednotné kurzy pro lokální běh (doplnit přesné z pokynů
 * řady D, viz docs/02 runbook). Rok 2025 je přesně dle pokynu GFŘ D-75.
 */
const REAL_CFG: TaxYearConfig = {
  ...TAX_YEAR_2025,
  unifiedRatesByYear: {
    2020: { USD: '23.14', EUR: '26.50' },
    2021: { USD: '21.72', EUR: '25.65' },
    2022: { USD: '23.41', EUR: '24.54' },
    2023: { USD: '22.14', EUR: '23.97' },
    2024: { USD: '23.30', EUR: '25.15' },
    ...TAX_YEAR_2025.unifiedRatesByYear,
  },
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

    const { fresh, duplicates } = dedupeTransactions(TRADING212_BROKER, all);
    console.info(`[real] ${fresh.length} unikátních transakcí (${duplicates} duplicit napříč soubory)`);

    const result = analyzeTaxYear({
      transactions: fresh,
      profile: TaxpayerProfileSchema.parse({ regime: 'PAUSAL' }),
      config: REAL_CFG,
    });

    console.info(
      `[real] 2025: tržby CP ${result.securities.totalGrossProceedsCzk.toFixed(2)} Kč, ` +
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
