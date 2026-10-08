import { describe, expect, it } from 'vitest';
import { LAST_VERIFIED_RATE_YEAR, TAX_YEAR_CONFIGS } from '@danero/engine';
import { EPO_SUPPORTED_YEARS } from '@/lib/epo';
import {
  configForYear,
  isConfiguredTaxYear,
  isRateVerified,
  LAST_CONFIGURED_TAX_YEAR,
  UNIFIED_RATES,
} from '@/lib/tax-config';

/**
 * Pojistka na roční údržbu kurzů (runbook v docs/02, R-06a).
 *
 * Čte skutečný dnešek schválně — stejně jako `packages/engine/test/runbook.test.ts`.
 * Bez kurzu pro daný rok vyhodí engine `EngineError` a uživatel s cizí měnou
 * uvidí místo čísel kartu „Výpočet teď nejde dokončit“ na přehledu, v portfoliu,
 * v reportu i v simulátoru. Runbook říká „každý leden doplnit“ — jenže rok
 * začíná 1. ledna, takže bez téhle pojistky se chyba ohlásí až rozbitou aplikací.
 *
 * Kadence: běžný rok vždy; od 1. listopadu i rok následující (nález M-7 auditu).
 */
describe('runbook: tabulka jednotných kurzů nesmí vyexpirovat', () => {
  const now = new Date();
  const year = now.getUTCFullYear();
  const required = now.getUTCMonth() >= 10 ? year + 1 : year;

  it(`orientační kurzy existují pro rok ${required}`, () => {
    expect(
      Object.keys(UNIFIED_RATES[required] ?? {}).length,
      `Chybí jednotné kurzy pro rok ${required}. Doplň orientační odhad do ` +
        'apps/web/lib/tax-config.ts (UNIFIED_RATES). Bez něj skončí výpočet ' +
        'uživatelů s cizí měnou chybou FX_RATE_MISSING.',
    ).toBeGreaterThan(0);
  });

  it('každý rok v tabulce nese aspoň USD a EUR', () => {
    for (const [rok, kurzy] of Object.entries(UNIFIED_RATES)) {
      expect(Object.keys(kurzy), `rok ${rok} nemá USD`).toContain('USD');
      expect(Object.keys(kurzy), `rok ${rok} nemá EUR`).toContain('EUR');
    }
  });

  it('ověřené roky jsou označené jako ověřené, orientační ne', () => {
    // UI podle toho kreslí varování „kurz je jen orientační“ — kdyby se
    // LAST_VERIFIED_RATE_YEAR posunul dřív než skutečné kurzy z pokynu GFŘ,
    // aplikace by odhad vydávala za ověřené číslo
    expect(isRateVerified(LAST_VERIFIED_RATE_YEAR)).toBe(true);
    expect(isRateVerified(LAST_VERIFIED_RATE_YEAR + 1)).toBe(false);
    expect(
      UNIFIED_RATES[LAST_VERIFIED_RATE_YEAR],
      `rok ${LAST_VERIFIED_RATE_YEAR} je označen za ověřený, ale kurzy pro něj chybí`,
    ).toBeDefined();
  });
});

/**
 * Pojistka na roční údržbu konfigurací zdaňovacích období (R-15d).
 *
 * Registr `TAX_YEAR_CONFIGS` nese dvě čísla, která stát vyhlašuje každý rok
 * znovu: hranici 23% sazby (36násobek průměrné mzdy) a výši paušální zálohy.
 * Rok mimo registr aplikace nepočítá loňskými čísly — poctivě řekne „nevím“
 * (K1-01) — jenže ta poctivost stojí uživatele přesnost odhadu, takže se do ní
 * nesmí spadnout omylem.
 *
 * Kadence je odvozená ze zákona: přepočítací koeficient a všeobecný vyměřovací
 * základ stanoví nařízení vlády **do 30. 9.** (§ 17 odst. 2 a 4 zák.
 * č. 155/1995 Sb.), takže od 1. října jsou čísla pro příští rok k dispozici —
 * a test je od té chvíle vyžaduje, tedy tři měsíce před tím, než by chybějící
 * rok mohl potkat uživatele.
 */
describe('runbook: registr konfigurací zdaňovacích období nesmí vyexpirovat', () => {
  const now = new Date();
  const year = now.getUTCFullYear();
  // říjen a dál: nařízení vlády pro příští rok už muselo vyjít
  const required = now.getUTCMonth() >= 9 ? year + 1 : year;

  it(`registr pokrývá rok ${required}`, () => {
    expect(
      isConfiguredTaxYear(required),
      `Rok ${required} není v TAX_YEAR_CONFIGS (poslední je ${LAST_CONFIGURED_TAX_YEAR}). ` +
        'Doplň konfiguraci do packages/engine/src/config/taxYear.ts: hranici 23 % ' +
        '(36× průměrná mzda z nařízení vlády) a výši paušální zálohy 1. pásma ' +
        '(Informace FS k institutu paušální daně) — runbook R-15d v docs/02. ' +
        'Bez toho aplikace u toho roku poctivě říká „nevím“ a odhad daně vychází ' +
        'jen nižší sazbou.',
    ).toBe(true);
  });

  it('rok za registrem nesmí nést recyklovaná čísla loňska', () => {
    // kdyby se konfigurace odvodila recyklací, spočítala by se daň loňskou
    // hranicí a započetly by se loňské zálohy — obojí mlčky (K1-01)
    const config = configForYear(LAST_CONFIGURED_TAX_YEAR + 1);
    expect(config.progressiveThreshold).toBeNull();
    expect(config.flatTaxAdvance ?? null).toBeNull();
  });

  it('každý rok v registru nese obě vyhlašovaná čísla', () => {
    for (const [rok, config] of Object.entries(TAX_YEAR_CONFIGS)) {
      expect(config.progressiveThreshold, `rok ${rok} nemá hranici 23 %`).not.toBeNull();
      expect(config.flatTaxAdvance ?? null, `rok ${rok} nemá paušální zálohu`).not.toBeNull();
      expect(Number(rok), `konfigurace roku ${rok} nese jiný rok`).toBe(config.year);
    }
  });
});

/**
 * Pojistka na XML pro nový rok (docs/02, Roční údržba, krok „XML pro EPO“; L5-03).
 *
 * Web slibuje, že v březnu uživatel stáhne podklady včetně XML, a karta exportu
 * u roku bez struktury říká „export tu bude, jakmile vyjde“. Do revize 5 ten
 * slib nekryl žádný krok runbooku ani test: `EPO_SUPPORTED_YEARS` se mohl
 * přestat rozšiřovat a nic by se neozvalo.
 *
 * Kadence: finanční správa strukturu písemnosti zveřejňuje začátkem roku, lhůta
 * pro přiznání běží do začátku dubna. Od 1. února proto test chce XML za loňský
 * rok. Termín vydání struktury ale zákon nestanoví — když do té doby nevyjde
 * (nebo se změnila tak, že ji generátor ještě neumí), zapíše se důvod do
 * `EPO_YEAR_DEFERRED` a test projde. Mlčky zapomenout tedy nejde, vědomě
 * odložit ano.
 */
describe('runbook: XML pro EPO za loňský rok', () => {
  /** Rok, za který XML vědomě ještě nevydáváme → proč (s datem zápisu). */
  const EPO_YEAR_DEFERRED: Record<number, string> = {};

  /** Zdaňovací období, za které má XML k danému dni existovat. */
  const epoYearDue = (now: Date): number =>
    now.getUTCFullYear() - (now.getUTCMonth() >= 1 ? 1 : 2);

  const due = epoYearDue(new Date());

  it('termín: do 31. 1. stačí předloňský rok, od 1. 2. loňský', () => {
    expect(epoYearDue(new Date('2027-01-31T12:00:00Z'))).toBe(2025);
    expect(epoYearDue(new Date('2027-02-01T12:00:00Z'))).toBe(2026);
    expect(epoYearDue(new Date('2027-12-31T12:00:00Z'))).toBe(2026);
  });

  it(`XML existuje za rok ${due}, nebo je zapsaný důvod, proč ještě ne`, () => {
    const reason = (EPO_YEAR_DEFERRED[due] ?? '').trim();
    expect(
      EPO_SUPPORTED_YEARS.includes(due) || reason.length > 0,
      `Rok ${due} není v EPO_SUPPORTED_YEARS (apps/web/lib/epo.ts) a od 1. 2. ${due + 1} už ` +
        'ho uživatelé potřebují k podání. Postup je v docs/02, Roční údržba, krok „XML pro ' +
        'EPO“: zkontroluj zveřejněnou strukturu písemnosti, přidej rok do seznamu a pošli ' +
        'vzorky na zkušební podatelnu (pnpm validate:epo). Když struktura ještě nevyšla, ' +
        'zapiš důvod do EPO_YEAR_DEFERRED v tomhle testu.',
    ).toBe(true);
  });

  it('odklad nezůstává zapsaný u roku, který už XML má', () => {
    for (const year of Object.keys(EPO_YEAR_DEFERRED).map(Number)) {
      expect(EPO_SUPPORTED_YEARS, `rok ${year} už XML má — smaž jeho odklad`).not.toContain(year);
    }
  });
});

/**
 * L3-04: runbook byl na dvou místech a každé říkalo něco jiného — docs/08 mělo
 * jen leden a kurzy posílalo do souboru, kde už neleží, docs/02 nevědělo o XML.
 * Seznam kroků je proto JEDEN (docs/02) a docs/08 na něj jen odkazuje.
 */
describe('runbook: jeden seznam kroků přelomu roku', () => {
  // konstanty, které se s přelomem roku ručně posouvají
  const STEPS = [
    'TAX_YEAR_CONFIGS',
    'UNIFIED_RATES',
    'LAST_VERIFIED_RATE_YEAR',
    'UNIFIED_RATE_SOURCES',
    'HOLIDAY_CALENDAR_LAST_YEAR',
    'EPO_SUPPORTED_YEARS',
  ];

  const section = async (file: string, heading: string): Promise<string> => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const text = readFileSync(join(import.meta.dirname, '..', '..', '..', 'docs', file), 'utf8');
    const start = text.indexOf(`\n## ${heading}`);
    expect(start, `${file} nemá oddíl „${heading}“`).toBeGreaterThan(-1);
    const end = text.indexOf('\n## ', start + 1);
    return text.slice(start, end === -1 ? undefined : end);
  };

  it('docs/02 jmenuje každou konstantu, kterou je potřeba posunout, i zkušební podatelnu', async () => {
    const runbook = await section('02-danova-pravidla.md', 'Roční údržba');
    for (const step of STEPS) expect(runbook, `v runbooku chybí ${step}`).toContain(step);
    expect(runbook).toContain('validate:epo');
  });

  it('docs/08 na docs/02 jen odkazuje a vlastní seznam nevede', async () => {
    const pointer = await section('08-provoz.md', 'Roční runbook');
    expect(pointer).toContain('docs/02');
    for (const step of [...STEPS, 'tax-config.ts', 'taxYear.ts']) {
      expect(pointer, `docs/08 opakuje krok „${step}“ — patří jen do docs/02`).not.toContain(step);
    }
  });
});

/**
 * F-3-6, M-3-03: záloha bez ověřené obnovy je půlka věty.
 *
 * Runbook do 9. 8. 2026 doporučoval `pg_restore --clean` bez dalších přepínačů.
 * Na produkčním dumpu to dá 105 chyb a **přesto exit 0** (vlastnictví
 * `neondb_owner` v cizím clusteru neexistuje), takže by v nich skutečná chyba
 * zanikla — a bez `--if-exists` zůstanou v cíli objekty, které v záloze nejsou.
 * Test hlídá, že skript i runbook drží ověřenou sadu přepínačů.
 */
describe('runbook: obnova ze zálohy', () => {
  const OVERENE = ['--clean', '--if-exists', '--no-owner', '--no-privileges', '--exit-on-error'];

  it('scripts/db.sh umí restore a používá ověřené přepínače', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const skript = readFileSync(
      join(import.meta.dirname, '..', '..', '..', 'scripts', 'db.sh'),
      'utf8',
    );
    expect(skript).toContain('restore)');
    for (const prepinac of OVERENE) expect(skript).toContain(prepinac);
    // obnova přepisuje databázi — nesmí jít spustit bez potvrzení
    expect(skript).toContain('OBNOVIT');
  });

  it('docs/08 nedoporučuje obnovu bez těch přepínačů', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const runbook = readFileSync(
      join(import.meta.dirname, '..', '..', '..', 'docs', '08-provoz.md'),
      'utf8',
    );
    expect(runbook).toContain('scripts/db.sh restore');
    for (const prepinac of OVERENE) expect(runbook).toContain(prepinac);
  });
});
