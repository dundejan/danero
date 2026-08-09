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

/**
 * Otevírací JSX tagy formulářových prvků. Naivní `/<input[^>]*>/` by se
 * zastavilo na první `>` — a to bývá šipka v `onChange={(event) => …}`,
 * takže by se className vůbec nedostal do porovnání. Proto ruční průchod,
 * který počítá `{}` a přeskakuje uvozovky.
 */
function openingTags(source: string): string[] {
  const out: string[] = [];
  for (const match of source.matchAll(/<(input|select|textarea|button)(?=[\s/>])/g)) {
    let depth = 0;
    let quote: string | null = null;
    let i = match.index + match[0].length;
    for (; i < source.length; i++) {
      const char = source[i]!;
      if (quote) {
        if (char === quote) quote = null;
      } else if (char === '"' || char === "'" || char === '`') quote = char;
      else if (char === '{') depth++;
      else if (char === '}') depth--;
      else if (char === '>' && depth === 0) break;
    }
    out.push(source.slice(match.index, i));
  }
  return out;
}

/**
 * Blok pravidla (`:root { … }`) z globals.css — s hlídáním zanoření závorek.
 *
 * Selektor se hledá VÝHRADNĚ na začátku řádku a s vlastní `{`. Prosté
 * `indexOf('.dark')` totiž trefí `@custom-variant dark (&:where(.dark, …))`
 * hned na třetím řádku, odtud doskáče na první `{` — a tím je `:root {`.
 * „Tmavý“ režim by se pak měřil světlými hodnotami a test by mlčel.
 */
function cssBlock(css: string, selector: string): string {
  const start = css.search(new RegExp(`(^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{`));
  expect(start, `selektor ${selector} v globals.css`).toBeGreaterThanOrEqual(0);
  let depth = 0;
  for (let i = css.indexOf('{', start); i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) return css.slice(start, i);
  }
  throw new Error(`neuzavřený blok ${selector}`);
}

/** Barevné tokeny jednoho režimu: `--jmeno: #hex`. */
function tokensOf(css: string, selector: string): Record<string, string> {
  const block = cssBlock(css, selector);
  return Object.fromEntries(
    [...block.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})/gi)].map(([, name, hex]) => [
      name!,
      hex!.toLowerCase(),
    ]),
  );
}

/**
 * WCAG 2.1 SC 1.4.11 (Non-text Contrast): hranice, která odlišuje ovládací
 * prvek od okolí, musí mít proti sousedním barvám ≥ 3:1.
 *
 * Hlídá se to tady, a ne axem: axe pro 1.4.11 pravidlo NEMÁ, takže e2e sada
 * tuhle celou třídu nálezů nikdy neuvidí (audit H2-02 — pole měla proti své
 * bílé výplni 1,30:1, v tmavém režimu 1,24:1). Z tokenů se to navíc spočítá
 * přesně a bez prohlížeče.
 */
describe('nontextový kontrast ovládacích prvků (WCAG 1.4.11)', () => {
  const css = readFileSync(join(webRoot, 'app', 'globals.css'), 'utf8');
  const REZIMY = [
    { name: 'světlý', selector: ':root' },
    { name: 'tmavý', selector: '.dark' },
  ];

  it('parser čte oba režimy, ne dvakrát ten samý', () => {
    // pojistka proti tiché chybě v cssBlock: kdyby `.dark` spadl zpátky na
    // `:root`, oba režimy by měly stejné hodnoty a měření tmavého by bylo lež
    expect(tokensOf(css, ':root')['plocha']).not.toEqual(tokensOf(css, '.dark')['plocha']);
  });

  it.each(REZIMY)('okraj polí a tlačítek drží 3:1 v obou režimech ($name)', ({ selector }) => {
    const tokens = tokensOf(css, selector);
    const border = tokens['linka-ovladaci'];
    expect(border, `${selector} --linka-ovladaci`).toBeDefined();

    // sousední barvy: výplň prvku (--plocha) i plocha stránky pod ním (--pozadi)
    const slabe = (['plocha', 'pozadi'] as const)
      .map((surface) => ({
        surface,
        ratio: Number(contrast(border!, tokens[surface]!).toFixed(2)),
      }))
      .filter(({ ratio }) => ratio < 3);

    expect(slabe).toEqual([]);
  });

  /**
   * `--linka` je vlásový oddělovač (rámečky karet, čáry v tabulkách) — na tu
   * se 1.4.11 nevztahuje. Ale kdyby se jí zase orámoval ovládací prvek, byla
   * by chyba zpátky, a v prohlížeči ji nic nechytí. Proto zdrojová kontrola.
   */
  it('žádné pole, select ani tlačítko nemá vlásový okraj --linka', () => {
    const HAIRLINE = /border-linka(?![\w-])/;
    const nalezy: string[] = [];

    for (const file of sourceFiles(join(webRoot, 'app')).concat(
      sourceFiles(join(webRoot, 'components')),
    )) {
      for (const tag of openingTags(readFileSync(file, 'utf8'))) {
        if (HAIRLINE.test(tag)) {
          nalezy.push(`${file.replace(webRoot + '/', '')}: ${tag.slice(0, 60).replace(/\s+/g, ' ')}`);
        }
      }
    }

    // třídy tlačítek nežijí v JSX tagu, ale v `cva` — na primitiva se proto
    // díváme celým souborem
    for (const primitive of ['components/ui/button.tsx', 'components/ui/switch.tsx']) {
      if (HAIRLINE.test(readFileSync(join(webRoot, primitive), 'utf8'))) {
        nalezy.push(`${primitive}: border-linka na sdíleném ovládacím prvku`);
      }
    }

    expect(nalezy).toEqual([]);
  });
});

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

/**
 * H-3-04: výplň odměrky v pásmu „zvýšené čerpání“ měla proti dráze `bg-linka/40`
 * jen 2,76:1, přestože WCAG 1.4.11 chce u grafiky nesoucí informaci 3:1 — a je
 * to nejběžnější stav (30 000–42 500 Kč z limitu 50 000 Kč).
 *
 * H-3-05: `@media print` předefinovával jen šest tokenů, takže tisk z tmavého
 * režimu dal na papír `--zelena-text` 2,30:1 a `--jantar-text` 2,10:1 (AA pro
 * drobný text chce 4,50).
 */
describe('kontrasty odměrky a tisku (H-3-04, H-3-05)', () => {
  const css = readFileSync(join(import.meta.dirname, '..', 'app', 'globals.css'), 'utf8');
  const svetle = tokensOf(css, ':root');

  /** Průhledná dráha `bg-linka/40` na ploše — smíchané barvy, ne token. */
  const smes = (a: string, b: string, alpha: number): string => {
    const kanal = (i: number) =>
      Math.round(
        parseInt(a.slice(1 + i * 2, 3 + i * 2), 16) * alpha +
          parseInt(b.slice(1 + i * 2, 3 + i * 2), 16) * (1 - alpha),
      );
    return `#${[0, 1, 2].map((i) => kanal(i).toString(16).padStart(2, '0')).join('')}`;
  };

  it('každé pásmo odměrky se od dráhy odliší aspoň 3:1', () => {
    const draha = smes(svetle['linka']!, svetle['plocha']!, 0.4);
    const gauge = readFileSync(
      join(import.meta.dirname, '..', 'components', 'limit-gauge.tsx'),
      'utf8',
    );
    const pasma = [...gauge.matchAll(/^\s+(OK|WARNING|CRITICAL|EXCEEDED): 'bg-([a-z-]+)'/gm)];
    expect(pasma).toHaveLength(4);
    for (const [, zona, token] of pasma) {
      const hex = svetle[token!];
      expect(hex, `token --${token} ve světlém režimu`).toBeDefined();
      expect(
        Number(contrast(hex!, draha).toFixed(2)),
        `pásmo ${zona} (--${token}) proti dráze odměrky`,
      ).toBeGreaterThanOrEqual(3);
    }
  });

  it('tisk vrací semafor na světlé hodnoty, ať je papír čitelný', () => {
    const print = cssBlock(css, '@media print');
    const tisk = Object.fromEntries(
      [...print.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})/gi)].map(([, n, hex]) => [
        n!.toLowerCase(),
        hex!.toLowerCase(),
      ]),
    );
    for (const token of ['zelena-text', 'jantar-text', 'oranz-text', 'ruzova-text', 'cervena']) {
      expect(tisk[token], `--${token} v @media print`).toBeDefined();
      expect(
        Number(contrast(tisk[token]!, '#ffffff').toFixed(2)),
        `--${token} na bílém papíře`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
});
