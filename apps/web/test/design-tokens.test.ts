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
