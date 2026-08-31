import { describe, expect, it } from 'vitest';
import { LAST_VERIFIED_RATE_YEAR, TAX_YEAR_CONFIGS } from '@danero/engine';
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
