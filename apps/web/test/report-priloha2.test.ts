import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { parseTransactions } from '@danero/shared';
import { analyzeTaxYear } from '@danero/engine';
import { XMLParser } from 'fast-xml-parser';
import { ReportView } from '@/components/views/report-view';
import { EPO_SUPPORTED_YEARS, generateDpfdp7 } from '@/lib/epo';
import { czk, yearList } from '@/lib/format';
import { engineInputForUser, type ProfileRow } from '@/lib/portfolio';
import { base8WholeCzk, priloha2 } from '@/lib/priloha2';

/**
 * K3-03 a K3-05 — čísla pro Přílohu č. 2.
 *
 * K3-03: průvodce v reportu tiskl NEzastropované výdaje z enginu, kdežto XML
 * neslo `min(výdaje, příjmy)` podle § 10 odst. 4. U ztrátového roku pak jedna
 * stránka radila „příjmy 1 244 880, výdaje 2 653 920", zatímco XML z téhož
 * výsledku mělo `vydaje10="1244880"` — a podatelna to odmítá
 * (`[N] kc_vyd10 :: Příloha 2/ř.208`).
 *
 * K3-05: u roků, pro které struktura XML ještě neexistuje (9 z 11 prodejných
 * let, nejbolestivěji 2026), karta exportu slibovala „zatím poslouží čísla níž"
 * — a průvodce se u nich vykreslil BEZ jediné částky.
 */
const PROFILE: ProfileRow = {
  userId: 'u1',
  regime: 'PAUSAL',
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

/** Ztrátový prodej nad hranicí osvobození: tržba 200 000, výdaj 1 000 000. */
const lossyTxs = (sellYear: number) =>
  parseTransactions([
    {
      type: 'BUY',
      id: 'zb',
      isin: 'CZ0005112300',
      ticker: 'CEZ',
      quantity: '1000',
      pricePerShare: '1000',
      currency: 'CZK',
      tradeDate: `${sellYear - 1}-02-01`,
      settlementDate: `${sellYear - 1}-02-05`,
    },
    {
      type: 'SELL',
      id: 'zs',
      isin: 'CZ0005112300',
      quantity: '1000',
      pricePerShare: '200',
      currency: 'CZK',
      tradeDate: `${sellYear}-04-01`,
      settlementDate: `${sellYear}-04-03`,
    },
  ]);

const render = (txs: ReturnType<typeof parseTransactions>, year: number): string =>
  renderToStaticMarkup(
    createElement(ReportView, { txs, profile: PROFILE, year, years: [year] }),
  );

/**
 * Jen karta „Průvodce: co kam zapsat v přiznání". Skutečný výdaj se jinde
 * v reportu objevit MUSÍ (rozpis prodejů, rozpad na loty) — vadné bylo, že se
 * dostal do čísel opisovaných do formuláře.
 */
const guide = (html: string): string => {
  const from = html.indexOf('Průvodce: co kam zapsat v přiznání');
  expect(from).toBeGreaterThan(-1);
  const to = html.indexOf('Konfigurace výpočtu:', from);
  return html.slice(from, to === -1 ? undefined : to);
};

describe('Příloha č. 2: report a XML berou čísla z jednoho zdroje (K3-03)', () => {
  const txs = lossyTxs(2025);
  const result = analyzeTaxYear(engineInputForUser(txs, PROFILE, 2025));

  it('výdaje se zastropují výší příjmů (§ 10 odst. 4)', () => {
    const p2 = priloha2(result);
    // engine drží skutečný výdaj…
    expect(result.securities.expensesCzk.toFixed(0)).toBe('1000000');
    // …ale do přílohy se smí zapsat nejvýš do výše příjmů
    expect(p2.rows[0]!.prijmyCzk.toFixed(0)).toBe('200000');
    expect(p2.rows[0]!.vydajeCzk.toFixed(0)).toBe('200000');
    expect(p2.rozdilCzk.toFixed(0)).toBe('0');
  });

  it('XML a průvodce v reportu ukazují tutéž dvojici čísel', () => {
    const p2 = priloha2(result);
    const { xml } = generateDpfdp7({ year: 2025, result, personal: {}, varianta: 'GENERAL' });
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' });
    const dp = (parser.parse(xml) as { Pisemnost: { DPFDP7: Record<string, unknown> } }).Pisemnost
      .DPFDP7;
    const vetaV = dp.VetaV as Record<string, string>;
    expect(vetaV.kc_prij10).toBe(p2.prijmyCzk.toFixed(0));
    expect(vetaV.kc_vyd10).toBe(p2.vydajeCzk.toFixed(0));

    const pruvodce = guide(render(txs, 2025));
    expect(pruvodce).toContain(czk(p2.vydajeCzk));
    // nezastropovaný výdaj z enginu se do průvodce dostat NESMÍ
    expect(pruvodce).not.toContain(czk(result.securities.expensesCzk));
  });
});

/**
 * L5-05 a L5-01 — dílčí základ § 8 a příjmy po státech.
 *
 * Průvodce tiskl nezaokrouhlený základ § 8 matematicky, XML ho nese v celých
 * korunách dolů (rozdělení celých korun, resp. ř. 401a dolů): nad týmiž daty
 * radil průvodce na ř. 38 a ř. 401a o korunu jinou částku, než nese XML.
 * Tabulka po státech měla tutéž vadu proti ř. 321.
 *
 * Sonda: jediná US dividenda 300,03 USD × 21,84 = 6 552,6552 Kč — matematicky
 * 6 553, v XML 6 552.
 */
describe('§ 8: průvodce a XML nesou stejnou korunu (L5-05, L5-01)', () => {
  const txs = parseTransactions([
    {
      type: 'DIVIDEND',
      id: 'l5-us',
      isin: 'US0378331005',
      gross: '300.03',
      withholdingTax: '45',
      currency: 'USD',
      date: '2025-05-15',
    },
  ]);
  const result = analyzeTaxYear(engineInputForUser(txs, PROFILE, 2025));
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' });
  const dpFor = (varianta: 'GENERAL' | 'SEPARATE_16A') => {
    const { xml } = generateDpfdp7({ year: 2025, result, personal: {}, varianta });
    return (parser.parse(xml) as { Pisemnost: { DPFDP7: Record<string, Record<string, string>> } })
      .Pisemnost.DPFDP7;
  };
  const html = render(txs, 2025);
  const guideHtml = guide(html);

  it('ř. 38 v průvodci je částka z XML', () => {
    const r38 = dpFor('GENERAL').VetaO!.kc_zakldan8!;
    expect(r38).toBe('6552');
    expect(base8WholeCzk(result).generalCzk.toFixed(0)).toBe(r38);
    expect(guideHtml).toContain(`${czk(Number(r38))}</span> → <strong>ř. 38</strong>`);
  });

  it('ř. 401a v průvodci je částka z XML', () => {
    const r401a = dpFor('SEPARATE_16A').VetaZ!.kc_prij48!;
    expect(r401a).toBe('6552');
    expect(base8WholeCzk(result).separate16aCzk.toFixed(0)).toBe(r401a);
    expect(guideHtml).toContain(`ř. 401a <span class="font-mono">${czk(Number(r401a))}</span>`);
  });

  it('tabulka po státech ukazuje příjem, který jde na ř. 321', () => {
    const r321 = dpFor('GENERAL').VetaL!.kc_prijzap!;
    const from = html.indexOf('aria-label="Zahraniční příjmy a sražená daň po státech"');
    expect(from).toBeGreaterThan(-1);
    const table = html.slice(from, html.indexOf('</table>', from));
    expect(table).toContain(czk(Number(r321)));
    expect(table).not.toContain(czk(6553));
  });
});

describe('Průvodce ukazuje čísla i pro rok bez XML (K3-05)', () => {
  it('u roku 2026 nese report příjmy i výdaje pro Přílohu 2', () => {
    const txs = lossyTxs(2026);
    const result = analyzeTaxYear(engineInputForUser(txs, PROFILE, 2026));
    const p2 = priloha2(result);
    expect(p2.prijmyCzk.gt(0)).toBe(true);

    const pruvodce = guide(render(txs, 2026));
    expect(pruvodce).toContain(czk(p2.prijmyCzk));
    expect(pruvodce).toContain(czk(p2.vydajeCzk));
    // a musí přiznat, ze kterých let čísla ŘÁDKŮ jsou — výčet jde ze seznamu
    // podporovaných roků, v textu se neopisuje (L5-03)
    expect(pruvodce).toContain(`z tiskopisu ${yearList(EPO_SUPPORTED_YEARS)}`);
  });
});
