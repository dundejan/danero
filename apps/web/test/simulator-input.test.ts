import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { parseTransactions } from '@danero/shared';
import { SimulatorView } from '@/components/views/simulator-view';
import { czk } from '@/lib/format';
import type { ProfileRow } from '@/lib/portfolio';
import { normalizeNumberInput, simulationKey } from '@/lib/simulator-input';

/**
 * Simulátor musí přijmout číslo tak, jak ho aplikace sama píše.
 *
 * Aplikace sází částky česky: tisíce odděluje pevnou mezerou („1 234,56“),
 * v některých prohlížečích úzkou pevnou. Kdo si takové číslo zkopíroval
 * z portfolia do pole „Cena za kus“, četl do 11. 10. 2026 „Zadej cenu za kus —
 * kladné číslo“: parser uměl jen desetinnou čárku, mezeru ne.
 */
const NBSP = ' ';
const NARROW_NBSP = ' ';
const THIN_SPACE = ' ';

describe('normalizeNumberInput: české zápisy čísla', () => {
  it.each([
    ['1 234,56', '1234.56'],
    [`1${NBSP}234,56`, '1234.56'],
    [`1${NARROW_NBSP}234,56`, '1234.56'],
    [`1${THIN_SPACE}234,56`, '1234.56'],
    [`12${NBSP}345${NBSP}678`, '12345678'],
    ['  230  ', '230'],
    ['230,5', '230.5'],
    ['230.5', '230.5'],
    ['', ''],
  ])('„%s“ → „%s“', (raw, normalized) => {
    expect(normalizeNumberInput(raw)).toBe(normalized);
  });

  it('nic nehádá: co není číslo, číslem neudělá', () => {
    // dvě čárky, písmena ani záporné číslo neprojdou následnou kontrolou tvaru
    const NUMBER = /^\d+(\.\d+)?$/;
    for (const raw of ['1,2,3', 'abc', '-5', '1e5', '12 ks', '1.234,56']) {
      expect(normalizeNumberInput(raw), raw).not.toMatch(NUMBER);
    }
  });
});

describe('simulátor přijme číslo zkopírované z aplikace', () => {
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
  const ISIN = 'CZ0005112300';
  const TXS = parseTransactions([
    {
      type: 'BUY',
      id: 'b',
      isin: ISIN,
      ticker: 'CEZ',
      quantity: '2000',
      pricePerShare: '1000',
      currency: 'CZK',
      tradeDate: '2025-02-03',
      settlementDate: '2025-02-05',
    },
  ]);

  const page = (kusy: string, cena: string): string =>
    renderToStaticMarkup(
      createElement(SimulatorView, {
        txs: TXS,
        profile: PROFILE,
        today: '2026-03-10',
        params: { isin: ISIN, kusy, cena },
      }),
    );

  it('cena i kusy s pevnou a úzkou mezerou dají týž výsledek jako holé číslo', () => {
    const plain = page('1500', '1234.56');
    // 1 500 ks × 1 234,56 Kč = 1 851 840 Kč
    expect(plain).toContain(czk(1500 * 1234.56));
    for (const [kusy, cena] of [
      [`1${NBSP}500`, `1${NBSP}234,56`],
      [`1${NARROW_NBSP}500`, `1${NARROW_NBSP}234,56`],
      ['1 500', '1 234,56'],
    ] as const) {
      const html = page(kusy, cena);
      expect(html, `${kusy} × ${cena}`).not.toContain('Zadej cenu za kus');
      expect(html).not.toContain('Počet kusů musí být kladné číslo');
      expect(html).toContain(czk(1500 * 1234.56));
    }
  });

  it('pole si drží, co uživatel napsal — a klíč výsledku s ním souhlasí', () => {
    const kusy = `1${NBSP}500`;
    const cena = `1${NBSP}234,56`;
    const html = page(kusy, cena);
    expect(html).toContain(`value="${kusy}"`);
    expect(html).toContain(`value="${cena}"`);
    // formulář porovnává své zadání s klíčem ze serveru: kdyby jeden z nich
    // číslo normalizoval a druhý ne, zůstal by výsledek zešedlý napořád
    expect(simulationKey(ISIN, kusy, cena)).toBe(`${ISIN}|${kusy}|${cena}`);
  });

  it('nesmysl dál končí chybou u pole', () => {
    expect(page('100', 'abc')).toContain('Zadej cenu za kus');
    expect(page('1,2,3', '1000')).toContain('Počet kusů musí být kladné číslo');
    // víc kusů, než kolik drží — kontrola rozsahu běží až nad přečteným číslem
    expect(page(`3${NBSP}000`, '1000')).toContain('tolik prodat nejde');
  });
});
