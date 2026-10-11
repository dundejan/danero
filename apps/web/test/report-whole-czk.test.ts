import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { parseTransactions, type Money } from '@danero/shared';
import { analyzeTaxYear } from '@danero/engine';
import { OverviewView } from '@/components/views/overview-view';
import { ReportView } from '@/components/views/report-view';
import { demoDataset } from '@/lib/demo-data';
import { czk } from '@/lib/format';
import { analyzeForUser, engineInputForUser, type ProfileRow } from '@/lib/portfolio';
import { base8WholeCzk, priloha2 } from '@/lib/priloha2';

/**
 * R-14h — tatáž veličina má na obrazovce jedno číslo, a to číslo tiskopisu.
 *
 * Do 11. 10. 2026 ukazoval report základ z prodejů dvakrát jinak: v Příloze
 * č. 2 (ř. 209, ř. 40) v celých korunách dolů, jak jde i do XML, kdežto
 * v rozpadu „Výpočet daně“ a v porovnání variant nezaokrouhlený základ z enginu
 * zformátovaný matematicky. V demu za rok 2026 tak pod sebou stálo 8 551 Kč
 * a 8 552 Kč. Totéž u základu z dividend proti ř. 38 a na přehledu.
 *
 * Daň se tím nemění: počítá se ze základu zaokrouhleného na sta dolů (§ 16
 * odst. 2 ZDP) a celé koruny dolů ten výsledek nikdy neposunou.
 */
const PROFILE: ProfileRow = {
  userId: 'u1',
  regime: 'OSVC',
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
const TODAY = `${YEAR}-07-20`;

/**
 * Prodej cenných papírů se základem 8 551,60 Kč (tržba 108 601,60, výdaj
 * 100 050), prodej krypta se základem 20 000,60 Kč a dividenda 6 552,66 Kč.
 * Matematicky by vyšlo 8 552, 20 001 a 6 553 — tiskopis nese 8 551, 20 001
 * (díl rozdělení podle úhrnu: 28 552 − 8 551) a 6 552 (35 104 − 28 552).
 */
const TXS = parseTransactions([
  {
    type: 'BUY',
    id: 'b1',
    isin: 'CZ0005112300',
    ticker: 'CEZ',
    quantity: '100',
    pricePerShare: '1000.5',
    currency: 'CZK',
    tradeDate: `${YEAR - 1}-02-01`,
    settlementDate: `${YEAR - 1}-02-05`,
  },
  {
    type: 'SELL',
    id: 's1',
    isin: 'CZ0005112300',
    quantity: '100',
    pricePerShare: '1086.016',
    currency: 'CZK',
    tradeDate: `${YEAR}-04-01`,
    settlementDate: `${YEAR}-04-03`,
  },
  {
    type: 'BUY',
    id: 'cb1',
    isin: 'BTC',
    ticker: 'BTC',
    assetClass: 'CRYPTO',
    quantity: '1',
    pricePerShare: '500000',
    currency: 'CZK',
    tradeDate: `${YEAR}-03-01`,
  },
  {
    type: 'SELL',
    id: 'cs1',
    isin: 'BTC',
    assetClass: 'CRYPTO',
    quantity: '1',
    pricePerShare: '520000.60',
    currency: 'CZK',
    tradeDate: `${YEAR}-06-15`,
  },
  {
    type: 'DIVIDEND',
    id: 'd1',
    isin: 'US0378331005',
    gross: '6552.66',
    withholdingTax: '982.89',
    currency: 'CZK',
    date: `${YEAR}-05-15`,
  },
]);

const reportHtml = (
  txs: ReturnType<typeof parseTransactions>,
  profile: ProfileRow,
  year: number,
  extra: Record<string, unknown> = {},
): string =>
  renderToStaticMarkup(
    createElement(ReportView, { txs, profile, year, years: [year], ...extra }),
  );

/** Text řádku seznamu, jehož popisek je `label` — uvnitř skupiny `group`. */
const rowText = (html: string, group: string, label: string): string => {
  const from = html.indexOf(`aria-label="${group}"`);
  expect(from, `skupina ${group}`).toBeGreaterThan(-1);
  const rest = html.slice(from);
  const section = rest.slice(0, rest.indexOf('</section>') === -1 ? undefined : rest.indexOf('</section>'));
  const row = section.split('role="listitem"').find((chunk) => chunk.includes(`>${label}<`));
  expect(row, `řádek ${label}`).toBeDefined();
  return row!.replace(/<[^>]+>/g, ' ');
};

const BREAKDOWN = 'Z čeho se orientační daň z investic počítá';
/** „8 552 Kč“ jako samostatná částka — ne jako konec úhrnu 28 552 Kč. */
const HALF_UP_SECURITIES = /(?<!\d\s?)8\s552\sKč/;

describe('rozpad daně ukazuje čísla tiskopisu (R-14h)', () => {
  const result = analyzeTaxYear(engineInputForUser(TXS, PROFILE, YEAR));
  const p2 = priloha2(result);
  const base8 = base8WholeCzk(result);

  it('sonda má haléře, na kterých se obě zaokrouhlení rozejdou', () => {
    expect(result.securities.base10Czk.toFixed(2)).toBe('8551.60');
    expect(result.crypto.base10Czk.toFixed(2)).toBe('20000.60');
    expect(result.dividends.base8Czk.toFixed(2)).toBe('6552.66');
    expect(p2.rows[0]!.rozdilCzk.toFixed(0)).toBe('8551');
    expect(p2.rozdilCzk.toFixed(0)).toBe('28552');
  });

  it('report: řádky rozpadu se rovnají řádkům Přílohy č. 2 a ř. 38', () => {
    const html = reportHtml(TXS, PROFILE, YEAR);
    expect(rowText(html, BREAKDOWN, 'Cenné papíry')).toContain(czk(p2.rows[0]!.rozdilCzk));
    expect(rowText(html, BREAKDOWN, 'Kryptoaktiva')).toContain(czk(p2.rows[1]!.rozdilCzk));
    expect(rowText(html, BREAKDOWN, 'Základ daně z prodejů')).toContain(czk(p2.rozdilCzk));
    expect(rowText(html, BREAKDOWN, 'Základ daně z dividend a úroků')).toContain(
      czk(base8.generalCzk),
    );
    // matematicky zaokrouhlený základ cenných papírů se nesmí objevit nikde
    expect(html).not.toMatch(HALF_UP_SECURITIES);
  });

  it('report: porovnání variant nese u používané varianty ř. 209', () => {
    const html = reportHtml(TXS, PROFILE, YEAR);
    const table = html.slice(html.indexOf('Srovnání variant výpočtu daně'));
    const activeRow = table.split('<tr').find((chunk) => chunk.includes('používáš'));
    expect(activeRow).toBeDefined();
    expect(activeRow!.replace(/<[^>]+>/g, ' ')).toContain(czk(p2.rozdilCzk));
  });

  it('přehled: základ z prodejů i z dividend jsou čísla tiskopisu', () => {
    const html = renderToStaticMarkup(
      createElement(OverviewView, {
        txs: TXS,
        analysis: analyzeForUser(TXS, PROFILE, YEAR, TODAY),
        prices: new Map(),
        years: [YEAR],
        year: YEAR,
        today: TODAY,
        notifications: [],
      }),
    );
    const sales = rowText(html, BREAKDOWN, 'Základ daně z prodejů');
    expect(sales).toContain(czk(p2.rozdilCzk));
    // i rozpis po druzích v nápovědě řádku
    expect(sales).toContain(`cenné papíry ${czk(p2.rows[0]!.rozdilCzk)}`);
    expect(sales).toContain(`kryptoaktiva ${czk(p2.rows[1]!.rozdilCzk)}`);
    expect(rowText(html, BREAKDOWN, 'Základ daně z dividend a úroků')).toContain(
      czk(base8.generalCzk),
    );
    expect(html).not.toMatch(HALF_UP_SECURITIES);
  });
});

/**
 * Totéž nad demo daty — na nich byl rozdíl nalezen (rok 2026: 8 551 × 8 552).
 * Očekávání se neopisuje, bere se z přílohy: demo data se rok od roku posouvají.
 */
describe('demo: základ z prodejů je v reportu jedno číslo (R-14h)', () => {
  const today = '2026-10-11';
  const { txs, profile, dailyRates } = demoDataset(today);

  it.each([2024, 2025, 2026])('rok %i', (year) => {
    const result = analyzeTaxYear(engineInputForUser(txs, profile, year, dailyRates));
    const whole: Money = priloha2(result).rozdilCzk;
    const html = reportHtml(txs, profile, year, { dailyRates, demo: true, basePath: '/demo' });
    expect(rowText(html, BREAKDOWN, 'Základ daně z prodejů')).toContain(czk(whole));
    const table = html.slice(html.indexOf('Srovnání variant výpočtu daně'));
    const activeRow = table.split('<tr').find((chunk) => chunk.includes('používáš'));
    expect(activeRow!.replace(/<[^>]+>/g, ' ')).toContain(czk(whole));
  });
});
