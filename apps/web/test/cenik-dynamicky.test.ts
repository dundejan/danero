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
  /**
   * Pojistka se dá vykreslit i NEPŘÍMO: `OrderPage` (objednávka) i obal
   * `BillingModeNotice` ji mají uvnitř, takže objednávková stránka o ní
   * v kódu nemá ani zmínku. Kdyby se hledal jen `stripeSandboxInProduction`,
   * první veřejná stránka postavená na `OrderPage` by se předrenderovala bez
   * varování a strážce by mlčel — přesně ta regrese, kvůli které vznikl.
   */
  const stranky = pageFiles(APP_DIR)
    .map((file) => ({ file, zdroj: readFileSync(file, 'utf8') }))
    .filter(
      ({ zdroj }) =>
        zdroj.includes('stripeSandboxInProduction') ||
        zdroj.includes('BillingModeNotice') ||
        zdroj.includes("from '@/components/order-page'"),
    );

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

  it('patička vypisuje kontakt z prostředí (e-mail; telefon je jen v podmínkách)', () => {
    expect(SHELL).toContain('OPERATOR.email');
    // telefon v patičce být NEMÁ — § 1820 plní /podminky#kontakt a potvrzení
    // objednávky, na dvanácti stránkách by jen zval k volání
    expect(SHELL).not.toContain('OPERATOR.phone');
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

  it('telefon vypisuje právě jedna stránka — podmínky', () => {
    const relativni = sTelefonem.map(({ file }) => file.slice(APP_DIR.length + 1));
    expect(relativni).toEqual([join('podminky', 'page.tsx')]);
  });

  it('objednávka na ten odstavec odkazuje adresně (§ 1820 před uzavřením smlouvy)', () => {
    const KOMPONENTY = join(import.meta.dirname, '..', 'components');
    const poznamka = readFileSync(join(KOMPONENTY, 'purchase-legal-note.tsx'), 'utf8');
    expect(poznamka).toContain('/podminky#kontakt');
    // vykresluje ji přehled tarifů i obě objednávkové stránky (přes `OrderPage`)
    for (const soubor of [
      join(APP_DIR, '(app)', 'predplatne', 'page.tsx'),
      join(KOMPONENTY, 'order-page.tsx'),
    ]) {
      expect(readFileSync(soubor, 'utf8')).toContain('<PurchaseLegalNote');
    }
    expect(readFileSync(join(APP_DIR, 'podminky', 'page.tsx'), 'utf8')).toContain('id="kontakt"');
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
    const source = readFileSync(
      join(APP_DIR, '(app)', 'predplatne', 'podklady', 'page.tsx'),
      'utf8',
    );
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

/**
 * H-3-20: `?rok=` mimo rozsah se tiše nahradil běžným rokem, ale v adresním
 * řádku zůstal — stránka ukazovala 2025 a URL tvrdila `?rok=1999`. Uložený
 * nebo přeposlaný odkaz pak dával jiná čísla, než na kterých vznikl.
 */
describe('neplatný ?rok= srovná URL, nespadne tiše (H-3-20)', () => {
  it('všech šest stránek s výběrem roku používá společný pomocník', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const stranky = [
      ['(app)', 'report'],
      ['(app)', 'prehled'],
      ['(app)', 'portfolio'],
      ['demo', 'report'],
      ['demo', 'prehled'],
      ['demo', 'portfolio'],
    ];
    for (const [skupina, cesta] of stranky) {
      const zdroj = readFileSync(join(APP_DIR, skupina!, cesta!, 'page.tsx'), 'utf8');
      expect(zdroj, `${skupina}/${cesta} nepoužívá resolveTaxYear`).toContain('resolveTaxYear(');
      // starý tichý fallback se nesmí vrátit
      expect(zdroj).not.toMatch(/years\.includes\(Number\(rok\)\) \? Number\(rok\) : currentYear/);
    }
  });

  it('pomocník přesměruje jen tehdy, když parametr opravdu přišel', async () => {
    const { resolveTaxYear } = await import('@/lib/utils');
    expect(resolveTaxYear(undefined, [2024, 2025], 2025, '/report')).toBe(2025);
    expect(resolveTaxYear('2024', [2024, 2025], 2025, '/report')).toBe(2024);
    // neplatný rok skončí přesměrováním, tedy výjimkou z next/navigation
    expect(() => resolveTaxYear('1999', [2024, 2025], 2025, '/report')).toThrow();
  });
});
