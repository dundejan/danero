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
 * Telefon provozovatele (§ 1820 odst. 1 písm. c OZ) se bere z proměnné
 * `DANERO_CONTACT_PHONE`, která při `next build` neexistuje. Staticky
 * předrenderovaná stránka si proto zapekla `phone = null` a telefon na ní nebyl
 * vidět, přestože byl ve Vercelu nastavený — týkalo se to dvanácti veřejných
 * stránek, ne jen podmínek a soukromí.
 *
 * Hlídá se mechanismus, ne text: patička ruší předrenderování a každá stránka,
 * která telefon vypisuje, jde přes marketingový shell, takže render při
 * požadavku zdědí. Jedno místo místo dvanácti příznaků.
 */
describe('telefon provozovatele se renderuje při požadavku (§ 1820/1 c)', () => {
  const SHELL = readFileSync(
    join(import.meta.dirname, '..', 'components', 'marketing-page.tsx'),
    'utf8',
  );

  it('patička telefon opravdu vypisuje', () => {
    expect(SHELL).toContain('OPERATOR.phone');
  });

  it('patička zastaví předrenderování', () => {
    // Na začátku řádku, ne kdekoli v souboru: `toContain` by si `await
    // connection()` našel i v zakomentovaném řádku nebo v tomhle komentáři
    // a pojistka by mlčky prošla i s vypnutou opravou (vyzkoušeno).
    expect(SHELL).toMatch(/^\s*await connection\(\);/m);
    expect(SHELL).toMatch(/^import \{[^}]*\bconnection\b[^}]*\} from 'next\/server';/m);
  });

  const sTelefonem = pageFiles(APP_DIR)
    .map((file) => ({ file, zdroj: readFileSync(file, 'utf8') }))
    .filter(({ zdroj }) => zdroj.includes('OPERATOR.phone'));

  it('telefon vypisuje i některá stránka ve vlastním textu', () => {
    expect(sTelefonem.length).toBeGreaterThan(0);
  });

  it.each(sTelefonem.map(({ file }) => file))(
    'stránka s telefonem dědí render při požadavku ze shellu: %s',
    (file) => {
      const zdroj = readFileSync(file, 'utf8');
      const jdePresShell = /MarketingPage|MarketingFooter/.test(zdroj);
      const vlastniPriznak = zdroj.includes("export const dynamic = 'force-dynamic'");
      expect(jdePresShell || vlastniPriznak).toBe(true);
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
