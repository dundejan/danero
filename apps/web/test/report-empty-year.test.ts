import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { parseTransactions } from '@danero/shared';
import { emptyYearFallback, ReportView } from '@/components/views/report-view';
import type { ProfileRow } from '@/lib/portfolio';

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
