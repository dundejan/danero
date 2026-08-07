import { describe, expect, it } from 'vitest';
import { LAST_VERIFIED_RATE_YEAR } from '@danero/engine';
import { isRateVerified, UNIFIED_RATES } from '@/lib/tax-config';

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
