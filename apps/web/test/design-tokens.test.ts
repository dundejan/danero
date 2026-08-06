import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Tailwind na neznámý barevný token nekřičí — třídu prostě zahodí a panel
 * zůstane bez výplně. Takhle se do produkce dostalo `bg-papir-tlumeny`
 * (token nikdy neexistoval) a sedm panelů v účtu i v checkoutu bylo bez pozadí.
 * Tenhle test je pojistka: každá barevná třída musí mít svůj token v globals.css.
 */

const webRoot = join(import.meta.dirname, '..');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.next')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (full.endsWith('.tsx') || full.endsWith('.ts')) out.push(full);
  }
  return out;
}

/** Barevné tokeny vyhlášené v :root — Tailwind z nich dělá utility třídy. */
function declaredTokens(): Set<string> {
  const css = readFileSync(join(webRoot, 'app', 'globals.css'), 'utf8');
  return new Set([...css.matchAll(/^\s*--([a-z0-9-]+):\s*#/gim)].map((m) => m[1]!));
}

/** Utility, které berou barvu z tokenu (`bg-plocha`, `text-ruzova-text`…). */
const COLOR_UTILITIES = ['bg', 'text', 'border', 'ring', 'fill', 'stroke', 'decoration', 'outline'];

/**
 * Tailwindí vlastní hodnoty, které v globals.css být nemají: barvy a klíčová
 * slova, strany (`border-t`), velikosti a struktura (`bg-gradient-to-r`).
 */
const BUILTIN = new Set([
  'white', 'black', 'transparent', 'current', 'inherit', 'none', 'auto', 'left', 'right',
  'center', 'justify', 'start', 'end', 'balance', 'pretty', 'wrap', 'nowrap', 'clip',
  'ellipsis', 'top', 'bottom', 'solid', 'dashed', 'dotted', 'double', 'hidden',
  'xs', 'sm', 'base', 'md', 'lg', 'xl', 'inset',
  // strany a osy: border-t, border-x, ring-inset…
  't', 'b', 'l', 'r', 'x', 'y', 's', 'e',
]);

/** Utility, které za pomlčkou nemají barvu, ale strukturu. */
const NOT_A_COLOR = /^(gradient|offset|opacity|size|width|spacing|nowrap|wrap)(-|$)/;

describe('design tokeny', () => {
  it('každá barevná třída v kódu má token v globals.css', () => {
    const tokens = declaredTokens();
    const pattern = new RegExp(
      `\\b(?:[a-z-]+:)*(${COLOR_UTILITIES.join('|')})-([a-z][a-z0-9-]*)\\b`,
      'g',
    );
    const chybejici: string[] = [];

    for (const file of sourceFiles(join(webRoot, 'app')).concat(
      sourceFiles(join(webRoot, 'components')),
    )) {
      for (const [cela, , raw] of readFileSync(file, 'utf8').matchAll(pattern)) {
        // strana/osa před barvou: border-l-ruzova → ruzova, border-t-0 → 0
        const token = raw!.replace(/^[tblrxyse]-/, '');
        if (BUILTIN.has(token) || tokens.has(token) || NOT_A_COLOR.test(token)) continue;
        // Tailwindí vestavěné palety (gray-500) i číselné varianty necháváme být
        if (/^(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(-\d+)?$/.test(token)) continue;
        if (/^\d/.test(token)) continue;
        chybejici.push(`${file.replace(webRoot + "/", "")}: ${cela}`);
      }
    }

    expect(chybejici).toEqual([]);
  });
});

/** Relativní jas dle WCAG 2.x. */
function luminance(hex: string): number {
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe('kontrast sytých výplní', () => {
  it('bílý text na -syta výplních drží AA 4,5:1', () => {
    // globals.css o nich říká „syté výplně pro CTA/danger s bílým textem" —
    // --zelena-syta to nesplňovala (4,21:1) a nikdo si toho nevšiml, protože
    // axe kontroluje jen vykreslené stránky a token byl použit na jediném místě.
    const css = readFileSync(join(webRoot, 'app', 'globals.css'), 'utf8');
    const syte = [...css.matchAll(/--([a-z]+-syta):\s*(#[0-9a-f]{6})/gi)];
    expect(syte.length).toBeGreaterThan(0);

    const slabe = syte
      .map(([, name, hex]) => ({ name: name!, ratio: contrast('#ffffff', hex!) }))
      .filter(({ ratio }) => ratio < 4.5);

    expect(slabe).toEqual([]);
  });
});
