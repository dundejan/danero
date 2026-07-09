import {
  LAST_VERIFIED_RATE_YEAR,
  TAX_YEAR_2024,
  TAX_YEAR_2025,
  TAX_YEAR_2026_DRAFT,
  UNIFIED_RATES_VERIFIED,
  type TaxYearConfig,
} from '@danero/engine';

/**
 * Jednotné kurzy: roky ≤ LAST_VERIFIED_RATE_YEAR jsou OVĚŘENÉ z pokynů GFŘ
 * řady D (packages/engine/src/config/unifiedRates.ts — s citacemi zdrojů).
 * Běžný rok je ⚠️ ORIENTAČNÍ odhad pro celoroční hlídání — pokyn za něj GFŘ
 * vydá až v lednu následujícího roku (runbook: doplnit kurzy do enginu,
 * posunout LAST_VERIFIED_RATE_YEAR a přidat pokyn do UNIFIED_RATE_SOURCES —
 * jinak karta „Použité kurzy" nemá u roku zdroj). UI musí orientační kurz
 * viditelně označit.
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
  // 2024 a starší: bez stropu 40M (platí až pro 2025), krypto bez osvobození
  // (cryptoRules.exemptionsAvailable: false — R-10b) a s hranicí 23 % roku 2024;
  // pro roky < 2024 hranici neznáme → null (engine poctivě varuje).
  // 2025: strop 40M společný pro CP + krypto, krypto osvobození od 15. 2. 2025;
  // 2026+: strop jen pro krypto (R-10e) — vše nese TaxYearConfig daného roku.
  const base =
    year >= 2026 ? TAX_YEAR_2026_DRAFT : year === 2025 ? TAX_YEAR_2025 : TAX_YEAR_2024;
  const progressiveThreshold = year < 2024 ? null : base.progressiveThreshold;
  return { ...base, year, progressiveThreshold, unifiedRatesByYear: UNIFIED_RATES };
}
