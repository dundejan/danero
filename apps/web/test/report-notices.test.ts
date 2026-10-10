import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { compareVariants, type VariantResult } from '@danero/engine';
import { d, parseTransactions, type Transaction } from '@danero/shared';
import { ReportView } from '@/components/views/report-view';
import { czk } from '@/lib/format';
import { LIMIT_NAME } from '@/lib/limit-names';
import { engineInputForUser, type ProfileRow } from '@/lib/portfolio';
import type { RegimeLimit } from '@/lib/simulator-verdict';
import { EPO_SUPPORTED_YEARS } from '@/lib/epo';
import { variantHint, variantHintTitle } from '@/lib/variant-hint';

/**
 * Sdělení nahoře v reportu: výzva „jiná varianta by vyšla líp“ (R4-01, R4-02),
 * fixace roku (R1B-12), výhrada o poradenství (R5-01) a tisk sekce exportu
 * (R5-12).
 *
 * Vysvětlivky se vykreslí až po otevření — test je nahrazuje obalem, aby šlo
 * ověřit i jejich obsah (vzor: `payable-tax.test.ts`).
 */
vi.mock('@/components/ui/info-popover', () => ({
  InfoPopover: ({ children }: { children: React.ReactNode }) =>
    createElement('info-popover', null, children),
}));

const YEAR = 2025;

const PROFILE: ProfileRow = {
  userId: 'u1',
  regime: 'PAUSAL',
  hasBusinessAssets: false,
  w8benFiled: true,
  otherIncomeCzk: '0',
  matchingMethod: 'LIFO',
  fxMethod: 'UNIFIED',
  limit100kStrict: true,
  derivativesExpensesPerType: false,
  emtTimeTestExempt: false,
  returnOfCapitalReducesBasis: false,
  timeTestBasis: 'settlement',
  createdAt: new Date(),
  updatedAt: new Date(),
};

/**
 * Smyšlené portfolio v korunách, na kterém se FIFO a LIFO rozejdou:
 * - starý titul prodaný za 120 000 Kč je osvobozený časovým testem, ale při
 *   bezpečném výkladu vyčerpá osvobození do 100 000 Kč (R-02c),
 * - druhý titul má starý nákup (osvobozený testem) a letošní; prodej `quantity`
 *   kusů po 600 Kč jde podle FIFO ze starého nákupu (zdanitelný příjem 0),
 *   podle LIFO z letošního (zdanitelný příjem = celá tržba, zisk 100 Kč na kus).
 */
const portfolio = (quantity: number): Transaction[] =>
  parseTransactions([
    { type: 'BUY', id: 'b-old', isin: 'XX0000000017', ticker: 'STARY', quantity: '300', pricePerShare: '300', currency: 'CZK', tradeDate: '2020-01-10', settlementDate: '2020-01-14' },
    { type: 'SELL', id: 's-old', isin: 'XX0000000017', ticker: 'STARY', quantity: '300', pricePerShare: '400', currency: 'CZK', tradeDate: `${YEAR}-02-03`, settlementDate: `${YEAR}-02-05` },
    { type: 'BUY', id: 'b-a1', isin: 'XX0000000025', ticker: 'DVA', quantity: '100', pricePerShare: '100', currency: 'CZK', tradeDate: '2020-03-10', settlementDate: '2020-03-12' },
    { type: 'BUY', id: 'b-a2', isin: 'XX0000000025', ticker: 'DVA', quantity: '100', pricePerShare: '500', currency: 'CZK', tradeDate: `${YEAR}-01-15`, settlementDate: `${YEAR}-01-17` },
    { type: 'SELL', id: 's-a', isin: 'XX0000000025', ticker: 'DVA', quantity: String(quantity), pricePerShare: '600', currency: 'CZK', tradeDate: `${YEAR}-06-10`, settlementDate: `${YEAR}-06-12` },
  ]);

const render = (
  quantity: number,
  profile: Partial<ProfileRow> = {},
  props: { demo?: boolean; justPinned?: boolean; year?: number } = {},
): string =>
  renderToStaticMarkup(
    createElement(ReportView, {
      txs: portfolio(quantity),
      profile: { ...PROFILE, ...profile },
      year: props.year ?? YEAR,
      years: [props.year ?? YEAR],
      demo: props.demo,
      justPinned: props.justPinned,
    }),
  );

const plain = (html: string): string =>
  html
    .replace(/<!-- -->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ');

/** Úsek stránky mezi dvěma texty — ať selhání nevypisuje celý report. */
const between = (text: string, from: string, to: string): string => {
  const start = text.indexOf(from);
  expect(start, from).toBeGreaterThan(-1);
  const end = text.indexOf(to, start);
  expect(end, to).toBeGreaterThan(start);
  return text.slice(start, end);
};

const TAX_TITLE = /by daň z investic vyšla o [\d ]+ Kč nižší/;
const kc = (value: Parameters<typeof czk>[0]): string => czk(value).replace(/ /g, ' ');

describe('variantHint: co jiná varianta opravdu přinese (R4-01)', () => {
  const FLAT_TAX: RegimeLimit = {
    kind: 'FLAT_TAX',
    label: LIMIT_NAME.FLAT_TAX,
    limitCzk: d('50000'),
  };
  const EMPLOYEE: RegimeLimit = {
    kind: 'EMPLOYEE_SIDE_INCOME',
    label: LIMIT_NAME.EMPLOYEE_SIDE_INCOME,
    limitCzk: d('20000'),
  };
  const variant = (over: Partial<Record<keyof VariantResult, string>> & { income: string; tax: string }): VariantResult => ({
    matchingMethod: (over.matchingMethod ?? 'FIFO') as VariantResult['matchingMethod'],
    fxMethod: (over.fxMethod ?? 'UNIFIED') as VariantResult['fxMethod'],
    taxCzk: d(over.tax),
    base10Czk: d('0'),
    base8Czk: d('0'),
    exemptUnder100k: false,
    flatTax50kUsedCzk: d(over.income),
    flatTax50kExceeded: d(over.income).gt(50000),
  });

  it('scénář z nálezu: LIFO je přes limit s nulovou daní, FIFO pod limitem s daní vyšší', () => {
    const active = variant({ matchingMethod: 'LIFO', income: '105050', tax: '0' });
    const recommended = variant({ matchingMethod: 'FIFO', income: '44990', tax: '5940' });
    const hint = variantHint(active, recommended, FLAT_TAX)!;
    expect(hint.reason).toBe('STAYS_UNDER_LIMIT');
    const title = variantHintTitle(hint, active).replace(/ /g, ' ');
    // skutečný přínos je limit — částka daně (vyšší než současná) do titulku nepatří
    expect(title).toBe('S párováním FIFO bys zůstal pod limitem paušální daně (50 000 Kč)');
    expect(title).not.toContain(kc(5940));
  });

  it('limit se jmenuje podle režimu', () => {
    const active = variant({ matchingMethod: 'LIFO', income: '30000', tax: '1500' });
    const recommended = variant({ income: '0', tax: '0' });
    const hint = variantHint(active, recommended, EMPLOYEE)!;
    expect(variantHintTitle(hint, active).replace(/ /g, ' ')).toContain(
      'pod limitem vedlejších příjmů (20 000 Kč)',
    );
  });

  it('nad limitem v obou variantách rozhoduje rozdíl daně', () => {
    const active = variant({ matchingMethod: 'LIFO', income: '80000', tax: '4000' });
    const recommended = variant({ income: '70000', tax: '2500' });
    const hint = variantHint(active, recommended, FLAT_TAX)!;
    expect(hint.reason).toBe('LOWER_TAX');
    expect(variantHintTitle(hint, active).replace(/ /g, ' ')).toBe(
      'S párováním FIFO by daň z investic vyšla o 1 500 Kč nižší',
    );
  });

  it('R-09f: pod limitem režimu se daň neplatí v žádné variantě — výzva mlčí', () => {
    const active = variant({ matchingMethod: 'LIFO', income: '6000', tax: '900' });
    const recommended = variant({ income: '0', tax: '0' });
    expect(variantHint(active, recommended, EMPLOYEE)).toBeNull();
    expect(variantHint(active, recommended, FLAT_TAX)).toBeNull();
    // kdo režimový limit nemá (OSVČ mimo paušál), daň platí — tomu se ukáže
    expect(variantHint(active, recommended, null)?.reason).toBe('LOWER_TAX');
  });

  it('rozdíl pod hranicí významnosti je šum mezi kurzy, ne důvod něco měnit', () => {
    const active = variant({ fxMethod: 'CNB_DAILY', income: '80000', tax: '4050' });
    const recommended = variant({ income: '80000', tax: '4000' });
    expect(variantHint(active, recommended, null)).toBeNull();
  });

  it('když je zvolená varianta zároveň nejvýhodnější, není co radit', () => {
    const same = variant({ income: '80000', tax: '4000' });
    expect(variantHint(same, same, FLAT_TAX)).toBeNull();
    expect(variantHint(undefined, same, FLAT_TAX)).toBeNull();
  });

  it('jiné kurzy se pojmenují vedle metody', () => {
    const active = variant({ matchingMethod: 'LIFO', fxMethod: 'UNIFIED', income: '80000', tax: '4000' });
    const recommended = variant({ fxMethod: 'CNB_DAILY', income: '80000', tax: '2000' });
    const hint = variantHint(active, recommended, null)!;
    expect(variantHintTitle(hint, active)).toContain('párováním FIFO a denními kurzy ČNB');
  });
});

describe('výzva v reportu říká skutečný přínos (R4-01)', () => {
  it('předpoklad sondy: LIFO limit paušální daně prolomí, FIFO ne', () => {
    const { variants } = compareVariants(engineInputForUser(portfolio(100), PROFILE, YEAR));
    const of = (method: string) => variants.find((v) => v.matchingMethod === method)!;
    expect(of('LIFO').flatTax50kExceeded).toBe(true);
    expect(of('FIFO').flatTax50kExceeded).toBe(false);
  });

  it('paušalista čte o limitu, ne o dani', () => {
    const text = plain(render(100));
    const notice = between(text, 'S párováním FIFO', 'Co zapsat do přiznání');
    expect(notice).toContain('bys zůstal pod limitem paušální daně (50 000 Kč)');
    expect(TAX_TITLE.test(notice)).toBe(false);
    // co zůstat pod limitem znamená, a poctivá výhrada
    expect(notice).toContain('přiznání kvůli investicím nepodáváš a daň z nich neplatíš');
    expect(notice).toContain('jen příjmy, o kterých Danero ví');
    expect(notice).toContain('FIFO je bezpečný standard');
  });

  it('štítek „nejvýhodnější“ je v tabulce variant jen tehdy, když se varianty liší', () => {
    expect(plain(render(100)).includes('nejvýhodnější')).toBe(true);
    // bez prodeje druhého titulu vyjdou všechny metody stejně — není co vyzdvihovat
    const same = renderToStaticMarkup(
      createElement(ReportView, {
        txs: portfolio(100).filter((tx) => !('isin' in tx) || tx.isin !== 'XX0000000025'),
        profile: PROFILE,
        year: YEAR,
        years: [YEAR],
      }),
    );
    expect(plain(same).includes('používáš')).toBe(true);
    expect(plain(same).includes('nejvýhodnější')).toBe(false);
  });

  it('OSVČ mimo paušál čte o dani — limit nemá', () => {
    const notice = between(plain(render(100, { regime: 'OSVC' })), 'S párováním FIFO', 'Co zapsat');
    expect(TAX_TITLE.test(notice)).toBe(true);
    expect(notice).not.toContain('pod limitem');
  });

  it('zaměstnanec pod svým limitem výzvu nevidí — daň neplatí tak ani tak', () => {
    // 10 ks = 6 000 Kč zdanitelných příjmů v LIFO, pod limitem 20 000 Kč
    const text = plain(render(10, { regime: 'ZAMESTNANEC' }));
    expect(text.includes('S párováním FIFO')).toBe(false);
    // tatáž data u OSVČ mimo paušál výzvu mají: rozdíl daně se opravdu platí
    expect(plain(render(10, { regime: 'OSVC' })).includes('S párováním FIFO')).toBe(true);
  });
});

describe('zafixovaný rok (R4-02, R1B-12)', () => {
  // V Nastavení je už FIFO, ale rok drží fixace s LIFO.
  const pinned = {
    matchingMethod: 'FIFO' as const,
    pinnedTaxYears: {
      [YEAR]: {
        matchingMethod: 'LIFO' as const,
        fxMethod: 'UNIFIED' as const,
        limit100kIncludesTimeTestExempt: true,
      },
    },
  };

  it('výzva netvrdí „jak máš zvoleno“ a říká, kde se fixace ruší', () => {
    const html = render(100, pinned);
    const notice = between(plain(html), 'S párováním FIFO', 'Co zapsat do přiznání');
    expect(notice).not.toContain('jak máš zvoleno');
    expect(notice).toContain(`Rok ${YEAR} je zafixovaný`);
    expect(notice).toContain('párování LIFO');
    expect(notice).toContain('až fixaci zrušíš');
    expect(html).toContain('href="/nastaveni#fixace"');
  });

  it('bez fixace výzva říká, že se počítá podle volby v Nastavení', () => {
    const notice = between(plain(render(100)), 'S párováním FIFO', 'Co zapsat do přiznání');
    expect(notice).toContain('Počítáme tak, jak máš zvoleno: párování LIFO');
    expect(notice).not.toContain('zafixovaný');
  });

  it('fixace stojí i pod tabulkou variant', () => {
    const text = plain(render(100, pinned));
    const below = between(text, 'Porovnání variant párování', 'Metoda výpočtu');
    expect(below).toContain(`Rok ${YEAR} je zafixovaný`);
  });

  it('o fixaci se čte nahoře, ne až na konci stránky', () => {
    const text = plain(render(100, pinned));
    const top = between(text, 'podáš daňové přiznání', 'Co zapsat do přiznání');
    expect(top).toContain(`Rok ${YEAR} je zafixovaný: párování LIFO, jednotný kurz GFŘ.`);
  });

  it('ve chvíli, kdy se rok zafixuje, to stránka řekne jako sdělení', () => {
    const html = render(100, pinned, { justPinned: true });
    const top = between(plain(html), 'podáš daňové přiznání', 'Co zapsat do přiznání');
    expect(top).toContain(`Rok ${YEAR} jsme právě zafixovali: párování LIFO, jednotný kurz GFŘ`);
    expect(top).toContain('otevřením reportu za skončený rok');
    expect(top).toContain('Zrušit fixaci');
    // tichý řádek pro další návštěvy se k němu nepřidává
    expect(top).not.toContain(`Rok ${YEAR} je zafixovaný:`);
  });

  it('rok bez fixace o ní nemluví', () => {
    const text = plain(render(100, {}, { justPinned: false }));
    expect(text.includes('zafixovan')).toBe(false);
  });

  it('znění nemluví o „vygenerování“ podkladů — stalo se to otevřením reportu', () => {
    const text = plain(render(100, pinned));
    expect(text.includes('vygeneroval')).toBe(false);
    expect(text).toContain('když jsi report za tenhle skončený rok poprvé otevřel');
  });
});

describe('výhrada „není daňové poradenství“ (R5-01)', () => {
  // Zadání majitele: tyhle texty co nejkratší. Na obrazovce ji nese patička
  // aplikace i dema na každé stránce (krátký odkaz na čl. 1 podmínek, hlídá
  // `test/app-shell.test.ts`); report vlastní řádek nemá, jinak by na jedné
  // obrazovce stála dvakrát. Celá věta je jen v tisku.
  const PRINTED = 'Danero je výpočetní nástroj, nikoli daňové poradenství.';

  it('celá věta zůstává jen v tiskové hlavičce', () => {
    const html = render(100);
    expect(html.match(new RegExp(PRINTED.replace(/\./g, '\\.'), 'g'))).toHaveLength(1);
    expect(html.indexOf(PRINTED)).toBeLessThan(html.indexOf('Co zapsat do přiznání'));
  });

  it.each([
    ['aplikace', false],
    ['demo', true],
  ])('report (%s) na obrazovce vlastní řádek výhrady nemá — je v patičce', (_, demo) => {
    const html = render(100, {}, { demo });
    expect(html.match(/daňové poradenství/g)).toHaveLength(1);
  });
});

describe('sekce exportu se tiskne jako sdělení, formulář ne (R5-12)', () => {
  /** Třídy všech prvků, ve kterých je daný text (první, nebo poslední výskyt) zanořený. */
  const ancestorClasses = (html: string, text: string, last = false): string[] => {
    const at = last ? html.lastIndexOf(text) : html.indexOf(text);
    expect(at, text).toBeGreaterThan(-1);
    const voidTags = new Set(['input', 'br', 'hr', 'img', 'meta', 'link', 'circle', 'path']);
    const open: string[] = [];
    for (const [, closing, tag, attrs] of html
      .slice(0, at)
      .matchAll(/<(\/?)([a-z0-9-]+)([^>]*)>/g)) {
      if (voidTags.has(tag!) || attrs!.endsWith('/')) continue;
      if (closing) open.pop();
      else open.push(/class="([^"]*)"/.exec(attrs!)?.[1] ?? '');
    }
    return open.flatMap((classes) => classes.split(/\s+/).filter(Boolean));
  };

  it('v roce s XML jde na papír, co XML obsahuje; formulář ne', () => {
    const html = render(100);
    expect(EPO_SUPPORTED_YEARS).toContain(YEAR);
    // nadpis sekce se tiskne
    expect(ancestorClasses(html, 'Export pro mojedane.cz')).not.toContain('print:hidden');
    // formulář ne
    expect(ancestorClasses(html, 'id="epo-export"')).toContain('print:hidden');
    // sdělení je v tiskové kopii vysvětlivky (`hidden print:block`) za formulářem
    const SENTENCE = 'XML obsahuje jen investiční příjmy';
    expect(html.lastIndexOf(SENTENCE)).toBeGreaterThan(html.indexOf('</form>'));
    const classes = ancestorClasses(html, SENTENCE, true);
    expect(classes).toContain('print:block');
    expect(classes).not.toContain('print:hidden');
  });

  it('v roce bez XML se sdělení tiskne taky', () => {
    const year = Math.min(...EPO_SUPPORTED_YEARS) - 1;
    const html = renderToStaticMarkup(
      createElement(ReportView, {
        txs: portfolio(100),
        profile: PROFILE,
        year,
        years: [year],
      }),
    );
    const notice = 'v XML nepodporujeme';
    expect(ancestorClasses(html, notice)).not.toContain('print:hidden');
  });

  it('pozvánka z dema se netiskne', () => {
    const html = render(100, {}, { demo: true });
    expect(ancestorClasses(html, 'Export pro mojedane.cz')).toContain('print:hidden');
  });
});
