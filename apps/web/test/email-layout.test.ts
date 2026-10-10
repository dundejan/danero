import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderHtml, type EmailBlock } from '@/lib/email-layout';

/**
 * Barvy e-mailů jsou v `lib/email-layout.ts` natvrdo (poštovní klienti CSS
 * proměnné neumí), takže se od `globals.css` rozejdou potichu: po redesignu
 * z října 2026 zůstala značka i tlačítko v e-mailech v původní růžové, když
 * aplikace dávno mluvila modře. Test proto barvy porovnává s tokeny.
 */

const css = readFileSync(join(import.meta.dirname, '..', 'app', 'globals.css'), 'utf8');

/** Barevné tokeny jednoho režimu — blok se hledá na začátku řádku (viz design-tokens.test.ts). */
function tokensOf(selector: ':root' | '.dark'): Record<string, string> {
  const start = css.search(new RegExp(`(^|\\n)${selector.replace('.', '\\.')}\\s*\\{`));
  expect(start, `selektor ${selector} v globals.css`).toBeGreaterThanOrEqual(0);
  const block = css.slice(start, css.indexOf('\n}', start));
  return Object.fromEntries(
    [...block.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})/gi)].map(([, name, hex]) => [
      name!,
      hex!.toLowerCase(),
    ]),
  );
}

const BLOCKS: EmailBlock[] = [
  { kind: 'p', text: 'Odstavec.' },
  { kind: 'h', text: 'Mezinadpis' },
  { kind: 'cta', label: 'Potvrdit', url: 'https://danero.test/odkaz' },
  { kind: 'rows', rows: [['Soubor', 'vypis.csv']] },
  { kind: 'note', text: 'Poznámka.' },
];

const html = renderHtml({
  title: 'Zkouška',
  preheader: 'Náhled',
  blocks: BLOCKS,
  footer: ['Patička'],
}).toLowerCase();

/** Světlá podoba = inline styly; tmavá = pravidla v `<style>`. */
const inline = html.replace(/<style>[\s\S]*?<\/style>/, '');
const darkRules = /<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? '';

describe('vzhled e-mailů drží krok s aplikací', () => {
  const light = tokensOf(':root');
  const dark = tokensOf('.dark');

  it('parser čte oba režimy, ne dvakrát ten samý', () => {
    expect(light['surface']).not.toEqual(dark['surface']);
  });

  it('tlačítko a značka mají akcent aplikace, ne starou růžovou', () => {
    expect(inline).toContain(`background:${light['accent-fill']}`);
    expect(inline).toContain(`background:${light['accent']}`);
    expect(html).not.toContain('#d6336c');
  });

  it('text a plochy světlé podoby jsou tokeny světlého režimu', () => {
    for (const token of ['ink', 'ink-muted', 'surface', 'canvas']) {
      expect(inline, `token ${token}`).toContain(light[token]!);
    }
  });

  it('tmavý klient dostane tmavou podobu z tokenů tmavého režimu', () => {
    expect(html).toContain('<meta name="color-scheme" content="light dark">');
    expect(darkRules).toContain('prefers-color-scheme:dark');
    for (const token of ['ink', 'ink-muted', 'surface', 'canvas', 'control', 'accent']) {
      expect(darkRules, `token ${token}`).toContain(dark[token]!);
    }
  });

  it('každý obarvený text má třídu, přes kterou ho tmavý režim přebarví', () => {
    // inline `color:` bez třídy by v tmavém klientu zůstal tmavý na tmavém;
    // výjimka je bílý popisek tlačítka, které má v obou režimech stejnou výplň
    const colored = [...inline.matchAll(/<(p|span|td)\b([^>]*)style="[^"]*(?<![-\w])color:(#[0-9a-f]{6})[^"]*"/g)];
    expect(colored.length).toBeGreaterThan(4);
    for (const [tag, , attributes] of colored) {
      expect(attributes, tag).toMatch(/class="e-(ink|muted)"/);
    }
  });

  it('nadpisy nejsou verzálkami', () => {
    expect(inline).not.toContain('text-transform:uppercase');
  });
});
