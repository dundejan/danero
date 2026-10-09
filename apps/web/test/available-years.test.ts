import { describe, expect, it } from 'vitest';
import { TransactionSchema, type Transaction } from '@danero/shared';
import { demoDataset } from '@/lib/demo-data';
import { analyzeForUser, availableYears } from '@/lib/portfolio';
import { resolveTaxYear } from '@/lib/utils';

/**
 * L7i-08: přepínač roku nabízí SOUVISLOU řadu let, ne jen roky s transakcí.
 *
 * `availableYears` čte u nákupu a prodeje datum OBCHODU, kdežto engine řadí
 * příjem do roku VYPOŘÁDÁNÍ (R-05a: „příjem patří do roku připsání peněz, ne
 * roku obchodu“). Prodej z posledních obchodních dnů prosince tak padne do
 * roku, ve kterém uživatel nemusí mít jedinou transakci — a ten rok v přepínači
 * chyběl, takže adresa s ním tiše skočila na letošek (`resolveTaxYear`) a celé
 * zdaňovací období s povinností bylo nedosažitelné.
 */

const FUND = { isin: 'IE00B4L5Y983', ticker: 'IWDA', name: 'Fond', currency: 'EUR' };

const buy = (id: string, tradeDate: string, quantity: string, pricePerShare: string): Transaction =>
  TransactionSchema.parse({ id, type: 'BUY', ...FUND, quantity, pricePerShare, tradeDate });

const sell = (id: string, tradeDate: string, quantity: string, pricePerShare: string): Transaction =>
  TransactionSchema.parse({ id, type: 'SELL', ...FUND, quantity, pricePerShare, tradeDate });

/** Nákup 2023, prodej s obchodem 29. 12. 2023, další nákup až 2025. */
const yearEndSale: Transaction[] = [
  buy('b1', '2023-06-01', '50', '75'),
  sell('s1', '2023-12-29', '50', '90'),
  buy('b2', '2025-05-05', '1', '100'),
];

describe('availableYears: roky v přepínači zdaňovacího období (L7i-08)', () => {
  it('rok vypořádání prosincového prodeje je v seznamu, i když v něm není žádná transakce (R-05a)', () => {
    const years = availableYears(yearEndSale, 2026);
    expect(years).toEqual([2026, 2025, 2024, 2023]);

    // engine řadí příjem z prodeje do roku 2024 — a ten rok musí jít otevřít
    const { profile } = demoDataset('2026-10-08');
    const { result } = analyzeForUser(yearEndSale, profile, 2024, '2026-10-08');
    const incomeYears = result.ledger.disposals.map((disposal) => disposal.incomeYear);
    expect(incomeYears).toEqual([2024]);
    for (const year of incomeYears) expect(years).toContain(year);
    // tržba je vidět jen v roce 2024; v roce obchodu (2023) po ní není stopa
    expect(result.securities.totalGrossProceedsCzk.gt(0)).toBe(true);
    const tradeYear = analyzeForUser(yearEndSale, profile, 2023, '2026-10-08').result;
    expect(tradeYear.securities.totalGrossProceedsCzk.isZero()).toBe(true);
  });

  it('adresa s rokem vypořádání se nepřesměruje na letošek', () => {
    const years = availableYears(yearEndSale, 2026);
    // `resolveTaxYear` u roku mimo seznam volá `redirect()`, který vyhazuje
    expect(resolveTaxYear('2024', years, 2026, '/prehled')).toBe(2024);
  });

  it('rok bez transakcí uprostřed historie v řadě nechybí', () => {
    const txs = [
      buy('b1', '2022-03-01', '10', '70'),
      buy('b2', '2024-04-02', '5', '80'),
      buy('b3', '2026-02-03', '1', '100'),
    ];
    expect(availableYears(txs, 2026)).toEqual([2026, 2025, 2024, 2023, 2022]);

    // prázdný rok se spočítá jako každý jiný — vyjde s nulami, nespadne
    const { profile } = demoDataset('2026-10-08');
    const { result } = analyzeForUser(txs, profile, 2023, '2026-10-08');
    expect(result.year).toBe(2023);
    expect(result.securities.totalGrossProceedsCzk.isZero()).toBe(true);
  });

  it('nákup před lety a nic dalšího: řada vede bez mezer až po letošek', () => {
    expect(availableYears([buy('b1', '2021-09-09', '3', '60')], 2026)).toEqual([
      2026, 2025, 2024, 2023, 2022, 2021,
    ]);
  });

  it('bez transakcí zůstává jen běžný rok', () => {
    expect(availableYears([], 2026)).toEqual([2026]);
  });

  it('transakce s datem po běžném roce v seznamu zůstává', () => {
    expect(availableYears([buy('b1', '2027-01-04', '1', '100')], 2026)).toEqual([2027, 2026]);
  });
});
