import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { analyzeTaxYear } from '@danero/engine';
import { parseTransactions } from '@danero/shared';
import { DUE_NAME, TAX_NAME } from '@/components/tax-figure';
import { OverviewView } from '@/components/views/overview-view';
import { ReportView } from '@/components/views/report-view';
import { czk } from '@/lib/format';
import { taxSummary } from '@/lib/payable-tax';
import { analyzeForUser, engineInputForUser, type ProfileRow } from '@/lib/portfolio';
import { LAST_CONFIGURED_TAX_YEAR } from '@/lib/tax-config';

/**
 * Jedno pojetí daně na přehledu a v reportu (nálezy R1B-02, R1B-03, R5-03).
 *
 * Do 10. 10. 2026 stálo pod stejným verdiktem „Za rok … podáš daňové přiznání“
 * na přehledu „Doplatek daně 980 Kč“ a v reportu „Orientační daň z investic
 * 2 180 Kč“ — bez slova o tom, že se liší o zaplacené zálohy. A rozpad daně
 * končil třemi řádky pod sebou (daň v obecném základu, daň v samostatném
 * základu, tučně orientační daň), které se četly jako sčítance a součet,
 * ačkoli jde o dvě varianty téhož.
 *
 * Vysvětlivka se vykreslí až po otevření; test ji nahrazuje obalem, aby šlo
 * rozlišit, co je vidět hned a co až na požádání (vzor: `payable-tax.test.ts`).
 */
vi.mock('@/components/ui/info-popover', () => ({
  InfoPopover: ({ children }: { children: React.ReactNode }) =>
    createElement('info-popover', null, children),
}));
// tisková kopie vysvětlivky je v HTML vždy, na obrazovce vidět není — vlastní
// značka ji dovolí z „viditelného“ textu spolehlivě vyjmout i s vnořenými prvky
vi.mock('@/components/ui/info-print', () => ({
  InfoPrint: ({ children }: { children: React.ReactNode }) =>
    createElement('info-print', null, children),
}));

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

/** Jediný zdanitelný příjem roku: zahraniční dividenda v dané hrubé výši. */
const dividend = (grossCzk: string, year = YEAR) =>
  parseTransactions([
    {
      type: 'DIVIDEND',
      id: 'v1',
      isin: 'US0378331005',
      sourceCountry: 'US',
      gross: grossCzk,
      withholdingTax: '0',
      currency: 'CZK',
      date: `${year}-04-01`,
    },
  ]);

const resultFor = (grossCzk: string, regime = 'PAUSAL', year = YEAR) =>
  analyzeTaxYear(engineInputForUser(dividend(grossCzk, year), { ...PROFILE, regime }, year));

/** Text stránky bez značek; `visible` vynechá obsah vysvětlivek a tiskové kopie. */
const textOf = (html: string, visible: boolean): string =>
  (visible
    ? html
        .replace(/<info-popover>.*?<\/info-popover>/gs, '')
        .replace(/<info-print>.*?<\/info-print>/gs, '')
    : html
  )
    .replace(/<!-- -->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ');

const overviewHtml = (grossCzk: string, regime = 'PAUSAL', year = YEAR): string => {
  const txs = dividend(grossCzk, year);
  const today = `${year}-07-20`;
  return renderToStaticMarkup(
    createElement(OverviewView, {
      txs,
      analysis: analyzeForUser(txs, { ...PROFILE, regime }, year, today),
      prices: new Map(),
      years: [year],
      year,
      today,
      notifications: [],
    }),
  );
};
const reportHtml = (grossCzk: string, regime = 'PAUSAL', year = YEAR): string =>
  renderToStaticMarkup(
    createElement(ReportView, {
      txs: dividend(grossCzk, year),
      profile: { ...PROFILE, regime },
      year,
      years: [year],
    }),
  );

/** Hodnota v korunách s obyčejnými mezerami — stejně jako `textOf`. */
const kc = (value: Parameters<typeof czk>[0]): string => czk(value).replace(/ /g, ' ');

describe('taxSummary: co je hlavní číslo', () => {
  it('bez paušálního režimu je hlavním číslem orientační daň, zálohy se neodečítají', () => {
    for (const regime of ['ZAMESTNANEC', 'OSVC', 'JINE']) {
      const result = resultFor('60000', regime);
      const summary = taxSummary(result);
      expect(summary.dueCzk).toBeNull();
      expect(summary.advances).toBeNull();
      expect(summary.flatTaxBroken).toBe(false);
      expect(summary.variant).toBe(result.tax.recommended);
    }
  });

  it('paušalista pod limitem zálohy neodečítá — přiznání nepodává', () => {
    const summary = taxSummary(resultFor('20000'));
    expect(summary.dueCzk).toBeNull();
    expect(summary.flatTaxBroken).toBe(false);
  });

  it('R-08f: po prolomení limitu je hlavním číslem doplatek = daň − zálohy', () => {
    const result = resultFor('60000');
    const impact = result.limits.flatTax50k.breachImpact!;
    const summary = taxSummary(result);
    expect(summary.flatTaxBroken).toBe(true);
    expect(summary.taxCzk.eq(impact.taxCzk)).toBe(true);
    expect(summary.advances!.totalCzk.eq(impact.advancesCreditCzk)).toBe(true);
    expect(summary.dueCzk!.eq(impact.additionalTaxCzk)).toBe(true);
    // vztah, který stránka ukazuje, musí sedět na korunu
    expect(summary.taxCzk.sub(summary.advances!.totalCzk).eq(summary.dueCzk!)).toBe(true);
    // měsíční částka × počet měsíců = zálohy celkem
    expect(
      summary.advances!.monthlyCzk.mul(summary.advances!.months).eq(summary.advances!.totalCzk),
    ).toBe(true);
  });

  it('R-08f: doplatek vychází z daně s dividendami v obecném základu, i když engine doporučí § 16a', () => {
    // dividenda nad hranicí vyšší sazby: § 16a vyjde levněji a engine ho doporučí
    const result = resultFor('3000000');
    expect(result.tax.recommended).toBe('SEPARATE_16A');
    const summary = taxSummary(result);
    expect(summary.variant).toBe('GENERAL');
    expect(summary.taxCzk.eq(result.tax.general.taxCzk)).toBe(true);
    expect(summary.otherVariantTaxCzk!.eq(result.tax.separate16a.taxCzk)).toBe(true);
  });

  it('R-15e: rok bez známé výše zálohy doplatek nemá — zálohy se neodečítají', () => {
    const year = LAST_CONFIGURED_TAX_YEAR + 1;
    const summary = taxSummary(resultFor('200000', 'PAUSAL', year));
    expect(summary.flatTaxBroken).toBe(true);
    expect(summary.advances).toBeNull();
    expect(summary.dueCzk).toBeNull();
  });

  it('rok bez zahraničních dividend druhou variantu zdanění nemá', () => {
    const result = analyzeTaxYear(engineInputForUser([], PROFILE, YEAR));
    expect(taxSummary(result).otherVariantTaxCzk).toBeNull();
  });
});

describe('přehled a report ukazují pod stejným verdiktem stejné číslo (R1B-03)', () => {
  const result = resultFor('60000');
  const impact = result.limits.flatTax50k.breachImpact!;
  /** Blok verdiktu: od nadpisu po první sekci pod ním. */
  const verdictOf = (text: string, nextSection: string): string => {
    const from = text.indexOf(`Za rok ${YEAR} podáš daňové přiznání`);
    const to = text.indexOf(nextSection, from);
    expect(from).toBeGreaterThan(-1);
    expect(to).toBeGreaterThan(from);
    return text.slice(from, to);
  };
  const pages = {
    přehled: verdictOf(textOf(overviewHtml('60000'), true), 'Limity'),
    report: verdictOf(textOf(reportHtml('60000'), true), 'Co zapsat do přiznání'),
  };

  it('předpoklad sondy: doplatek se od daně liší', () => {
    expect(impact.advancesCreditCzk.gt(0)).toBe(true);
    expect(impact.additionalTaxCzk.lt(impact.taxCzk)).toBe(true);
  });

  it.each(Object.entries(pages))('%s: hlavním číslem je doplatek', (_page, verdict) => {
    expect(verdict).toMatch(new RegExp(`${DUE_NAME}\\s*${kc(impact.additionalTaxCzk)}`));
    // orientační daň v bloku verdiktu jako druhé velké číslo nestojí
    expect(verdict).not.toContain(TAX_NAME);
  });

  it.each(Object.entries(pages))(
    '%s: vztah daň − zálohy je vidět bez otevření vysvětlivky',
    (_page, verdict) => {
      expect(verdict).toContain(
        `daň ${kc(impact.taxCzk)} − zálohy ${kc(impact.advancesCreditCzk)}`,
      );
    },
  );

  it.each(Object.entries(pages))(
    '%s: u doplatku stojí, že nejde o celou cenu prolomení (R5-03)',
    (_page, verdict) => {
      expect(verdict).toContain('jen z investic');
      expect(verdict).toContain('navíc pojistné a přehledy');
    },
  );

  it('podrobnosti o pojistném a přehledech zůstávají ve vysvětlivce', () => {
    const DETAIL = 'přehled ČSSZ a zdravotní pojišťovně';
    for (const html of [overviewHtml('60000'), reportHtml('60000')]) {
      expect(textOf(html, false).includes(DETAIL)).toBe(true);
      expect(textOf(html, true).includes(DETAIL)).toBe(false);
    }
  });

  it('kdo limit neprolomil nebo paušál nemá, o pojistném nečte a hlavním číslem je daň', () => {
    for (const [gross, regime] of [
      ['20000', 'PAUSAL'],
      ['60000', 'ZAMESTNANEC'],
      ['60000', 'OSVC'],
    ] as const) {
      for (const html of [overviewHtml(gross, regime), reportHtml(gross, regime)]) {
        const text = textOf(html, true);
        expect(text).not.toContain('navíc pojistné a přehledy');
        expect(text).not.toContain(DUE_NAME);
        expect(text).toContain(TAX_NAME);
      }
    }
  });

  it('rok bez známé výše zálohy: číslo se jmenuje daň a říká, že zálohy odečtené nejsou', () => {
    const year = LAST_CONFIGURED_TAX_YEAR + 1;
    for (const html of [overviewHtml('200000', 'PAUSAL', year), reportHtml('200000', 'PAUSAL', year)]) {
      const text = textOf(html, true);
      expect(text).toContain('před odečtením záloh');
      expect(text).toContain('navíc pojistné a přehledy');
      expect(text).not.toContain(DUE_NAME);
    }
  });
});

describe('dvě varianty zdanění dividend nejsou sčítance (R1B-02)', () => {
  // dividenda nad hranicí vyšší sazby — varianty se liší o víc než korunu
  const GROSS = '3000000';
  const result = resultFor(GROSS, 'OSVC');
  const summary = taxSummary(result);

  it('předpoklad sondy: varianty dávají různou daň', () => {
    expect(czk(result.tax.general.taxCzk)).not.toBe(czk(result.tax.separate16a.taxCzk));
  });

  it.each([
    ['přehled', overviewHtml(GROSS, 'OSVC')],
    ['report', reportHtml(GROSS, 'OSVC')],
  ])('%s: žargon „obecný/samostatný základ“ není v řádcích ani v přepínači', (_page, html) => {
    const text = textOf(html, true);
    expect(/Daň v obecném základu|Daň v samostatném základu/.test(text)).toBe(false);
    // popisky přepínače a řádků (text hlášek enginu se nepřepisuje, ten se tu nehlídá)
    expect(/>(Obecný|Samostatný) základ</.test(html)).toBe(false);
    // výklad pojmů z tiskopisu je ve vysvětlivce — jednou větou (pravidlo 3)
    expect(textOf(html, false).includes('obecný základ daně')).toBe(true);
    expect(textOf(html, false).includes('samostatný základ daně')).toBe(true);
  });

  it.each([
    ['přehled', overviewHtml(GROSS, 'OSVC')],
    ['report', reportHtml(GROSS, 'OSVC')],
  ])('%s: varianta je volba — použitá je vidět, druhá s částkou vedle ní', (_page, html) => {
    const text = textOf(html, true);
    const other = summary.variant === 'GENERAL' ? 'zvlášť sazbou 15 %' : 's ostatními příjmy';
    const used = summary.variant === 'GENERAL' ? 's ostatními příjmy' : 'zvlášť sazbou 15 %';
    expect(text).toMatch(
      new RegExp(
        `Zdanění dividend a úroků\\s*${other} by daň vyšla ${kc(summary.otherVariantTaxCzk!)}\\s*${used}`,
      ),
    );
    // výsledek rozpadu je daň použité varianty, ne součet obou
    expect(text).toMatch(new RegExp(`${TAX_NAME}\\s*${kc(summary.taxCzk)}`));
  });

  it('shodné částky se neopisují dvakrát', () => {
    // pod hranicí vyšší sazby vycházejí oba způsoby stejně
    const equal = resultFor('60000', 'OSVC');
    expect(czk(equal.tax.general.taxCzk)).toBe(czk(equal.tax.separate16a.taxCzk));
    expect(textOf(overviewHtml('60000', 'OSVC'), true)).toContain('by daň vyšla stejně');
  });

  it('po prolomení paušálního limitu končí rozpad zálohami a doplatkem', () => {
    const broken = resultFor('60000');
    const impact = broken.limits.flatTax50k.breachImpact!;
    for (const html of [overviewHtml('60000'), reportHtml('60000')]) {
      expect(textOf(html, true)).toMatch(
        new RegExp(
          `${TAX_NAME}\\s*${kc(impact.taxCzk)}\\s*− Zálohy z paušálního režimu.*?${kc(impact.advancesCreditCzk)}\\s*${DUE_NAME}\\s*${kc(impact.additionalTaxCzk)}`,
        ),
      );
    }
  });
});
