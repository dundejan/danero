import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { analyzeTaxYear } from '@danero/engine';
import { parseTransactions } from '@danero/shared';
import {
  emptyYearFallback,
  engineHasNothingFor,
  ReportView,
} from '@/components/views/report-view';
import { engineInputForUser, type ProfileRow } from '@/lib/portfolio';

/**
 * R2-14 — rok bez jediné transakce nemá v reportu co ukázat.
 *
 * Přepínač roků nabízí souvislou řadu od prvního obchodu po běžný rok, takže
 * se do takového roku dostane každý: v lednu je to rovnou běžný rok, jindy rok
 * mezi nákupem a prodejem. Report za něj do 11. 10. 2026 vykreslil celou
 * osnovu — Přílohu č. 2, řádky přiznání, výpočet daně, osm variant párování
 * a formulář exportu XML — a ve všech stály nuly.
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

/** Nákup 2023, prodej 2025 — rok 2024 je mezera, rok 2026 ještě nic nemá. */
const TXS = parseTransactions([
  {
    type: 'BUY',
    id: 'b',
    isin: 'CZ0005112300',
    ticker: 'CEZ',
    quantity: '100',
    pricePerShare: '1000',
    currency: 'CZK',
    tradeDate: '2023-02-01',
    settlementDate: '2023-02-03',
  },
  {
    type: 'SELL',
    id: 's',
    isin: 'CZ0005112300',
    quantity: '100',
    pricePerShare: '3000',
    currency: 'CZK',
    tradeDate: '2025-04-01',
    settlementDate: '2025-04-03',
  },
]);
const YEARS = [2026, 2025, 2024, 2023];
const TODAY = '2026-01-15';

const render = (year: number, extra: Record<string, unknown> = {}, txs = TXS): string =>
  renderToStaticMarkup(
    createElement(ReportView, { txs, profile: PROFILE, year, years: YEARS, today: TODAY, ...extra }),
  );

/** Co k osnově reportu patří — v prázdném stavu z toho nesmí zbýt nic. */
const OUTLINE = [
  'Co zapsat do přiznání',
  'Příloha č. 2',
  'Výpočet daně',
  'Porovnání variant párování',
  'Export pro mojedane.cz',
  'Stáhnout XML',
  'Vytisknout',
  'Termín podání',
  'ř. 64',
];

describe('report za rok bez jediné transakce (R2-14)', () => {
  it.each([2024, 2026])('rok %i: prázdný stav místo osnovy plné nul', (year) => {
    const html = render(year);
    expect(html.replace(/\s/g, ' ')).toContain(
      `V roce ${year} nemáš žádné obchody ani dividendy`,
    );
    for (const part of OUTLINE) expect(html, part).not.toContain(part);
    // žádná částka — ani nulová
    expect(html).not.toMatch(/\d\sKč/);
  });

  it('přepínač roků zůstává a akce vede k nejbližšímu roku s daty a k nahrání výpisů', () => {
    const html = render(2026);
    // lišta: jediný nadpis první úrovně a přepínač na ostatní roky
    expect(html).toMatch(/<h1[^>]*>Report/);
    expect(html).toContain('/report?rok=2023');
    // hlavní akce: poslední rok, který data má
    expect(html).toMatch(/href="\/report\?rok=2025"[^>]*>Otevřít report 2025</);
    expect(html).toContain('href="/import"');
  });

  it('demo nevede na nahrání výpisů (bez účtu není kam) a drží se své adresy', () => {
    const html = render(2024, { demo: true, basePath: '/demo' });
    // sazba drží předložku i rok pevnou mezerou
    expect(html).toMatch(/V\sroce\s2024\snemáš/);
    expect(html).toContain('href="/demo/report?rok=2023"');
    expect(html).not.toContain('href="/import"');
  });

  it('rok s jediným nákupem nebo jedinou dividendou prázdný není', () => {
    expect(render(2023)).toContain('Co zapsat do přiznání');
    expect(render(2025)).toContain('Co zapsat do přiznání');
    const withDividend = parseTransactions([
      {
        type: 'DIVIDEND',
        id: 'd',
        isin: 'US0378331005',
        sourceCountry: 'US',
        gross: '100',
        withholdingTax: '0',
        currency: 'CZK',
        date: '2024-05-01',
      },
    ]);
    expect(render(2024, {}, [...TXS, ...withDividend])).toContain('Co zapsat do přiznání');
  });
});

/**
 * Nález revize R6 (č. 1 a 2): „prázdný rok“ se poznával podle data obchodu
 * v transakcích — jenže engine řadí prodej do roku VYPOŘÁDÁNÍ a limity počítá
 * i z příjmů, které v transakcích vůbec nejsou. Prodej z 30. 12. tak z reportu
 * zmizel celý (základ 200 000 Kč, verdikt i export XML) a prolomený limit
 * paušální daně z „dalších zdanitelných příjmů“ taky. Rozhoduje proto výsledek
 * enginu: cokoli pro rok má, to report ukáže.
 */
describe('rok, pro který engine něco má, prázdný není (R6)', () => {
  const HAS_OUTLINE = 'Co zapsat do přiznání';
  const says = (html: string, year: number): boolean =>
    html.replace(/\s/g, ' ').includes(`V roce ${year} nemáš žádné obchody ani dividendy`);
  const analyze = (txs: typeof TXS, year: number, profile = PROFILE) =>
    analyzeTaxYear(engineInputForUser(txs, profile, year));
  const reportFor = (txs: typeof TXS, year: number, profile = PROFILE, today = '2026-10-11'): string =>
    renderToStaticMarkup(
      createElement(ReportView, { txs, profile, year, years: [2026, 2025, 2024], today }),
    );
  const buy = (extra: Record<string, unknown> = {}) => ({
    type: 'BUY',
    id: 'b',
    isin: 'IE00B4L5Y983',
    ticker: 'IWDA',
    quantity: '100',
    pricePerShare: '1000',
    currency: 'CZK',
    tradeDate: '2024-06-03',
    ...extra,
  });

  it.each([
    ['vypořádání dopočítané (T+2)', {}, {}],
    ['vypořádání od brokera', { settlementDate: '2024-06-05' }, { settlementDate: '2026-01-02' }],
  ])('prodej z 30. 12. patří do dalšího roku — %s', { timeout: 30_000 }, (_, buyExtra, sellExtra) => {
    const txs = parseTransactions([
      buy(buyExtra),
      {
        type: 'SELL',
        id: 's',
        isin: 'IE00B4L5Y983',
        quantity: '100',
        pricePerShare: '3000',
        currency: 'CZK',
        tradeDate: '2025-12-30',
        ...sellExtra,
      },
    ]);
    // engine: příjem je v roce 2026 a prolamuje limit paušální daně
    const result = analyze(txs, 2026);
    expect(result.securities.disposals).toHaveLength(1);
    expect(result.securities.base10Czk.gt(0)).toBe(true);
    expect(result.limits.flatTax50k.status.exceeded).toBe(true);
    expect(engineHasNothingFor(result)).toBe(false);

    const html = reportFor(txs, 2026);
    expect(says(html, 2026)).toBe(false);
    expect(html).toContain(HAS_OUTLINE);
    expect(html).toContain('Za rok 2026 podáš daňové přiznání');
    // základ z prodeje je v reportu vidět, ne jen v enginu
    expect(html).toMatch(/200\s000\sKč/);
  });

  it('rok s exportem XML: prodej z 30. 12. 2024 nese report 2025 i s tlačítkem exportu', { timeout: 30_000 }, () => {
    const txs = parseTransactions([
      buy({ tradeDate: '2023-06-01' }),
      {
        type: 'SELL',
        id: 's',
        isin: 'IE00B4L5Y983',
        quantity: '100',
        pricePerShare: '3000',
        currency: 'CZK',
        tradeDate: '2024-12-30',
      },
    ]);
    expect(analyze(txs, 2025).securities.disposals).toHaveLength(1);
    expect(analyze(txs, 2024).securities.disposals).toHaveLength(0);
    const html = reportFor(txs, 2025);
    expect(says(html, 2025)).toBe(false);
    expect(html).toContain('Stáhnout XML');
    expect(html).toContain('Za rok 2025 ti vznikla povinnost podat přiznání');
  });

  it('další zdanitelné příjmy z profilu nad limitem: rok bez transakce ukáže verdikt', { timeout: 30_000 }, () => {
    const profile = { ...PROFILE, otherIncomeCzk: '60000' };
    const txs = parseTransactions([buy({ isin: 'CZ0005112300', ticker: 'CEZ', quantity: '1' })]);
    const result = analyze(txs, 2025, profile);
    expect(result.limits.flatTax50k.status.exceeded).toBe(true);
    expect(engineHasNothingFor(result)).toBe(false);

    const html = reportFor(txs, 2025, profile);
    expect(says(html, 2025)).toBe(false);
    expect(html).toContain(HAS_OUTLINE);
    // rok 2025 už skončil — povinnost vznikla
    expect(html).toContain('Za rok 2025 ti vznikla povinnost podat přiznání');
  });

  it('další příjmy POD limitem nic k zapsání nedávají — rok bez transakce zůstává prázdný', { timeout: 30_000 }, () => {
    const profile = { ...PROFILE, otherIncomeCzk: '10000' };
    const txs = parseTransactions([buy({ isin: 'CZ0005112300', ticker: 'CEZ', quantity: '1' })]);
    const result = analyze(txs, 2025, profile);
    expect(result.limits.flatTax50k.status.exceeded).toBe(false);
    expect(engineHasNothingFor(result)).toBe(true);
    expect(says(reportFor(txs, 2025, profile), 2025)).toBe(true);
  });

  /** Jediná událost v roce 2025; nákup z roku 2024 je jen proto, aby bylo co držet. */
  const ONLY: Array<[string, Array<Record<string, unknown>>]> = [
    [
      'dividendou',
      [
        {
          type: 'DIVIDEND',
          id: 'd',
          isin: 'US0378331005',
          sourceCountry: 'US',
          gross: '100',
          withholdingTax: '15',
          currency: 'CZK',
          date: '2025-05-01',
        },
      ],
    ],
    ['úrokem', [{ type: 'INTEREST', id: 'i', amount: '250', currency: 'CZK', date: '2025-03-10' }]],
    [
      'derivátem',
      [
        {
          type: 'BUY',
          id: 'ob',
          isin: 'OPT-TEST-C100',
          assetClass: 'DERIVATIVE',
          settlementStyle: 'PREMIUM',
          quantity: '1',
          pricePerShare: '2000',
          currency: 'CZK',
          tradeDate: '2025-02-03',
        },
        {
          type: 'SELL',
          id: 'os',
          isin: 'OPT-TEST-C100',
          assetClass: 'DERIVATIVE',
          settlementStyle: 'PREMIUM',
          quantity: '1',
          pricePerShare: '5000',
          currency: 'CZK',
          tradeDate: '2025-04-03',
        },
      ],
    ],
    [
      'korporátní akcí',
      [
        {
          type: 'CORPORATE_ACTION',
          id: 'ca',
          subtype: 'SPLIT',
          isin: 'IE00B4L5Y983',
          date: '2025-06-02',
          ratio: { from: '1', to: '2' },
        },
      ],
    ],
    ['nákupem', [buy({ id: 'b2', tradeDate: '2025-07-01' })]],
  ];

  it.each(ONLY)('rok jen s %s dostane plný report', { timeout: 30_000 }, (_, events) => {
    const txs = parseTransactions([buy(), ...events]);
    const html = reportFor(txs, 2025);
    expect(says(html, 2025)).toBe(false);
    expect(html).toContain(HAS_OUTLINE);
  });

  it('derivát uzavřený na konci prosince se počítá do roku, kam ho řadí engine', { timeout: 30_000 }, () => {
    const txs = parseTransactions([
      ...(ONLY[2]![1].slice(0, 1) as Array<Record<string, unknown>>),
      {
        ...ONLY[2]![1][1],
        tradeDate: '2025-12-31',
      },
    ]);
    for (const year of [2025, 2026]) {
      const result = analyze(txs, year);
      const html = reportFor(txs, year);
      // kde engine položku má, tam ji report ukáže — a naopak
      expect(says(html, year), `rok ${year}`).toBe(
        result.derivatives.items.length === 0 && engineHasNothingFor(result),
      );
    }
    // položka nezmizí: aspoň jeden z obou roků ji má
    expect(
      [2025, 2026].some((year) => analyze(txs, year).derivatives.items.length > 0),
    ).toBe(true);
  });

  it('prázdný výsledek enginu pozná jen rok, ve kterém opravdu nic není', () => {
    expect(engineHasNothingFor(analyze(TXS, 2024))).toBe(true);
    expect(engineHasNothingFor(analyze(TXS, 2025))).toBe(false);
  });
});

describe('kam z prázdného roku: nejbližší rok s daty', () => {
  it('rok bez transakcí → nejbližší starší rok s daty, jinak nejbližší novější', () => {
    expect(emptyYearFallback(TXS, 2026)).toEqual({ empty: true, nearestYear: 2025 });
    expect(emptyYearFallback(TXS, 2024)).toEqual({ empty: true, nearestYear: 2023 });
    expect(emptyYearFallback(TXS, 2022)).toEqual({ empty: true, nearestYear: 2023 });
  });

  it('rok s transakcí prázdný není', () => {
    expect(emptyYearFallback(TXS, 2023).empty).toBe(false);
    expect(emptyYearFallback(TXS, 2025).empty).toBe(false);
  });

  it('bez jediné transakce není kam odkázat', () => {
    expect(emptyYearFallback([], 2026)).toEqual({ empty: true, nearestYear: null });
  });
});
