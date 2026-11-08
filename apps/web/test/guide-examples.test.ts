import { describe, expect, it } from 'vitest';
import { analyzeTaxYear } from '@danero/engine';
import { d, parseTransactions } from '@danero/shared';
import {
  CURRENT_FILING_YEAR,
  DIVIDEND_EXAMPLE_YEAR,
  FILING_EXAMPLES,
  type FilingExample,
  mustFile,
  nlTreatyCap,
  RAISED_LIMITS_YEAR,
  US_RATE_WITHOUT_W8BEN,
  usDividendExample,
} from '@/lib/guide-examples';
import { engineInputForUser, type ProfileRow } from '@/lib/portfolio';
import { regimeLimitFor } from '@/lib/simulator-verdict';

/**
 * Čísla v článcích průvodce „Kdy podat přiznání“ a „Dividendy ze zahraničí“
 * počítá `lib/guide-examples.ts` z konfigurace. Tenhle test pouští nad týmiž
 * dividendami ENGINE a hlídá, že dojde k témuž: kdyby se rozešla konfigurace
 * s výkladem, nebo engine začal počítat jinak, článek by veřejně tvrdil něco
 * jiného, než aplikace spočítá uživateli.
 */

const PROFILE: ProfileRow = {
  userId: 'u-pruvodce',
  regime: 'JINE',
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

const REGIME: Record<FilingExample['id'], string> = {
  employee: 'ZAMESTNANEC',
  other: 'JINE',
  flatTax: 'PAUSAL',
};

interface DividendRow {
  gross: string;
  withholdingTax: string;
  currency: string;
  sourceCountry: string;
}

function analyze(year: number, regime: string, dividends: DividendRow[]) {
  const rows = dividends.map((dividend, index) => ({
    type: 'DIVIDEND',
    id: `dividenda-${index}`,
    isin: dividend.sourceCountry === 'NL' ? 'NL0010273215' : 'US0378331005',
    date: `${year}-04-01`,
    ...dividend,
  }));
  return analyzeTaxYear(
    engineInputForUser(parseTransactions(rows), { ...PROFILE, regime }, year),
  );
}

describe('článek „Kdy podat přiznání“: verdikty příkladů sedí s enginem', () => {
  for (const example of FILING_EXAMPLES) {
    for (const year of [CURRENT_FILING_YEAR, RAISED_LIMITS_YEAR]) {
      it(`${example.id}, rok ${year}`, () => {
        const result = analyze(year, REGIME[example.id], [
          {
            gross: example.dividendsCzk.toString(),
            withholdingTax: '0',
            currency: 'CZK',
            sourceCountry: 'US',
          },
        ]);
        const limit = regimeLimitFor(result.limits);
        expect(limit, 'situace z příkladu musí mít limit').not.toBeNull();
        // limit, který článek jmenuje, je tentýž, podle kterého rozhoduje engine
        expect(limit!.limitCzk.toString()).toBe(
          example.limit({
            employee: d(result.limits.employee20k.status.limitCzk),
            general: d(result.limits.generalFiling50k.status.limitCzk),
            flatTax: d(result.limits.flatTax50k.status.limitCzk),
            exemptReporting: d(0),
          }).toString(),
        );
        const used = result.limits.flatTax50k.status.usedCzk;
        expect(used.eq(example.dividendsCzk)).toBe(true);
        expect(used.gt(limit!.limitCzk)).toBe(mustFile(example, year));
      });
    }
  }

  it('příklady opravdu ukazují změnu: zaměstnanec a ostatní se v roce 2027 liší, paušalista ne', () => {
    const verdicts = Object.fromEntries(
      FILING_EXAMPLES.map((example) => [
        example.id,
        [mustFile(example, CURRENT_FILING_YEAR), mustFile(example, RAISED_LIMITS_YEAR)],
      ]),
    );
    // jinak by text „Se stejnou částkou za rok 2027…“ nic nevysvětloval
    expect(verdicts).toEqual({
      employee: [true, false],
      other: [true, false],
      flatTax: [true, true],
    });
  });
});

describe('článek „Dividendy ze zahraničí“: zápočet z příkladu spočítá engine stejně', () => {
  const us = usDividendExample();

  it('příklad počítá ověřeným kurzem a vychází na celé koruny', () => {
    expect(us.year).toBe(DIVIDEND_EXAMPLE_YEAR);
    // `czk()` v článku zaokrouhluje na celé Kč — haléře by se ztratily potichu
    for (const value of [
      us.grossCzk,
      us.withW8ben.withheldCzk,
      us.withW8ben.creditableCzk,
      us.withoutW8ben.withheldCzk,
      us.withoutW8ben.creditableCzk,
      us.withoutW8ben.lostCzk,
    ]) {
      expect(value.isInteger(), value.toString()).toBe(true);
    }
  });

  it('s W-8BEN: brutto, srážka i zápočet', () => {
    const result = analyze(DIVIDEND_EXAMPLE_YEAR, 'ZAMESTNANEC', [
      {
        gross: us.grossUsd.toString(),
        withholdingTax: us.withW8ben.withheldUsd.toString(),
        currency: 'USD',
        sourceCountry: 'US',
      },
    ]);
    expect(result.dividends.foreignGrossCzk.eq(us.grossCzk)).toBe(true);
    const country = result.dividends.creditableByCountry.US!;
    expect(country.withholdingCzk.eq(us.withW8ben.withheldCzk)).toBe(true);
    expect(country.creditableCzk.eq(us.withW8ben.creditableCzk)).toBe(true);
  });

  it('bez W-8BEN: srážka 30 %, zápočet jen do smluvního stropu', () => {
    expect(us.withoutW8ben.withheldUsd.eq(us.grossUsd.mul(US_RATE_WITHOUT_W8BEN))).toBe(true);
    const result = analyze(DIVIDEND_EXAMPLE_YEAR, 'ZAMESTNANEC', [
      {
        gross: us.grossUsd.toString(),
        withholdingTax: us.withoutW8ben.withheldUsd.toString(),
        currency: 'USD',
        sourceCountry: 'US',
      },
    ]);
    const country = result.dividends.creditableByCountry.US!;
    expect(country.withholdingCzk.eq(us.withoutW8ben.withheldCzk)).toBe(true);
    expect(country.creditableCzk.eq(us.withoutW8ben.creditableCzk)).toBe(true);
    expect(country.withholdingCzk.sub(country.creditableCzk).eq(us.withoutW8ben.lostCzk)).toBe(
      true,
    );
  });

  it('Nizozemsko: z 15% srážky se započte jen strop ze smlouvy', () => {
    const result = analyze(DIVIDEND_EXAMPLE_YEAR, 'ZAMESTNANEC', [
      { gross: '1000', withholdingTax: '150', currency: 'EUR', sourceCountry: 'NL' },
    ]);
    const country = result.dividends.creditableByCountry.NL!;
    // poměr zápočtu k brutto je přesně strop, který článek jmenuje
    expect(country.creditableCzk.div(country.grossCzk).eq(nlTreatyCap())).toBe(true);
    expect(nlTreatyCap().lt(d('0.15'))).toBe(true);
  });
});
