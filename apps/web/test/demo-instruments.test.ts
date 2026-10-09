import { describe, expect, it } from 'vitest';
import { isValidIsin } from '@danero/shared';
import { demoDataset, demoToday } from '@/lib/demo-data';

/**
 * Věrohodnost instrumentů v ukázkových datech (nález L7s-08). Demo tvrdí, že
 * „ISINy jsou skutečné“, a prohlídku si otevírají investoři: tokijský ticker
 * s japonským ISIN vedený v dolarech za cenu amerického ADR si přečtou na
 * první pohled — a nástroj, který se chlubí správnými měnami, tím ztrácí tvář.
 *
 * Daňová čísla dema se tu nehlídají (to dělá `demo-data.test.ts`); jde jen
 * o to, aby ticker, ISIN a měna jednoho titulu patřily k téže burzovní lince.
 */
const { txs, prices } = demoDataset(demoToday(new Date('2026-07-10T10:00:00Z')));

const trades = txs.filter((tx) => tx.type === 'BUY' || tx.type === 'SELL');
const dividends = txs.filter((tx) => tx.type === 'DIVIDEND');

/** Skutečný ISIN (ne náhradní identifikátor krypta nebo opce). */
const realIsin = (isin: string): boolean => /^[A-Z]{2}[A-Z0-9]{9}\d$/.test(isin);

/**
 * Měna domácí burzy podle země ISIN. Schválně jen země, kde je odpověď
 * jednoznačná: irské ETF se obchodují v dolarech i v eurech a kanadský titul
 * kótovaný zároveň v New Yorku má tam tentýž ISIN a dolarovou cenu.
 */
const HOME_CURRENCY: Record<string, string> = {
  US: 'USD',
  JP: 'JPY',
  GB: 'GBP',
  CH: 'CHF',
  DK: 'DKK',
  DE: 'EUR',
  FR: 'EUR',
  NL: 'EUR',
};

describe('demo: ticker, ISIN a měna titulu patří k sobě', () => {
  it('Toyota je americké ADR: ticker TM, ISIN US8923313071, dolary', () => {
    const toyota = trades.filter((tx) => tx.name === 'Toyota Motor');
    expect(toyota.length).toBeGreaterThan(0);
    for (const tx of toyota) {
      expect({ ticker: tx.ticker, isin: tx.isin, currency: tx.currency }).toEqual({
        ticker: 'TM',
        isin: 'US8923313071',
        currency: 'USD',
      });
    }
    expect(prices.get('US8923313071')?.currency).toBe('USD');
    // tokijská linka (ticker 7203, japonský ISIN) v datech nezůstala nikde
    expect(txs.some((tx) => 'isin' in tx && tx.isin === 'JP3633400001')).toBe(false);
    expect(trades.some((tx) => tx.ticker === '7203')).toBe(false);
  });

  it('dividenda z ADR Toyoty má zdroj v Japonsku (zápočet po státech se nemění)', () => {
    const paid = dividends.filter((tx) => tx.isin === 'US8923313071');
    expect(paid.length).toBeGreaterThan(0);
    for (const tx of paid) {
      expect(tx.currency).toBe('USD');
      // ADR je jen obal: plátcem je japonská společnost a srážku strhává Japonsko
      expect(tx.sourceCountry).toBe('JP');
    }
  });

  it('titul se vede v měně burzy, kam jeho ISIN patří', () => {
    const mismatched = trades
      .filter((tx) => realIsin(tx.isin))
      .filter((tx) => {
        const home = HOME_CURRENCY[tx.isin.slice(0, 2)];
        return home !== undefined && tx.currency !== home;
      })
      .map((tx) => `${tx.ticker ?? tx.isin} ${tx.isin} v ${tx.currency}`);
    expect([...new Set(mismatched)]).toEqual([]);
  });

  it('každý skutečný ISIN má platnou kontrolní číslici', () => {
    const invalid = trades
      .map((tx) => tx.isin)
      .filter((isin) => realIsin(isin) && !isValidIsin(isin));
    expect([...new Set(invalid)]).toEqual([]);
  });

  it('dividenda chodí z drženého titulu a v jeho měně', () => {
    const currencyByIsin = new Map(trades.map((tx) => [tx.isin, tx.currency]));
    const orphans = dividends
      .filter((tx) => tx.isin === undefined || currencyByIsin.get(tx.isin) !== tx.currency)
      .map((tx) => `${tx.isin} v ${tx.currency}`);
    expect([...new Set(orphans)]).toEqual([]);
  });
});
