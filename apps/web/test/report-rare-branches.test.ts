import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { analyzeTaxYear } from '@danero/engine';
import { parseTransactions } from '@danero/shared';
import { ReportView } from '@/components/views/report-view';
import { czk } from '@/lib/format';
import { engineInputForUser, type ProfileRow } from '@/lib/portfolio';

/**
 * Větve reportu, které demo data nemají: prodej nakrátko (pokrytý i otevřený
 * přes konec roku) a opce včetně bezcenně expirované prémie.
 *
 * Při redesignu se ověřovalo „nic se neztratilo“ jen nad demem za roky
 * 2021–2026; tyhle větve viděl jen člověk, který si na ně vzpomněl. Tady se
 * vykreslí a hlídá se, že každá položka z výsledku enginu má v reportu svůj
 * řádek a svou částku — očekávání se berou z enginu, neopisují se.
 */
const PROFILE: ProfileRow = {
  userId: 'u1',
  regime: 'ZAMESTNANEC',
  hasBusinessAssets: false,
  w8benFiled: true,
  otherIncomeCzk: '0',
  matchingMethod: 'FIFO',
  fxMethod: 'UNIFIED',
  limit100kStrict: true,
  derivativesExpensesPerType: false,
  emtTimeTestExempt: false,
  returnOfCapitalReducesBasis: false,
  timeTestBasis: 'settlement',
  createdAt: new Date(),
  updatedAt: new Date(),
};
const YEAR = 2025;
const TODAY = '2026-10-11';

const trade = (type: 'BUY' | 'SELL', id: string, over: Record<string, unknown>) => ({
  type,
  id,
  currency: 'CZK',
  quantity: '100',
  ...over,
});

const text = (html: string): string =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|\u00a0/g, ' ')
    .replace(/\s+/g, ' ');

function report(rows: Array<Record<string, unknown>>) {
  const txs = parseTransactions(rows);
  const result = analyzeTaxYear(engineInputForUser(txs, PROFILE, YEAR));
  const html = renderToStaticMarkup(
    createElement(ReportView, { txs, profile: PROFILE, year: YEAR, years: [2026, YEAR], today: TODAY }),
  );
  return { result, html, plain: text(html) };
}

describe('report: větve bez demo dat', () => {
  it('prodej nakrátko pokrytý v roce: vlastní tabulka, řádek na každou položku', () => {
    const { result, html, plain } = report([
      trade('SELL', 's', {
        isin: 'US0378331005',
        ticker: 'AAPL',
        positionEffect: 'OPEN',
        pricePerShare: '3000',
        tradeDate: '2025-03-03',
        settlementDate: '2025-03-04',
      }),
      trade('BUY', 'b', {
        isin: 'US0378331005',
        ticker: 'AAPL',
        positionEffect: 'CLOSE',
        pricePerShare: '2000',
        tradeDate: '2025-05-05',
        settlementDate: '2025-05-06',
      }),
    ]);
    expect(result.shortSales.items.length).toBeGreaterThan(0);

    expect(plain).toContain(`Prodeje nakrátko v roce ${YEAR}`);
    const table = html.slice(html.indexOf(`aria-label="Prodeje nakrátko v roce ${YEAR}"`));
    const body = table.slice(table.indexOf('<tbody'), table.indexOf('</tbody>'));
    expect(body.match(/<tr/g)).toHaveLength(result.shortSales.items.length);
    // příjem z shortu je v základu a report ho ukazuje v Příloze č. 2
    expect(result.securities.base10Czk.gt(0)).toBe(true);
    expect(plain).toContain(czk(result.securities.taxableIncomeCzk).replace(/\u00a0/g, ' '));
    expect(plain).not.toMatch(/NaN|undefined|\[object/);
  });

  it('short otevřený přes konec roku: kontrola výpočtu to řekne', () => {
    const { result, plain } = report([
      trade('SELL', 's', {
        isin: 'US0378331005',
        ticker: 'AAPL',
        positionEffect: 'OPEN',
        pricePerShare: '3000',
        tradeDate: '2025-11-03',
        settlementDate: '2025-11-04',
      }),
    ]);
    expect(result.shortSales.openAtYearEnd.length).toBeGreaterThan(0);
    const warning = result.warnings.find((item) => item.code === 'SHORT_OPEN_AT_YEAR_END');
    expect(warning).toBeDefined();

    expect(plain).toContain('Kontroly výpočtu');
    // titulek kontroly je první věta hlášky enginu
    expect(plain).toContain(warning!.message.split(/[.:—]/)[0]!.trim().slice(0, 40));
    expect(plain).not.toMatch(/NaN|undefined|\[object/);
  });

  it('opce: zisková i bezcenně expirovaná — tabulka obchodů, druh F a neuznaná prémie', () => {
    const option = (type: 'BUY' | 'SELL', id: string, over: Record<string, unknown>) =>
      trade(type, id, { assetClass: 'DERIVATIVE', quantity: '1', ...over });
    const { result, html, plain } = report([
      // opce A expiruje bezcenně
      option('BUY', 'a1', { isin: 'OPT:A', pricePerShare: '10000', tradeDate: '2025-02-03' }),
      option('SELL', 'a2', { isin: 'OPT:A', pricePerShare: '0', tradeDate: '2025-06-20' }),
      // opce B se ziskem
      option('BUY', 'b1', { isin: 'OPT:B', pricePerShare: '5000', tradeDate: '2025-03-03' }),
      option('SELL', 'b2', { isin: 'OPT:B', pricePerShare: '15000', tradeDate: '2025-08-01' }),
    ]);
    expect(result.derivatives.items.length).toBeGreaterThan(0);
    expect(result.derivatives.deniedExpensesCzk.gt(0)).toBe(true);

    expect(plain).toContain(`Derivátové obchody v roce ${YEAR}`);
    const table = html.slice(html.indexOf(`aria-label="Derivátové obchody v roce ${YEAR}"`));
    const body = table.slice(table.indexOf('<tbody'), table.indexOf('</tbody>'));
    expect(body.match(/<tr/g)).toHaveLength(result.derivatives.items.length);
    // Příloha č. 2: druh F s příjmem z enginu
    expect(plain).toContain('druh F');
    expect(plain).toContain(czk(result.derivatives.taxableIncomeCzk).replace(/\u00a0/g, ' '));
    // neuznaná prémie je vyčíslená, ne zamlčená
    expect(plain).toContain(czk(result.derivatives.deniedExpensesCzk).replace(/\u00a0/g, ' '));
    expect(plain).not.toMatch(/NaN|undefined|\[object/);
  });
});
