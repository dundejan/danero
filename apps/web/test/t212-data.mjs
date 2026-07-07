/**
 * Jediný zdroj testovacích T212 dat — sdílí ho vitest mock (test/t212-mock.ts)
 * i E2E mock server (e2e/t212-mock-server.mjs). Scénář: nákup 100 AAPL (2024),
 * prodej 50 (2026), 2025 prázdný → aktuální pozice 50 ks, rekonciliace sedí.
 * `idPrefix` odlišuje ID transakcí per konzument (dedupe je nesmí srazit).
 */

export const CSV_HEADER =
  'Action,Time,ISIN,Ticker,Name,No. of shares,Price / share,Currency (Price / share),Exchange rate,Result,Currency (Result),Total,Currency (Total),Withholding tax,Currency (Withholding tax),Notes,ID';

/**
 * @param {string} idPrefix
 * @returns {Record<number, string>} CSV obsah per rok (chybějící rok = prázdný soubor)
 */
export function csvByYear(idPrefix) {
  return {
    2026: [
      CSV_HEADER,
      `Market sell,2026-03-05 15:01:10,US0378331005,AAPL,Apple Inc,50,210.00,USD,,,,,,,,,${idPrefix}2`,
    ].join('\n'),
    2024: [
      CSV_HEADER,
      `Market buy,2024-06-10 14:30:02,US0378331005,AAPL,Apple Inc,100,185.50,USD,,,,,,,,,${idPrefix}1`,
    ].join('\n'),
  };
}

export const PORTFOLIO = [
  { ticker: 'AAPL_US_EQ', quantity: 50, averagePrice: 185.5, currentPrice: 210, ppl: 0 },
];

export const INSTRUMENTS = [
  { ticker: 'AAPL_US_EQ', isin: 'US0378331005', currencyCode: 'USD', name: 'Apple' },
];

export const CASH = { free: 100, total: 100, invested: 0 };
