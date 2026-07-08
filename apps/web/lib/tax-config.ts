import {
  LAST_VERIFIED_RATE_YEAR,
  TAX_YEAR_2025,
  TAX_YEAR_2026_DRAFT,
  UNIFIED_RATES_VERIFIED,
  type TaxYearConfig,
} from '@danero/engine';

/**
 * Jednotné kurzy: roky ≤ LAST_VERIFIED_RATE_YEAR jsou OVĚŘENÉ z pokynů GFŘ
 * řady D (packages/engine/src/config/unifiedRates.ts — s citacemi zdrojů).
 * Běžný rok je ⚠️ ORIENTAČNÍ odhad pro celoroční hlídání — pokyn za něj GFŘ
 * vydá až v lednu následujícího roku (runbook: doplnit do enginu a posunout
 * LAST_VERIFIED_RATE_YEAR). UI musí orientační kurz viditelně označit.
 */
export const UNIFIED_RATES: Record<number, Record<string, string>> = {
  ...UNIFIED_RATES_VERIFIED,
  2026: {
    USD: '20.80', EUR: '24.40', GBP: '28.00', PLN: '5.75', CHF: '26.00',
    AUD: '13.80', CAD: '15.20', JPY: '0.142', NOK: '2.05', SEK: '2.20', DKK: '3.27',
  },
};

/** Je kurz pro daný rok ověřený pokynem GFŘ, nebo jen orientační? */
export const isRateVerified = (year: number): boolean => year <= LAST_VERIFIED_RATE_YEAR;

/** Konfigurace zdaňovacího období pro engine (limity dle roku, kurzy viz výše). */
export function configForYear(year: number): TaxYearConfig {
  const base = year >= 2026 ? TAX_YEAR_2026_DRAFT : TAX_YEAR_2025;
  return { ...base, year, unifiedRatesByYear: UNIFIED_RATES };
}
