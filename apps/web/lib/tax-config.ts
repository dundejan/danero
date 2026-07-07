import { TAX_YEAR_2025, TAX_YEAR_2026_DRAFT, type TaxYearConfig } from '@danero/engine';

/**
 * ⚠️ ORIENTAČNÍ jednotné kurzy (pokyny řady D vydává GFŘ vždy v lednu za předchozí
 * rok). Rok 2025 je přesný dle pokynu GFŘ D-75; ostatní roky jsou placeholdery pro
 * celoroční hlídání — před generováním podkladů k přiznání doplnit přesné hodnoty
 * (docs/02, runbook). Rok 2026 vyjde v lednu 2027.
 */
export const UNIFIED_RATES: Record<number, Record<string, string>> = {
  2020: { USD: '23.14', EUR: '26.50', GBP: '29.80', PLN: '5.90', AUD: '16.00', CAD: '17.30' },
  2021: { USD: '21.72', EUR: '25.65', GBP: '29.90', PLN: '5.60', AUD: '16.30', CAD: '17.30' },
  2022: { USD: '23.41', EUR: '24.54', GBP: '28.90', PLN: '5.25', AUD: '16.20', CAD: '18.00' },
  2023: { USD: '22.14', EUR: '23.97', GBP: '27.60', PLN: '5.30', AUD: '14.70', CAD: '16.40' },
  2024: { USD: '23.30', EUR: '25.15', GBP: '29.20', PLN: '5.85', AUD: '15.40', CAD: '17.00' },
  2025: { ...TAX_YEAR_2025.unifiedRatesByYear[2025], GBP: '28.40', PLN: '5.80', AUD: '14.30', CAD: '15.80' },
  2026: { USD: '20.80', EUR: '24.40', GBP: '28.00', PLN: '5.75', AUD: '13.80', CAD: '15.20' },
};

/** Konfigurace zdaňovacího období pro engine (limity dle roku, kurzy viz výše). */
export function configForYear(year: number): TaxYearConfig {
  const base = year >= 2026 ? TAX_YEAR_2026_DRAFT : TAX_YEAR_2025;
  return { ...base, year, unifiedRatesByYear: UNIFIED_RATES };
}
