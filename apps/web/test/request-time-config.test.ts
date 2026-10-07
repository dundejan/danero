import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Údaje z prostředí se musí číst při požadavku, ne při buildu.
 *
 * Citlivé proměnné ve Vercelu při `next build` NEEXISTUJÍ. Staticky
 * předrenderovaná stránka si tak zapeče prázdnou hodnotu a údaj na ní není
 * vidět, i když je nastavený — ověřeno čtyřmi nasazeními (telefon
 * provozovatele, 9. 8. 2026) a ještě předtím ceníkem, který kvůli tomu veřejně
 * prodával ve zkušebním režimu Stripu (nález C-3-06).
 *
 * Z CI se to poznat nedá, protože v testech i v devu proměnné jsou. Hlídá se
 * proto mechanismus, ne text: patička ruší předrenderování a každá stránka,
 * která údaj z prostředí vypisuje, jde přes marketingový shell nebo má
 * vlastní příznak.
 *
 * Soubor navazuje na `cenik-dynamicky.test.ts`, který zanikl s placenými
 * tarify 8. 10. 2026 — tyhle strážce s platbami nesouvisely a zůstávají.
 */

const WEB_DIR = join(import.meta.dirname, '..');
const APP_DIR = join(WEB_DIR, 'app');

function pageFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return pageFiles(full);
    return entry === 'page.tsx' ? [full] : [];
  });
}

const rendersAtRequestTime = (source: string): boolean =>
  /MarketingPage|MarketingFooter/.test(source) ||
  source.includes("export const dynamic = 'force-dynamic'");

describe('kontakt provozovatele se renderuje při požadavku', () => {
  const SHELL = readFileSync(join(WEB_DIR, 'components', 'marketing-page.tsx'), 'utf8');

  it('patička vypisuje kontakt z prostředí (e-mail; telefon je jen v podmínkách)', () => {
    expect(SHELL).toContain('OPERATOR.email');
    // telefon v patičce být NEMÁ — na dvanácti stránkách by jen zval k volání
    expect(SHELL).not.toContain('OPERATOR.phone');
  });

  it('patička zastaví předrenderování', () => {
    // Na začátku řádku, ne kdekoli v souboru: `toContain` by si `await
    // connection()` našel i v zakomentovaném řádku nebo v tomhle komentáři
    // a pojistka by mlčky prošla i s vypnutou opravou (vyzkoušeno).
    expect(SHELL).toMatch(/^\s*await connection\(\);/m);
    expect(SHELL).toMatch(/^import \{[^}]*\bconnection\b[^}]*\} from 'next\/server';/m);
  });

  const withPhone = pageFiles(APP_DIR)
    .map((file) => ({ file, source: readFileSync(file, 'utf8') }))
    .filter(({ source }) => source.includes('OPERATOR.phone'));

  it('telefon vypisuje právě jedna stránka — podmínky', () => {
    const relative = withPhone.map(({ file }) => file.slice(APP_DIR.length + 1));
    expect(relative).toEqual([join('podminky', 'page.tsx')]);
    expect(readFileSync(join(APP_DIR, 'podminky', 'page.tsx'), 'utf8')).toContain('id="kontakt"');
  });

  it.each(withPhone.map(({ file }) => file))(
    'stránka s telefonem se renderuje při požadavku: %s',
    (file) => {
      expect(rendersAtRequestTime(readFileSync(file, 'utf8'))).toBe(true);
    },
  );
});

/**
 * Totéž platí pro dobrovolný příspěvek (`lib/support.ts`): číslo účtu jde
 * z `DANERO_SUPPORT_IBAN`. Předrenderovaný ceník by sekci o příspěvku nikdy
 * neukázal — a `/soukromi` by mlčelo o tom, co se s údaji přispěvatele děje.
 */
describe('dobrovolný příspěvek se renderuje při požadavku', () => {
  const withSupport = pageFiles(APP_DIR)
    .map((file) => ({ file, source: readFileSync(file, 'utf8') }))
    .filter(({ source }) => source.includes('supportFromEnv('));

  it('příspěvek vypisuje ceník a soukromí', () => {
    const relative = withSupport.map(({ file }) => file.slice(APP_DIR.length + 1)).sort();
    expect(relative).toEqual([join('cenik', 'page.tsx'), join('soukromi', 'page.tsx')]);
  });

  it.each(withSupport.map(({ file }) => file))(
    'stránka s příspěvkem se renderuje při požadavku: %s',
    (file) => {
      const source = readFileSync(file, 'utf8');
      expect(rendersAtRequestTime(source)).toBe(true);
      // hodnota se musí číst uvnitř komponenty — na úrovni modulu by se
      // vyhodnotila jednou při načtení a render při požadavku by nepomohl
      expect(source).not.toMatch(/^(export )?const \w+ = supportFromEnv\(/m);
    },
  );
});

/**
 * K1-02: hlídací e-maily byly jediné místo, kde se XML slibovalo natvrdo —
 * lednové shrnutí i obě upomínky ho nabízely i za rok, který EPO neumí.
 */
describe('XML pro EPO se slibuje jen za roky, za které existuje (K1-02)', () => {
  it('kalendářní upozornění slibují XML jen za podporované roky', async () => {
    const { calendarCandidates } = await import('@/lib/notifications');
    const { EPO_SUPPORTED_YEARS } = await import('@/lib/epo');
    const supported = Math.max(...EPO_SUPPORTED_YEARS);
    const unsupported = supported + 1;

    const textsForYear = (taxYear: number): string =>
      [`${taxYear + 1}-01-05`, `${taxYear + 1}-04-10`]
        .flatMap((today) =>
          calendarCandidates({
            today,
            hadActivityLastYear: true,
            selfEmployed: false,
            deadlineLeadDays: 30,
          }),
        )
        .map((candidate) => `${candidate.title} ${candidate.body}`)
        .join(' ');

    expect(textsForYear(supported)).toContain('XML');
    expect(textsForYear(unsupported)).not.toContain('XML');
  });

  it('ceník vypisuje podporované roky z jediného zdroje', () => {
    const source = readFileSync(join(APP_DIR, 'cenik', 'page.tsx'), 'utf8');
    expect(source).toContain('yearList(EPO_SUPPORTED_YEARS)');
  });
});

/**
 * H-3-20: `?rok=` mimo rozsah se tiše nahradil běžným rokem, ale v adresním
 * řádku zůstal — stránka ukazovala 2025 a URL tvrdila `?rok=1999`. Uložený
 * nebo přeposlaný odkaz pak dával jiná čísla, než na kterých vznikl.
 */
describe('neplatný ?rok= srovná URL, nespadne tiše (H-3-20)', () => {
  it('všech šest stránek s výběrem roku používá společný pomocník', () => {
    const pages = [
      ['(app)', 'report'],
      ['(app)', 'prehled'],
      ['(app)', 'portfolio'],
      ['demo', 'report'],
      ['demo', 'prehled'],
      ['demo', 'portfolio'],
    ] as const;
    for (const [group, path] of pages) {
      const source = readFileSync(join(APP_DIR, group, path, 'page.tsx'), 'utf8');
      expect(source, `${group}/${path} nepoužívá resolveTaxYear`).toContain('resolveTaxYear(');
      // starý tichý fallback se nesmí vrátit
      expect(source).not.toMatch(/years\.includes\(Number\(rok\)\) \? Number\(rok\) : currentYear/);
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
