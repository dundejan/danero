import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { analyzeTaxYear } from '@danero/engine';
import { d, parseTransactions } from '@danero/shared';
import { OverviewView } from '@/components/views/overview-view';
import { summaryCandidate } from '@/lib/notifications';
import { payableTaxCzk, recommendedTaxCzk, unpaidUnderLimitCzk } from '@/lib/payable-tax';
import { analyzeForUser, engineInputForUser, type ProfileRow } from '@/lib/portfolio';

/**
 * docs/02 R-09f (nález L24-02, rozhodnutí R6): „orientační daň“ je daň,
 * KDYBY se podávalo přiznání. Pod limitem svého režimu ji poplatník neplatí —
 * a přehled, e-mail i simulátor to do revize 5 neříkaly.
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
const YEAR = 2025;
const TODAY = `${YEAR}-07-20`;
const SENTENCE = 'Platí se jen při podání přiznání';

/** Jediný zdanitelný příjem roku: zahraniční dividenda v dané hrubé výši. */
const dividend = (grossCzk: string) =>
  parseTransactions([
    {
      type: 'DIVIDEND',
      id: 'v1',
      isin: 'US0378331005',
      sourceCountry: 'US',
      gross: grossCzk,
      withholdingTax: '0',
      currency: 'CZK',
      date: `${YEAR}-04-01`,
    },
  ]);

const resultFor = (grossCzk: string, regime: string) =>
  analyzeTaxYear(engineInputForUser(dividend(grossCzk), { ...PROFILE, regime }, YEAR));

const overviewHtml = (grossCzk: string, regime: string): string => {
  const txs = dividend(grossCzk);
  return renderToStaticMarkup(
    createElement(OverviewView, {
      txs,
      analysis: analyzeForUser(txs, { ...PROFILE, regime }, YEAR, TODAY),
      prices: new Map(),
      years: [YEAR],
      year: YEAR,
      today: TODAY,
      notifications: [],
    }),
  );
};

describe('daň k zaplacení (R-09f)', () => {
  it('pod limitem je nula, na limitu taky, nad ním celá orientační daň', () => {
    const limit = d('50000');
    expect(payableTaxCzk(d('1245'), d('30000'), limit).toString()).toBe('0');
    // limity jsou „do X včetně“
    expect(payableTaxCzk(d('1245'), d('50000'), limit).toString()).toBe('0');
    expect(payableTaxCzk(d('1245'), d('50000.01'), limit).toString()).toBe('1245');
  });

  it('kdo režimový limit nemá (OSVČ mimo paušál), platí orientační daň vždy', () => {
    expect(payableTaxCzk(d('1245'), d('100'), null).toString()).toBe('1245');
  });

  it('strop limitu se bere podle režimu a roku', () => {
    expect(unpaidUnderLimitCzk(resultFor('30000', 'PAUSAL'))?.toString()).toBe('50000');
    expect(unpaidUnderLimitCzk(resultFor('60000', 'PAUSAL'))).toBeNull();
    expect(unpaidUnderLimitCzk(resultFor('10000', 'ZAMESTNANEC'))?.toString()).toBe('20000');
    // zaměstnanec nad svým limitem — paušální strop se ho netýká
    expect(unpaidUnderLimitCzk(resultFor('30000', 'ZAMESTNANEC'))).toBeNull();
    expect(unpaidUnderLimitCzk(resultFor('30000', 'OSVC'))).toBeNull();
  });
});

describe('přehled říká, že se orientační daň pod limitem neplatí (L24-02)', () => {
  it('paušalista pod limitem větu vidí i se stropem svého limitu', () => {
    // předpoklad: orientační daň je nenulová, jinak by věta neměla co vysvětlovat
    expect(recommendedTaxCzk(resultFor('30000', 'PAUSAL')).gt(0)).toBe(true);
    const html = overviewHtml('30000', 'PAUSAL');
    expect(html).toContain(SENTENCE);
    expect(html).toMatch(/pod limitem\s*(<!-- -->)?\s*50\s000\sKč/);
    expect(html).toContain('o kterých Danero ví');
  });

  it('zaměstnanec pod limitem vidí svůj strop, ne paušální', () => {
    const html = overviewHtml('10000', 'ZAMESTNANEC');
    expect(html).toContain(SENTENCE);
    expect(html).toMatch(/pod limitem\s*(<!-- -->)?\s*20\s000\sKč/);
  });

  it.each([
    ['PAUSAL', '60000'],
    ['ZAMESTNANEC', '30000'],
    ['OSVC', '30000'],
  ])('%s s příjmem %s Kč větu nemá — daň platí', (regime, gross) => {
    expect(overviewHtml(gross, regime)).not.toContain(SENTENCE);
  });
});

describe('měsíční přehled e-mailem (L24-02)', () => {
  const body = (grossCzk: string, regime: string): string =>
    summaryCandidate({
      result: resultFor(grossCzk, regime),
      positions: [],
      labels: new Map(),
      today: TODAY,
      period: `${YEAR}-07`,
    }).body;

  it('pod limitem částku daně podmíní', () => {
    expect(body('30000', 'PAUSAL')).toContain('platí se jen při podání přiznání');
  });

  it('nad limitem a u OSVČ mimo paušál zůstává částka bez dovětku', () => {
    expect(body('60000', 'PAUSAL')).not.toContain('platí se jen při podání přiznání');
    expect(body('30000', 'OSVC')).not.toContain('platí se jen při podání přiznání');
  });
});

describe('simulátor ukazuje daň k zaplacení, ne hypotetickou (L24-02)', () => {
  const view = readFileSync(
    join(import.meta.dirname, '..', 'components', 'views', 'simulator-view.tsx'),
    'utf8',
  );

  it('karta daně počítá před i po přes payableTaxCzk a u režimu s limitem se tak jmenuje', () => {
    expect(view.match(/payableTaxCzk\(/g)).toHaveLength(2);
    expect(view).toContain("label={regimeLimit ? 'Daň k zaplacení' : 'Orientační daň'}");
    expect(view).not.toContain('beforeCzk={simulation.baseline.taxCzk}');
  });

  it('prolomení limitu vysvětlí, že se zdaní všechny letošní příjmy', () => {
    expect(view).toContain('všechny letošní zdanitelné příjmy z investic');
    expect(view).toContain('Počítáme jen s příjmy, o kterých Danero ví.');
  });
});
