import { describe, expect, it } from 'vitest';
import { d } from '@danero/shared';
import { currencyUnit, money, plural, profitLoss, qty, yearList } from '@/lib/format';
import { EPO_SUPPORTED_YEARS } from '@/lib/epo';

describe('plural: český tvar slova k číslu', () => {
  it('1 → jednotné, 2–4 → few, 0 a 5+ → many', () => {
    expect(plural(1, 'transakce', 'transakce', 'transakcí')).toBe('transakce');
    expect(plural(2, 'den', 'dny', 'dní')).toBe('dny');
    expect(plural(4, 'den', 'dny', 'dní')).toBe('dny');
    expect(plural(5, 'den', 'dny', 'dní')).toBe('dní');
    expect(plural(0, 'den', 'dny', 'dní')).toBe('dní');
    expect(plural(127, 'transakce', 'transakce', 'transakcí')).toBe('transakcí');
  });
});

describe('money: částky v historii transakcí', () => {
  // mezi částkou a kódem měny i mezi tisíci je pevná mezera (U+00A0)
  const NBSP = '\u00A0';

  it('zaokrouhluje na 2 desetinná místa s čárkou a jednotkou', () => {
    expect(money(0.73383905457, 'USD')).toBe(`0,73${NBSP}USD`);
    expect(money(0.13, 'USD')).toBe(`0,13${NBSP}USD`);
    expect(money(d('1234.5'), 'EUR')).toBe(`1${NBSP}234,50${NBSP}EUR`);
    expect(money(0, 'CZK')).toBe(`0,00${NBSP}Kč`);
  });

  it('R2-27: částku a kód měny nejde rozdělit na dva řádky', () => {
    // „Dividenda 12 345 678,90 USD (srážka 3 703 703,67 / USD)“ na detailu pozice
    for (const text of [money(d('12345678.90'), 'USD'), money(d('3703703.67'), 'USD', true)]) {
      expect(text).not.toMatch(/[ \t\n]/);
      expect(text.endsWith(`${NBSP}USD`)).toBe(true);
    }
  });

  it('R2-11: cena pod haléř se neukáže jako nula', () => {
    // mince za 0,00031 Kč: „0,00 CZK za kus“ vedle hodnoty pozice 38 272 Kč
    expect(money(d('0.00031'), 'CZK')).toBe(`0,00031${NBSP}Kč`);
    expect(money(d('0.000123456'), 'USD')).toBe(`0,000123${NBSP}USD`);
    // zisk pozice o jednom satoshi: „+0,00 CZK (+7,1 %)“
    expect(money(d('0.0003'), 'CZK', true)).toBe(`+0,0003${NBSP}Kč`);
    expect(money(d('-0.0042'), 'CZK', true)).toBe(`-0,0042${NBSP}Kč`);
    // od haléře výš beze změny, ať se sloupce částek nerozjedou
    expect(money(d('0.01'), 'CZK')).toBe(`0,01${NBSP}Kč`);
    expect(money(d('0.0149'), 'CZK')).toBe(`0,01${NBSP}Kč`);
  });

  it('koruny se píšou „Kč“, kód měny jen u cizích měn', () => {
    // u korunového titulu stálo „1 010,50 CZK za kus“ vedle „Hodnota 40 000 Kč“
    expect(currencyUnit('CZK')).toBe('Kč');
    expect(currencyUnit('USD')).toBe('USD');
    expect(money(d('1010.5'), 'CZK')).toBe(`1${NBSP}010,50${NBSP}Kč`);
    expect(money(d('1010.5'), 'CZK')).not.toContain('CZK');
  });
});

describe('profitLoss: zisk pozice vedle hodnoty v korunách', () => {
  const NBSP = '\u00A0';

  it('korunový zisk je v celých korunách jako hodnota vedle něj', () => {
    // bylo „+4 000,00 CZK“ vedle „40 000 Kč“
    expect(profitLoss(d('4000'), 'CZK')).toBe(`+4${NBSP}000${NBSP}Kč`);
    expect(profitLoss(d('-1234.56'), 'CZK')).toBe(`-1${NBSP}235${NBSP}Kč`);
    expect(profitLoss(d('0'), 'CZK')).toBe(`0,00${NBSP}Kč`);
  });

  it('pod korunu přesně, ne „+0 Kč“ (R2-11)', () => {
    expect(profitLoss(d('0.0003'), 'CZK')).toBe(`+0,0003${NBSP}Kč`);
    expect(profitLoss(d('-0.42'), 'CZK')).toBe(`-0,42${NBSP}Kč`);
  });

  it('cizí měna na setiny s kódem měny', () => {
    expect(profitLoss(d('1860'), 'USD')).toBe(`+1${NBSP}860,00${NBSP}USD`);
    expect(profitLoss(d('-12.5'), 'EUR')).toBe(`-12,50${NBSP}EUR`);
  });
});

describe('qty: počet kusů (L6a-08)', () => {
  it('drobná kryptopozice se ukáže přesně, ne zaokrouhlená na 4 místa nebo na nulu', () => {
    expect(qty(d('0.00075667'))).toBe('0,00075667');
    expect(qty(d('0.00004321'))).toBe('0,00004321');
    expect(qty(0.00000001)).toBe('0,00000001');
  });

  it('koncové nuly nepřidává a celé kusy zůstávají bez desetin', () => {
    expect(qty(d('10'))).toBe('10');
    expect(qty(d('2.5'))).toBe('2,5');
    expect(qty(d('2.12500000'))).toBe('2,125');
    expect(qty(d('1234.5'))).toBe('1 234,5');
  });

  it('devátým místem počínaje zaokrouhluje', () => {
    expect(qty(d('0.123456789'))).toBe('0,12345679');
  });

  it('číslo z hlášky simulátoru „Držíš jen … ks“ jde zadat zpátky a pozici nepřekročí', () => {
    // dřív hláška ukázala 0,0008 ks a totéž číslo vzápětí odmítla jako víc, než držíš
    for (const held of [d('0.00075667'), d('0.00004321'), d('12.5'), d('3')]) {
      const typed = qty(held).replace(/\s/g, '').replace(',', '.');
      expect(d(typed).eq(held), `${held.toString()} → „${qty(held)}“`).toBe(true);
    }
  });
});

describe('yearList: výčet roků česky (podmínky a ceník o XML pro EPO)', () => {
  it('spojuje poslední dva roky spojkou „a“, ostatní čárkou', () => {
    expect(yearList([2024])).toBe('2024');
    expect(yearList([2024, 2025])).toBe('2024 a 2025');
    expect(yearList([2026, 2024, 2025])).toBe('2024, 2025 a 2026');
    expect(yearList([])).toBe('');
  });

  it('podmínky i ceník tak píší roky, za které XML pro EPO opravdu existuje', () => {
    // E-29: za které roky XML existuje, se má uživatel dozvědět předem, ne
    // až ve chvíli, kdy ho chce stáhnout
    expect(yearList(EPO_SUPPORTED_YEARS)).toBe('2024 a 2025');
  });
});
