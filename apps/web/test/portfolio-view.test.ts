import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { d, parseTransactions } from '@danero/shared';
import { PortfolioView } from '@/components/views/portfolio-view';
import { PositionView } from '@/components/views/position-view';
import { analyzeForUser, type ProfileRow } from '@/lib/portfolio';
import type { InstrumentPrice } from '@/lib/prices';

/**
 * Portfolio a detail pozice nad daty bez cen, s částí cen a se všemi cenami.
 *
 * Ceny jsou jen od připojeného brokera — kdo nahrává výpisy, nemá žádnou.
 * Dva nálezy z revize redesignu:
 * - „Bez daně už dnes 0 Kč · 0 % z oceněných pozic · 3 bez ceny“ (nula jen
 *   proto, že pozicím s kusy bez daně chybí cena),
 * - R1B-30: „Hodnota 61 622 Kč“ a hned vedle „Zisk/ztráta +378,00 USD“ — dvě
 *   sousední čísla v různých měnách.
 */
// obsah vysvětlivky se vykreslí až po otevření — test si ho nechá vypsat
vi.mock('@/components/ui/info-popover', () => ({
  InfoPopover: ({ children }: { children: ReactNode }) =>
    createElement('div', { 'data-info': '' }, children),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined, prefetch: () => undefined }),
  usePathname: () => '/portfolio',
  useSearchParams: () => new URLSearchParams(),
}));

const PROFILE: ProfileRow = {
  userId: 'u1',
  regime: 'ZAMESTNANEC',
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
const TODAY = '2026-10-11';
const YEAR = 2026;

const buy = (
  id: string,
  isin: string,
  ticker: string,
  quantity: string,
  pricePerShare: string,
  currency: string,
  tradeDate: string,
  assetClass?: 'CRYPTO',
) => ({
  type: 'BUY' as const,
  id,
  isin,
  ticker,
  quantity,
  pricePerShare,
  currency,
  tradeDate,
  settlementDate: tradeDate,
  ...(assetClass ? { assetClass } : {}),
});

// pět pozic: dvě s kusy po časovém testu (CEZ celá, MSFT zčásti), tři čekají
const TXS = parseTransactions([
  buy('b1', 'CZ0005112300', 'CEZ', '40', '900', 'CZK', '2022-02-10'),
  buy('b2', 'US5949181045', 'MSFT', '6', '250', 'USD', '2023-01-12'),
  buy('b3', 'US5949181045', 'MSFT', '4', '410', 'USD', '2025-05-20'),
  buy('b4', 'IE00BK5BQT80', 'VWCE', '20', '95', 'EUR', '2024-03-15'),
  buy('b5', 'SHIB', 'SHIB', '50000000', '0.00001', 'USD', '2025-08-01', 'CRYPTO'),
  buy('b6', 'US1912161007', 'KO', '15', '60', 'USD', '2026-02-10'),
]);

const price = (value: string, currency: string): InstrumentPrice => ({
  price: d(value),
  currency,
  source: 'trading212',
  asOf: new Date('2026-10-10T12:00:00Z'),
});

const textOf = (markup: string): string =>
  markup
    .replace(/<[^>]+>/g, ' ')
    .replaceAll('&quot;', '"')
    .replaceAll('&amp;', '&')
    .replaceAll('\u00a0', ' ')
    .replace(/\s+/g, ' ');

const portfolio = (prices: Map<string, InstrumentPrice>): string =>
  renderToStaticMarkup(
    createElement(PortfolioView, {
      txs: TXS,
      profile: PROFILE,
      analysis: analyzeForUser(TXS, PROFILE, YEAR, TODAY),
      prices,
      years: [YEAR],
      year: YEAR,
      today: TODAY,
    }),
  );

/** Text jednoho čísla v hlavičce stránky: popisek, hodnota a poznámka. */
const stat = (markup: string, label: string): string => {
  const start = markup.indexOf(`>${label}<`);
  expect(start, label).toBeGreaterThan(-1);
  // číslo končí tam, kde začíná další `<dt>` nebo seznam končí
  const rest = markup.slice(start + 1);
  const end = Math.min(
    ...[rest.indexOf('<dt', 1), rest.indexOf('</dl>')].filter((index) => index > 0),
  );
  return textOf(rest.slice(0, end)).trim();
};

describe('portfolio: „Bez daně už dnes“ podle toho, kolik pozic má cenu', () => {
  it('žádná cena: počet pozic, ne částka', { timeout: 30_000 }, () => {
    const markup = portfolio(new Map());
    const exempt = stat(markup, 'Bez daně už dnes');
    expect(exempt).toContain('2 z 5 pozic');
    expect(exempt).toContain('aspoň zčásti');
    expect(exempt).not.toMatch(/Kč|%/);
    // hodnotu portfolia stránka bez cen netvrdí vůbec
    expect(markup).not.toContain('>Hodnota portfolia<');
    expect(textOf(markup)).toContain('Hodnotu zatím neznáme');
  });

  it('cena jen u pozic, které čekají: místo „0 Kč“ počet pozic', { timeout: 30_000 }, () => {
    // přesně stav z nálezu — oceněné jsou VWCE a KO, kusy bez daně mají CEZ a MSFT
    const markup = portfolio(
      new Map([
        ['IE00BK5BQT80', price('120', 'EUR')],
        ['US1912161007', price('70', 'USD')],
      ]),
    );
    const exempt = stat(markup, 'Bez daně už dnes');
    expect(exempt).toContain('2 z 5 pozic');
    expect(exempt).toContain('bez ceny');
    expect(exempt).not.toContain('0 Kč');
    expect(exempt).not.toContain('z oceněných pozic');
    // hodnota portfolia dál říká, kolik pozic v ní není
    expect(stat(markup, 'Hodnota portfolia')).toContain('3 pozice bez ceny');
  });

  it('cena u části pozic s kusy bez daně: částka a kolik pozic v ní chybí', { timeout: 30_000 }, () => {
    const markup = portfolio(
      new Map([
        ['CZ0005112300', price('1000', 'CZK')],
        ['IE00BK5BQT80', price('120', 'EUR')],
      ]),
    );
    const exempt = stat(markup, 'Bez daně už dnes');
    // CEZ: 40 ks × 1 000 Kč, celé po časovém testu
    expect(exempt).toContain('40 000 Kč');
    expect(exempt).toContain('chybí 1 pozice bez ceny');
    // a vysvětlivka říká, proč
    expect(exempt).toMatch(/1 pozice, která kusy bez daně má, v ní chybí/);
  });

  it('všechno oceněné: částka a podíl portfolia', { timeout: 30_000 }, () => {
    const markup = portfolio(
      new Map([
        ['CZ0005112300', price('1000', 'CZK')],
        ['US5949181045', price('500', 'USD')],
        ['IE00BK5BQT80', price('120', 'EUR')],
        ['SHIB', price('0.00002', 'USD')],
        ['US1912161007', price('70', 'USD')],
      ]),
    );
    const exempt = stat(markup, 'Bez daně už dnes');
    expect(exempt).toMatch(/\d Kč/);
    expect(exempt).toMatch(/% portfolia/);
    expect(exempt).not.toMatch(/chybí|bez ceny|oceněných/);
  });
});

describe('zisk pozice vedle hodnoty v korunách (R1B-30)', () => {
  const analysis = analyzeForUser(TXS, PROFILE, YEAR, TODAY);
  const detail = (isin: string, prices: Map<string, InstrumentPrice>): string =>
    renderToStaticMarkup(createElement(PositionView, { isin, txs: TXS, analysis, prices, today: TODAY }));

  it('detail: hlavní číslo zisku je procento, částka pod ním nese kód měny', { timeout: 30_000 }, () => {
    // MSFT: 6 × 250 + 4 × 410 = 3 140 USD, dnes 10 × 500 = 5 000 USD
    const markup = detail('US5949181045', new Map([['US5949181045', price('500', 'USD')]]));
    const value = stat(markup, 'Hodnota');
    const gain = stat(markup, 'Zisk/ztráta');
    expect(value).toMatch(/\d Kč/);
    // procento napřed (bez měny), dolarová částka až v poznámce
    expect(gain).toMatch(/^Zisk\/ztráta .*\+59,2 % \+1 860,00 USD · před zdaněním$/);
    expect(gain).toMatch(/v měně titulu \(USD\)/);
    // žádný přepočet zisku na koruny — vypadal by jako základ daně
    expect(gain).not.toMatch(/\d Kč/);
  });

  it('korunový titul vysvětlení o měně nepotřebuje', { timeout: 30_000 }, () => {
    const markup = detail('CZ0005112300', new Map([['CZ0005112300', price('1000', 'CZK')]]));
    const gain = stat(markup, 'Zisk/ztráta');
    expect(gain).toMatch(/\+11,1 %/);
    expect(gain).not.toContain('v měně titulu');
  });

  it('korunový titul: zisk i cena v „Kč“, stejně jako hodnota vedle', { timeout: 30_000 }, () => {
    // bylo: Hodnota „40 000 Kč“, pod ní „1 000,00 CZK za kus“ a vedle zisk „+4 000,00 CZK“
    const markup = detail('CZ0005112300', new Map([['CZ0005112300', price('1000', 'CZK')]]));
    expect(stat(markup, 'Hodnota')).toMatch(/40 000 Kč .*1 000,00 Kč za kus/);
    expect(stat(markup, 'Zisk/ztráta')).toContain('+4 000 Kč · před zdaněním');
    expect(textOf(markup)).not.toContain('CZK');
    // i v inspektoru a v řádcích portfolia
    const list = portfolio(new Map([['CZ0005112300', price('1000', 'CZK')]]));
    expect(textOf(list)).toContain('+4 000 Kč');
    expect(textOf(list)).not.toContain('CZK');
  });

  it('portfolio: inspektor píše procento před částku v měně titulu', { timeout: 30_000 }, () => {
    const markup = portfolio(new Map([['US5949181045', price('500', 'USD')]]));
    expect(textOf(markup)).toContain('Zisk/ztráta +59,2 % · +1 860,00 USD');
    expect(textOf(markup)).not.toMatch(/USD \(\+/);
    // legenda sloupců říká, v jaké měně zisk je
    expect(textOf(markup)).toMatch(/Zisk\/ztráta — [^.]*v měně titulu/);
  });
});
