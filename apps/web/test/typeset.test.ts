import { createElement, Fragment, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { typeset, typesetText } from '@/components/typeset';

/**
 * Česká sazba dlouhých textů (nálezy R1A-04 a R1A-09).
 *
 * Recenze redesignu našla v článcích, odpovědích, návodech a právních textech
 * 51 chyb zalomení na 1440 px a 91 na telefonu („od 15. 2. / 2025“, „15 / %“,
 * „e- / mailem“): `tidy()` bere řetězec a texty v JSX ho nikde nevolaly.
 * `typeset()` proto prochází strom Reactu — a tenhle test hlídá dvě věci:
 * že pravidla drží, a že sazba NIKDY nezmění znění (u právních textů
 * podmínka, ne zdvořilost).
 */
// rám marketingové stránky čte přihlášení (asynchronní komponenta) — k věci nepatří
vi.mock('@/components/marketing-page', () => ({
  MarketingPage: ({ children }: { children: ReactNode }) => createElement('div', null, children),
  PageHero: () => null,
}));

const NBSP = '\u00a0';
const NB_HYPHEN = '\u2011';

/** Zpátky na obyčejné mezery a spojovníky — tak se pozná, že se nezměnilo nic jiného. */
const plain = (text: string): string => text.replaceAll(NBSP, ' ').replaceAll(NB_HYPHEN, '-');

const html = (node: ReactNode): string =>
  renderToStaticMarkup(createElement('div', null, typeset(node))).replace(/^<div>|<\/div>$/g, '');

describe('typesetText: co tidy() neumí', () => {
  it('datum se nerozlomí uvnitř', () => {
    expect(typesetText('Kryptoaktiva: od 15. 2. 2025 vlastní pravidla')).toBe(
      `Kryptoaktiva: od 15.${NBSP}2.${NBSP}2025 vlastní pravidla`,
    );
    expect(typesetText('Prodeje z 1. 1. až 14. 2. 2025')).toBe(
      `Prodeje z${NBSP}1.${NBSP}1. až 14.${NBSP}2.${NBSP}2025`,
    );
    expect(typesetText('oznamuje se do 10. ledna')).toBe(`oznamuje se do 10.${NBSP}ledna`);
  });

  it('řádek nezačne pomlčkou', () => {
    expect(typesetText('vývojář z Prahy — a Danero jsem napsal pro sebe')).toBe(
      `vývojář z${NBSP}Prahy${NBSP}— a${NBSP}Danero jsem napsal pro sebe`,
    );
    // pomlčka v rozsahu bez mezer zůstává, jak je
    expect(typesetText('v sezóně (únor–duben)')).toBe(`v${NBSP}sezóně (únor–duben)`);
  });

  it('číslo drží s jednotkou, kterou tidy() nezná', () => {
    expect(typesetText('držené déle než 3 roky')).toBe(`držené déle než 3${NBSP}roky`);
    expect(typesetText('potvrdí do 72 hodin')).toBe(`potvrdí do 72${NBSP}hodin`);
    expect(typesetText('do úhrnu 40 mil. Kč ročně')).toBe(
      `do úhrnu 40${NBSP}mil.${NBSP}Kč ročně`,
    );
    expect(typesetText('nad 5 milionů Kč')).toBe(`nad 5${NBSP}milionů Kč`);
    expect(typesetText('zákon č. 586/1992 Sb., o daních')).toBe(
      `zákon č.${NBSP}586/1992${NBSP}Sb., o${NBSP}daních`,
    );
  });

  it('zkratka drží s tím, co uvádí', () => {
    expect(typesetText('podle čl. 28 GDPR')).toBe(`podle čl.${NBSP}28 GDPR`);
    expect(typesetText('tzv. elektronické peněžní tokeny')).toBe(
      `tzv.${NBSP}elektronické peněžní tokeny`,
    );
    // „ř.“ jen jako samostatná zkratka řádku, ne konec slova
    expect(typesetText('patří na ř. 86')).toBe(`patří na ř.${NBSP}86`);
    expect(typesetText('nikdo ho nepotř. dál')).toBe('nikdo ho nepotř. dál');
  });

  it('letopočet, běžná slova a hotová sazba zůstávají', () => {
    expect(typesetText('Za rok 2026 podáš přiznání')).toBe('Za rok 2026 podáš přiznání');
    const once = typesetText('od 15. 2. 2025 do 100 000 Kč — a pak e-mailem');
    expect(typesetText(once)).toBe(once);
  });

  it.each([
    'Kryptoaktiva: od 15. 2. 2025 vlastní pravidla — a ne jen pro bitcoin.',
    'Dozvíš se to e-mailem nejméně 30 dní předem (čl. 6 odst. 1 písm. b GDPR).',
    'USA, Německo či Japonsko 15 %, Nizozemsko jen 10 %; strop 40 mil. Kč trvá.',
  ])('mění jen druh mezer a spojovník: %s', (text) => {
    const set = typesetText(text);
    expect(set).not.toBe(text);
    expect(plain(set)).toBe(text);
  });
});

describe('typeset: strom Reactu', () => {
  it('sousední texty a čísla sází jako jednu větu', () => {
    // `{count} platforem` a `do {limit} Kč` jsou v JSX dva potomci
    expect(html(['U ', 17, ' platforem čteme výpis do ', '100 000', ' Kč.'])).toBe(
      `U${NBSP}17 platforem čteme výpis do 100${NBSP}000${NBSP}Kč.`,
    );
  });

  it('předložka před odkazem nezůstane na konci řádku', () => {
    const node = ['Co platí, je v ', createElement('a', { href: '/podminky', key: 'a' }, 'podmínkách užití'), '.'];
    expect(html(node)).toBe(`Co platí, je v${NBSP}<a href="/podminky">podmínkách užití</a>.`);
  });

  it('pomlčka za odkazem zůstane na jeho řádku', () => {
    const node = ['Napiš na ', createElement('a', { href: '/kontakt', key: 'a' }, 'stránku'), ' — odpovídám osobně.'];
    expect(html(node)).toBe(`Napiš na <a href="/kontakt">stránku</a>${NBSP}— odpovídám osobně.`);
  });

  it('prochází vnořené prvky i fragmenty', () => {
    const node = createElement(
      Fragment,
      null,
      createElement('p', null, 'Limit ', createElement('strong', null, '100 000 Kč'), ' platí i v roce 2026.'),
    );
    expect(html(node)).toBe(
      `<p>Limit <strong>100${NBSP}000${NBSP}Kč</strong> platí i${NBSP}v${NBSP}roce 2026.</p>`,
    );
  });

  it('kontakt a kód nechává znak po znaku', () => {
    // adresa se slovem „e-mail“ by jinak dostala nezlomitelný spojovník a po
    // zkopírování by nefungovala
    const address = 'e-mail@priklad.test';
    const node = [
      'Piš e-mailem na ',
      createElement('a', { href: `mailto:${address}`, key: 'a' }, address),
      ' nebo zadej ',
      createElement('code', { key: 'c' }, 'a b 1 000'),
      '.',
    ];
    const rendered = html(node);
    expect(rendered).toContain(`Piš e${NB_HYPHEN}mailem na `);
    expect(rendered).toContain(`>${address}</a>`);
    expect(rendered).toContain('<code>a b 1 000</code>');
  });

  it('prázdné hodnoty a prvky bez potomků vrací beze změny', () => {
    expect(typeset(null)).toBeNull();
    expect(typeset(false)).toBe(false);
    expect(typeset(7)).toBe(7);
    const line = createElement('hr');
    expect(typeset(line)).toBe(line);
  });
});

/**
 * Právní texty: sazba smí změnit jen druh mezer (a spojovník v „e-mail“).
 * Stránka se vykreslí dvakrát — se sazbou a s vypnutou — a po převodu zpět
 * na obyčejné znaky musí vyjít tentýž text. Kdyby kdokoli přidal do
 * `typesetText` pravidlo, které přepíše slovo, číslo nebo interpunkci
 * podmínek, spadne to tady.
 */
describe('/podminky a /soukromi: sazba nemění znění', () => {
  afterEach(() => {
    vi.doUnmock('@/components/typeset');
    vi.resetModules();
  });

  const textOf = (markup: string): string =>
    markup
      .replace(/<[^>]+>/g, '')
      .replaceAll('&quot;', '"')
      .replaceAll('&#x27;', "'")
      .replaceAll('&amp;', '&');

  async function renderPage(page: 'podminky' | 'soukromi', typesetting: boolean): Promise<string> {
    vi.resetModules();
    if (typesetting) {
      vi.doUnmock('@/components/typeset');
    } else {
      vi.doMock('@/components/typeset', () => ({
        typeset: (node: ReactNode) => node,
        typesetText: (text: string) => text,
      }));
    }
    const { default: Page } =
      page === 'podminky' ? await import('@/app/podminky/page') : await import('@/app/soukromi/page');
    return textOf(renderToStaticMarkup(createElement(Page)));
  }

  it.each(['podminky', 'soukromi'] as const)(
    '/%s: po převodu mezer zpět je text znak po znaku stejný',
    { timeout: 60_000 },
    async (page) => {
      const raw = await renderPage(page, false);
      const set = await renderPage(page, true);

      // bez sazby stránka žádnou pevnou mezeru nenese — jinak by test nic neměřil
      expect(raw).not.toContain(NB_HYPHEN);
      // sazba se opravdu zapojila…
      expect(set.split(NBSP).length - 1).toBeGreaterThan(50);
      expect(set).toContain(`e${NB_HYPHEN}mail`);
      // …a nezměnila nic než mezery a spojovník
      expect(plain(set)).toBe(plain(raw));
    },
  );
});
