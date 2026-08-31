import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Pravidlo 1 z CLAUDE.md: identifikátory anglicky bez výjimky, česky jen to,
 * co čte člověk. Do `scripts/stripe-webhook.mjs` se přesto dostaly `KLIC`,
 * `rezim`, `cesta`, `telo`, `endpointy`, `ocekavane`, `vseSedi`, `chybi`
 * a `navic`; `validate-epo.mjs` mělo `prazdny`, `tuzemsky`, `ztrata`,
 * `smisene` nebo `drobnaDan`. Skripty jsou mimo `pnpm lint` typových pravidel,
 * takže je nechytilo nic — proto tenhle strážce.
 *
 * Hlídají se DEKLARACE, ne výskyty: české texty ve výpisech pro člověka
 * (`console.log`) tam patřit mají a zůstávají.
 */
const CZECH_STEMS = [
  'klic',
  'rezim',
  'cesta',
  'telo',
  'endpointy',
  'ocekavane',
  'vseSedi',
  'chybi',
  'navic',
  'prazdny',
  'tuzemsky',
  'ztrat',
  'smisene',
  'drobna',
  'srazk',
  'pocet',
  'nalez',
  'soubor',
  'zprava',
  'vysledek',
  'udaj',
  'castka',
  'hodnota',
  'radek',
  'sloupec',
  'prepinac',
  'skript',
  'seznam',
  'nazev',
  'jmeno',
  'heslo',
];

/** `const x`, `let x`, `function x`, `for (const x of …)` a parametry šipky. */
const DECLARATION = /(?:const|let|var|function)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g;

describe('scripts/: identifikátory anglicky (pravidlo 1)', () => {
  const dir = join(import.meta.dirname, '..', '..', '..', 'scripts');
  const files = readdirSync(dir).filter((name) => name.endsWith('.mjs'));

  it('ve skriptech vůbec nějaké .mjs jsou (jinak test nic nehlídá)', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    it(`${file} nedeklaruje česky pojmenované proměnné ani funkce`, () => {
      const source = readFileSync(join(dir, file), 'utf8');
      const declared = [...source.matchAll(DECLARATION)].map((match) => match[1]!);
      const czech = declared.filter((name) =>
        CZECH_STEMS.some((stem) => name.toLowerCase().includes(stem.toLowerCase())),
      );
      expect(czech, `české identifikátory v ${file}`).toEqual([]);
      // Diakritika v identifikátoru je vždycky chyba — JS ji technicky povolí.
      expect(declared.filter((name) => /[^\x20-\x7E]/.test(name))).toEqual([]);
    });
  }
});
