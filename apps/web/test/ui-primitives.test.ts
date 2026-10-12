import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AppToolbar } from '@/components/app-toolbar';
import { Button, buttonVariants } from '@/components/ui/button';
import { DisclosureRow } from '@/components/ui/disclosure';
import { Row } from '@/components/ui/list';
import { SectionHeader } from '@/components/ui/section';
import { Stat } from '@/components/ui/stat';
import { StatusLabel } from '@/components/ui/status';
import { LotStatus } from '@/components/views/position-view';

const webRoot = join(import.meta.dirname, '..');
const read = (relative: string): string => readFileSync(join(webRoot, relative), 'utf8');
const css = read('app/globals.css');

/** Tělo bloku, který začíná na `start` (první `{` za ním až po párovou `}`). */
function block(source: string, start: number): { body: string; end: number } {
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return { body: source.slice(open + 1, index), end: index };
  }
  throw new Error('neuzavřený blok');
}

const classesOf = (markup: string): string[] =>
  [...markup.matchAll(/class="([^"]*)"/g)].flatMap((match) => match[1]!.split(/\s+/));

/**
 * Nálezy revize redesignu (R2, R3), které jdou zachytit bez prohlížeče: každý
 * test tady bez příslušné opravy padá. Co je vidět jen v prohlížeči (tah
 * sheetu, vypočítaný styl pole), měří skripty ve `scratchpad/review/fixes/f1`.
 */
describe('pole na dotyku mají 16 px (R3-03)', () => {
  it('pravidlo pro hrubý ukazatel leží MIMO vrstvy, jinak ho utilita velikosti přebije', () => {
    // Bylo v `@layer base`: `text-sm` z vrstvy utilit ho vždy přebilo, pole
    // měla na telefonu 14 px a iOS při fokusu přiblížil stránku.
    const rule = css.search(/@media \(pointer: coarse\)\s*\{\s*input[^{]*\{\s*font-size: 1rem;/);
    expect(rule, 'pravidlo pro pole na dotyku chybí').toBeGreaterThan(-1);
    const layers = [...css.matchAll(/@layer [a-z]+\s*\{/g)].map((match) => ({
      start: match.index,
      end: block(css, match.index).end,
    }));
    expect(layers.length).toBeGreaterThan(0);
    for (const layer of layers) {
      expect(rule < layer.start || rule > layer.end, 'pravidlo je uvnitř @layer').toBe(true);
    }
  });

  it('týká se polí, výběrů i víceřádkových polí', () => {
    const start = css.search(/@media \(pointer: coarse\)\s*\{\s*input/);
    const selector = css.slice(start, css.indexOf('font-size', start));
    expect(selector).toContain('textarea');
    expect(selector).toContain('select');
  });
});

describe('materiály (R3-10, R3-15)', () => {
  const utility = (name: string): string => block(css, css.indexOf(`@utility ${name} {`)).body;

  it('postranní panel a sheet nic nerozostřují — pod panelem nic není, sheet je plná plocha', () => {
    expect(utility('material-sidebar')).not.toContain('backdrop-filter');
    expect(utility('material-sheet')).not.toContain('backdrop-filter');
  });

  it('lišty, pod kterými obsah roluje, průsvitné zůstávají', () => {
    expect(utility('material-bar')).toContain('backdrop-filter');
    expect(utility('material-tabbar')).toContain('backdrop-filter');
  });

  it('plocha sheetu je neprůhledná', () => {
    for (const value of css.matchAll(/--material-sheet:\s*([^;]+);/g)) {
      expect(value[1]).toMatch(/^rgb\(/);
    }
  });
});

describe('pohyb v CSS', () => {
  it('pod otevřeným modálním dialogem stránka neroluje (R3-13, R4-09)', () => {
    const start = css.indexOf('html:has(dialog:modal)');
    expect(start).toBeGreaterThan(-1);
    expect(block(css, start).body).toContain('overflow: hidden');
  });

  it('měřítko bubliny a dialogu je v seznamu přechodu (R3-06)', () => {
    // `scale-95` píše Tailwind do vlastnosti `scale`; s přechodem jen na
    // `transform` měřítko skočilo a bublina jen prolnula
    for (const file of ['components/ui/info-popover.tsx', 'components/ui/confirm-dialog.tsx']) {
      const source = read(file);
      expect(source, file).toContain('data-starting-style:scale-95');
      expect(source, file).toContain('transition-[opacity,scale]');
      expect(source, file).not.toContain('transition-[transform,opacity]');
    }
  });

  it('zavírání je kratší než otevírání (R3-14)', () => {
    expect(read('components/ui/info-popover.tsx')).toContain('data-ending-style:duration-100');
    expect(read('components/ui/confirm-dialog.tsx')).toContain('data-ending-style:duration-150');
  });

  it('omezený pohyb zastaví i palec přepínače na pseudo-prvku (R3-18)', () => {
    expect(css).toContain("[class*='after:transition-transform']::after");
  });

  it('nezůstaly klíčové snímky, které nikdo nepoužívá (R3-24)', () => {
    expect(css).not.toContain('@keyframes dot-in');
  });

  it('toast odchází přechodem, ne odmontováním (R3-12)', () => {
    expect(css).toContain('&[data-leaving]');
    const toast = read('components/toast.tsx');
    expect(toast).toContain('data-leaving');
    expect(toast).toContain('onTransitionEnd');
  });
});

describe('pojistky proti dlouhému obsahu (R2-01, R2-16 až R2-22, R2-26)', () => {
  const longValue = 'velmi-dlouha-adresa-bez-mezer-'.repeat(4) + '@priklad.test';

  it('Row: hodnota se smí zalomit a spadnout pod popisek, nic ji nedrží na šířce obsahu', () => {
    const markup = renderToStaticMarkup(createElement(Row, { label: 'E-mail', value: longValue }));
    const classes = classesOf(markup);
    expect(classes).toContain('flex-wrap');
    expect(classes).toContain('wrap-anywhere');
    // `shrink-0` na hodnotě ji nechalo vyjet ze stránky a překrýt popisek
    const valueSpan = markup.match(/<span class="([^"]*)">velmi-/)?.[1] ?? '';
    expect(valueSpan).toContain('min-w-0');
    expect(valueSpan).not.toContain('shrink-0');
    // popisek si drží místo — nesmáčkne se na nulu
    expect(markup).toMatch(/class="[^"]*min-w-\[30%\][^"]*"/);
  });

  it('Row: šipka odkazu drží u hodnoty a nespadne sama', () => {
    const markup = renderToStaticMarkup(
      createElement(Row, { label: 'Účet', value: longValue, href: '/nastaveni/ucet' }),
    );
    expect(markup).toMatch(/<span class="[^"]*flex[^"]*"><span[^>]*>velmi-[^<]*<\/span><span aria-hidden="true"[^>]*>›/);
  });

  it('Row wrap: popisek s dlouhým slovem se zalomí, místo aby vytekl do hodnoty', () => {
    const markup = renderToStaticMarkup(
      createElement(Row, { wrap: true, label: 'Nejneobhospodařovávatelnější', value: 'ano' }),
    );
    expect(markup).toMatch(/class="[^"]*max-w-\[45%\][^"]*wrap-anywhere[^"]*"/);
  });

  it('Button: popisek se smí zalomit a tlačítko nepřeroste rodiče', () => {
    for (const size of ['sm', 'md', 'lg'] as const) {
      const classes = buttonVariants({ size }).split(/\s+/);
      expect(classes, size).toContain('max-w-full');
      expect(classes, size).not.toContain('whitespace-nowrap');
      // pevná výška by zalomený popisek ořízla — výška je nejmenší, ne pevná
      expect(classes.filter((name) => /^h-\d/.test(name)), size).toEqual([]);
      expect(classes.some((name) => /^min-h-\d/.test(name)), size).toBe(true);
    }
    const markup = renderToStaticMarkup(createElement(Button, null, 'Nahrát výpisy'));
    expect(classesOf(markup)).toContain('wrap-anywhere');
  });

  it('Button: prostrkání se mění s velikostí (R3-23)', () => {
    const small = buttonVariants({ size: 'sm' }).split(/\s+/);
    expect(small).toContain('tracking-normal');
    // společné záporné prostrkání nesmí zůstat v základu — v řetězci tříd bez
    // slučování by se s `tracking-normal` pralo o pořadí v CSS
    expect(small.filter((name) => name === 'tracking-[-0.01em]')).toEqual([]);
    expect(buttonVariants({ size: 'md' }).split(/\s+/)).toContain('tracking-[-0.01em]');
  });

  it('AppToolbar: titulek se od md smí smrštit a nese celé znění v `title`', () => {
    const title = 'Amundi MSCI All Country World UCITS ETF USD Accumulating';
    const markup = renderToStaticMarkup(
      createElement(AppToolbar, { title, back: { href: '/portfolio', label: 'Portfolio' } }),
    );
    const classes = classesOf(markup);
    // `md:flex-none` rušilo smrštění: titulek měl 993 px a stránka posuvník
    expect(classes).not.toContain('md:flex-none');
    expect(classes).toContain('md:flex-initial');
    expect(markup).toContain(`<h1 class="type-title-3 truncate" title="${title}">`);
    // cesta zpět si nebere víc než 40 % lišty
    expect(markup).toMatch(/<nav aria-label="Drobečková navigace" class="[^"]*max-w-\[40%\]/);
  });

  it('DisclosureRow: dlouhý tichý údaj titulek nesloží po slově na řádek', () => {
    const markup = renderToStaticMarkup(
      createElement(DisclosureRow, { title: 'Kontrola', meta: longValue, children: 'text' }),
    );
    expect(markup).toMatch(/class="[^"]*max-w-\[40%\][^"]*wrap-anywhere[^"]*">velmi-/);
    // v tisku bez přesahu do okrajů (R2-30)
    expect(classesOf(markup)).toContain('print:mx-0');
  });

  it('DisclosureRow: `defaultOpen` otevře řádek napoprvé a dál ho neřídí', () => {
    const row = (defaultOpen: boolean): string =>
      renderToStaticMarkup(
        createElement(DisclosureRow, { title: 'Dávka', defaultOpen, children: 'chyby' }),
      );
    expect(row(true)).toMatch(/<details[^>]* open=""/);
    expect(row(false)).not.toMatch(/<details[^>]* open/);
    // Řízený atribut `open` by řádek zavřel, jakmile by další vykreslení ze
    // serveru přišlo bez něj (dávka v historii importů po úklidu adresy) —
    // `DetailsOnce` si proto první hodnotu drží ve stavu a dál ji nemění.
    const source = read('components/ui/details-once.tsx');
    expect(source).toMatch(/const \[initiallyOpen\] = useState\(defaultOpen\)/);
    // historie importů a řádky napojení brokera se otevírají takhle, ne přes `open`
    for (const file of [
      'app/(app)/import/import-history.tsx',
      'app/(app)/import/connect-broker.tsx',
    ]) {
      expect(read(file), file).not.toMatch(/<DisclosureRow[^>]*\sopen=/);
      expect(read(file), file).toContain('defaultOpen=');
    }
  });

  it('SegmentedControl: nepřeteče, roluje uvnitř a segment má na dotyku 44 px', () => {
    const source = read('components/ui/segmented-control.tsx');
    expect(source).toContain('overflow-x-auto');
    // dráha se nesmršťuje pod šířku popisků — sloupce `fr` by se jinak smáčkly
    // a popisky vykreslily přes sebe
    expect(source).toContain('min-w-full shrink-0');
    // okolí přitom hlásí nulovou nejmenší šířku, takže neroztáhne sloupec stránky
    expect(source).toContain('grid-cols-[minmax(0,1fr)]');
    // 28 px + 2 × 8 px; dřív -inset-y-1.5 = 40 px (R2-23)
    expect(source).not.toContain('pointer-coarse:after:-inset-y-1.5');
    expect(source).toContain('after:-inset-y-2');
  });

  it('StatusLabel: tečka patří k prvnímu řádku víceřádkového textu', () => {
    const markup = renderToStaticMarkup(createElement(StatusLabel, { tone: 'danger', children: 'přes limit' }));
    const classes = classesOf(markup);
    expect(classes).toContain('items-start');
    expect(classes).not.toContain('items-center');
  });

  it('Stat: popisek s vysvětlivkou i bez ní je stejně vysoký (čísla lícují)', () => {
    const markup = renderToStaticMarkup(createElement(Stat, { label: 'Hodnota', value: '1 Kč' }));
    expect(markup).toMatch(/<dt class="[^"]*min-h-6[^"]*"/);
  });

  it('velké číslo má strop podle šířky okna — při zvětšeném písmu nevyjede ze stránky', () => {
    const figure = block(css, css.indexOf('@utility type-figure-lg {')).body;
    expect(figure).toMatch(/font-size: min\(clamp\([^;]+\), 9vw\);/);
  });
});

/**
 * Text, který čte čtečka (a který si člověk zkopíruje), je obsah prvku bez
 * značek. Dva sousední řádkové prvky oddělené jen okrajem v něm splynou:
 * nadpis sekce „Prodeje v roce 2026“ s počtem 4 se četl „Prodeje v roce 20264“
 * a přehled nadpisů nabízel „Pozice52“. Našlo to až E2E po redesignu, když
 * začalo nadpisy hledat podle role a celého jména.
 */
describe('sousední texty se v přístupném názvu neslepí', () => {
  const textOf = (markup: string): string => markup.replace(/<[^>]+>/g, '');

  it('SectionHeader: počet za titulkem odděluje mezera', () => {
    const markup = renderToStaticMarkup(
      createElement(SectionHeader, { title: 'Prodeje v roce 2026', count: 4 }),
    );
    expect(textOf(markup)).toBe('Prodeje v roce 2026 4');
  });

  it('SectionHeader: bez počtu za titulkem mezera nepřibude', () => {
    const markup = renderToStaticMarkup(createElement(SectionHeader, { title: 'Limity' }));
    expect(textOf(markup)).toBe('Limity');
  });

  it('LotStatus: odpočet a datum osvobození v buňce tabulky odděluje mezera', () => {
    const lot = {
      exemptionPossible: true,
      isExempt: false,
      daysToExempt: 245,
      exemptFrom: '2027-06-12',
    } as Parameters<typeof LotStatus>[0]['lot'];
    const text = textOf(renderToStaticMarkup(createElement(LotStatus, { lot })));
    expect(text.replace(/\s/g, ' ')).toBe('za 245 dní 12. 6. 2027');
  });
});
