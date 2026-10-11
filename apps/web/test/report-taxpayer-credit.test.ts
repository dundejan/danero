import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { d, parseTransactions } from '@danero/shared';
import { analyzeTaxYear, taxpayerCreditCzk } from '@danero/engine';
import { XMLParser } from 'fast-xml-parser';
import { ReportView } from '@/components/views/report-view';
import { EPO_SUPPORTED_YEARS, generateDpfdp7 } from '@/lib/epo';
import { czk } from '@/lib/format';
import { engineInputForUser, type ProfileRow } from '@/lib/portfolio';

/**
 * R-14g — ř. 64 „Sleva na poplatníka“ nese částku TOHO zdaňovacího období.
 *
 * Report ji do 11. 10. 2026 tiskl natvrdo jako 30 840 Kč pro každý rok. Ta
 * částka platí až od roku 2022 (zák. č. 609/2020 Sb.): za rok 2021 byla sleva
 * 27 840 Kč a do roku 2020 24 840 Kč. Report za rok 2021 tak radil zapsat do
 * přiznání o 3 000 Kč vyšší slevu, než na jakou byl nárok.
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

/** Zdanitelný prodej v korunách — bez kurzů, ať jde spočítat jakýkoli rok. */
const saleIn = (year: number) =>
  parseTransactions([
    {
      type: 'BUY',
      id: 'b',
      isin: 'CZ0005112300',
      ticker: 'CEZ',
      quantity: '100',
      pricePerShare: '1000',
      currency: 'CZK',
      tradeDate: `${year - 1}-02-01`,
      settlementDate: `${year - 1}-02-05`,
    },
    {
      type: 'SELL',
      id: 's',
      isin: 'CZ0005112300',
      quantity: '100',
      pricePerShare: '3000',
      currency: 'CZK',
      tradeDate: `${year}-04-01`,
      settlementDate: `${year}-04-03`,
    },
  ]);

/** Text řádku tiskopisu podle jeho čísla („ř. 64“), bez značek. */
const formLine = (year: number, line: string): string => {
  const html = renderToStaticMarkup(
    createElement(ReportView, { txs: saleIn(year), profile: PROFILE, year, years: [year] }),
  );
  const row = html.split('role="listitem"').find((chunk) => chunk.includes(`>${line}<`));
  expect(row, `řádek ${line} v reportu za rok ${year}`).toBeDefined();
  return row!.replace(/<[^>]+>/g, ' ');
};

describe('ř. 64: sleva na poplatníka podle roku (R-14g)', () => {
  it.each([
    [2019, '24840'],
    [2020, '24840'],
    [2021, '27840'],
    [2022, '30840'],
    [2023, '30840'],
    [2024, '30840'],
    [2025, '30840'],
    [2026, '30840'],
  ])('report za rok %i radí zapsat %s Kč', (year, amountCzk) => {
    const row = formLine(year, 'ř. 64');
    expect(row).toContain(czk(d(amountCzk)));
    // a žádnou jinou z těch tří částek
    for (const other of ['24840', '27840', '30840'].filter((value) => value !== amountCzk)) {
      expect(row).not.toContain(czk(d(other)));
    }
  });

  it('částka v reportu je táž, kterou vede engine', () => {
    for (const year of [2020, 2021, 2022, 2025]) {
      expect(formLine(year, 'ř. 64')).toContain(czk(d(taxpayerCreditCzk(year)!)));
    }
  });

  it('rok, jehož slevu Danero nezná, řádek nevyplní cizí částkou', () => {
    expect(taxpayerCreditCzk(2010)).toBeNull();
    const row = formLine(2010, 'ř. 64');
    expect(row).not.toMatch(/\d{2}\s840\sKč/);
    expect(row).toContain('pokynech k tiskopisu');
  });
});

describe('XML: sleva na poplatníka je částka roku podání (R-14g)', () => {
  it.each(EPO_SUPPORTED_YEARS)('rok %i', (year) => {
    const result = analyzeTaxYear(engineInputForUser(saleIn(year), PROFILE, year));
    const { xml } = generateDpfdp7({ year, result, personal: {}, varianta: 'GENERAL' });
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' });
    const vetaD = (parser.parse(xml) as { Pisemnost: { DPFDP7: { VetaD: Record<string, string> } } })
      .Pisemnost.DPFDP7.VetaD;
    expect(vetaD.kc_op15_1a).toBe(taxpayerCreditCzk(year));
    expect(vetaD.uhrn_slevy35ba).toBe(taxpayerCreditCzk(year));
  });
});
