import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * C-3-06: pojistka proti zkušebnímu režimu Stripu (C-29) musí být vyhodnocená
 * při požadavku, ne při buildu.
 *
 * `STRIPE_SECRET_KEY` je ve Vercelu citlivá proměnná a při `next build` není
 * k dispozici. Staticky předrenderovaný `/cenik` proto vyšel bez varování
 * a veřejně prodával za 490 a 990 Kč, přestože se ve zkušebním režimu nemohlo
 * nic strhnout — a z CI to nešlo poznat, protože v testech i v devu pojistka
 * spí schválně (`NODE_ENV !== 'production'`).
 *
 * Test proto hlídá mechanismus, ne text: každá VEŘEJNÁ stránka, která pojistku
 * vykresluje, musí být dynamická. Přihlášené stránky pod `app/(app)` dynamické
 * jsou už tím, že čtou relaci z cookies.
 */

const APP_DIR = join(import.meta.dirname, '..', 'app');

function pageFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return pageFiles(full);
    return entry === 'page.tsx' ? [full] : [];
  });
}

describe('pojistka zkušebního režimu Stripu (C-29)', () => {
  const stranky = pageFiles(APP_DIR)
    .map((file) => ({ file, zdroj: readFileSync(file, 'utf8') }))
    .filter(({ zdroj }) => zdroj.includes('stripeSandboxInProduction'));

  it('pojistku vůbec někde vykreslujeme', () => {
    expect(stranky.length).toBeGreaterThan(0);
  });

  it.each(stranky.map(({ file }) => file))(
    'veřejná stránka s pojistkou se renderuje při požadavku: %s',
    (file) => {
      const zdroj = readFileSync(file, 'utf8');
      // pod app/(app) rozhoduje relace z cookies → stránka je dynamická sama
      const jePrihlasena = file.includes(`${join('app', '(app)')}`);
      if (jePrihlasena) return;
      expect(zdroj).toContain("export const dynamic = 'force-dynamic'");
    },
  );
});

/**
 * E-3-04: prodejní formulář nabízí deset daňových let a slibuje k nim „XML pro
 * elektronické podání" bez jediné výhrady, přestože oficiální struktura DPFDP7
 * existuje jen pro roky v `EPO_SUPPORTED_YEARS`. Informace o omezení plnění
 * musí padnout PŘED platbou, ne až v ceníku o stránku vedle.
 */
describe('omezení XML pro EPO je vidět před platbou (E-3-04)', () => {
  it('stránka předplatného vypisuje podporované roky z jediného zdroje', async () => {
    const source = readFileSync(join(APP_DIR, '(app)', 'predplatne', 'page.tsx'), 'utf8');
    expect(source).toContain('EPO_SUPPORTED_YEARS');
    // ne natvrdo zapsané roky, které by se rozešly s lib/epo.ts
    expect(source).toMatch(/XML pro elektronické podání umíme/);

    const { EPO_SUPPORTED_YEARS } = await import('@/lib/epo');
    expect(EPO_SUPPORTED_YEARS.length).toBeGreaterThan(0);
    for (const rok of EPO_SUPPORTED_YEARS) {
      expect(source).not.toContain(`roky ${rok} a`); // roky se skládají z konstanty
    }
  });
});
