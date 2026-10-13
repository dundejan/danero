/**
 * Jediný zdroj testovacích T212 dat — sdílí ho vitest mock (test/t212-mock.ts)
 * i E2E mock server (e2e/t212-mock-server.mjs). Scénář: nákup 100 AAPL (2024),
 * prodej 50 (2026), 2025 prázdný → aktuální pozice 50 ks, rekonciliace sedí.
 * `idPrefix` odlišuje ID transakcí per konzument (dedupe je nesmí srazit).
 */

export const CSV_HEADER =
  'Action,Time (UTC),ISIN,Ticker,Name,No. of shares,Price / share,Currency (Price / share),Exchange rate,Result,Currency (Result),Total,Currency (Total),Withholding tax,Currency (Withholding tax),Notes,ID';

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

export const POSITIONS = [
  {
    instrument: { ticker: 'AAPL_US_EQ', name: 'Apple', isin: 'US0378331005', currency: 'USD' },
    createdAt: '2024-06-10T14:30:02.000Z',
    quantity: 50,
    quantityAvailableForTrading: 50,
    quantityInPies: 0,
    currentPrice: 210,
    averagePricePaid: 185.5,
    walletImpact: {
      currency: 'EUR',
      totalCost: 8533,
      currentValue: 9660,
      unrealizedProfitLoss: 1127,
      fxImpact: null,
    },
  },
];

export const INSTRUMENTS = [
  { ticker: 'AAPL_US_EQ', isin: 'US0378331005', currencyCode: 'USD', name: 'Apple' },
];

export const ACCOUNT_SUMMARY = {
  id: 1234567,
  currency: 'EUR',
  totalValue: 9760,
  cash: { availableToTrade: 100, inPies: 0, reservedForOrders: 0 },
  investments: {
    currentValue: 9660,
    totalCost: 8533,
    realizedProfitLoss: 0,
    unrealizedProfitLoss: 1127,
  },
};
