import {
  isConfiguredTaxYear,
  LAST_CONFIGURED_TAX_YEAR,
  LAST_VERIFIED_RATE_YEAR,
  TAX_YEAR_2024,
  TAX_YEAR_2026_DRAFT,
  TAX_YEAR_CONFIGS,
  UNIFIED_RATE_SOURCES,
  UNIFIED_RATES_VERIFIED,
  type TaxYearConfig,
} from '@danero/engine';

/**
 * Jednotné kurzy: roky ≤ LAST_VERIFIED_RATE_YEAR jsou OVĚŘENÉ z pokynů GFŘ
 * řady D (packages/engine/src/config/unifiedRates.ts — s citacemi zdrojů).
 * Běžný rok je ⚠️ ORIENTAČNÍ odhad pro celoroční hlídání — pokyn za něj GFŘ
 * vydá až v lednu následujícího roku (runbook: doplnit kurzy do enginu,
 * posunout LAST_VERIFIED_RATE_YEAR a přidat pokyn do UNIFIED_RATE_SOURCES —
 * jinak karta „Použité kurzy“ nemá u roku zdroj). UI musí orientační kurz
 * viditelně označit.
 */
export const UNIFIED_RATES: Record<number, Record<string, string>> = {
  ...UNIFIED_RATES_VERIFIED,
  2026: {
    USD: '20.80', EUR: '24.40', GBP: '28.00', PLN: '5.75', CHF: '26.00',
    AUD: '13.80', CAD: '15.20', JPY: '0.142', NOK: '2.05', SEK: '2.20', DKK: '3.27',
  },
};

/**
 * Je kurz pro daný rok ověřený pokynem GFŘ, nebo jen orientační?
 *
 * Roky, pro které v tabulce žádný kurz není (2019 a starší), nesmí vyjít jako
 * ověřené — jinak by UI u nich tvrdilo „podle pokynu GFŘ" o hodnotě, která
 * neexistuje (nález A3-10).
 */
export const isRateVerified = (year: number): boolean =>
  year <= LAST_VERIFIED_RATE_YEAR && UNIFIED_RATES[year] !== undefined;

/**
 * První rok, pro který jednotný kurz vůbec máme. Starší roky se přepočítávají
 * denními kurzy ČNB — a report to musí říct, ne kartu s kurzy schovat (K1-04).
 */
export const FIRST_UNIFIED_RATE_YEAR = Math.min(...Object.keys(UNIFIED_RATES).map(Number));

/** Roky jednotných kurzů, které mohou do reportu za `year` vstoupit (výdaj = kurz roku nákupu). */
export const unifiedRateYearsUpTo = (year: number): number[] =>
  Object.keys(UNIFIED_RATES)
    .map(Number)
    .filter((rateYear) => rateYear <= year)
    .sort((a, b) => a - b);

/**
 * Deklarace původu kurzů pro report (K1-03): rozsah let ani čísla pokynů se
 * nesmí psát do textu ručně. Po lednové údržbě by věta zůstala pozadu a tištěný
 * podklad — dokument, který má být průkazný — by tvrdil něco jiného, než čím se
 * doopravdy počítalo.
 */
export function verifiedRateSourceNote(): string {
  const years = Object.keys(UNIFIED_RATE_SOURCES)
    .map(Number)
    .filter((year) => year <= LAST_VERIFIED_RATE_YEAR)
    .sort((a, b) => a - b);
  const first = years[0];
  const last = years.at(-1);
  if (first === undefined || last === undefined) return 'jednotné kurzy zatím z žádného pokynu GFŘ nemáme';
  if (first === last) return `pokyn ${UNIFIED_RATE_SOURCES[first]} (jednotný kurz ${first})`;
  return `pokyny ${UNIFIED_RATE_SOURCES[first]} až ${UNIFIED_RATE_SOURCES[last]} (jednotné kurzy ${first}–${last})`;
}

/**
 * Konfigurace zdaňovacího období pro engine (limity dle roku, kurzy viz výše).
 *
 * R-15a: rok z **registru** `TAX_YEAR_CONFIGS` dostane svá vyhlášená čísla.
 * Rok mimo registr dostane jen **šablonu právního stavu** (limity v zákoně
 * pevnou částkou, strop 40M, dostupnost osvobození krypta — R-15b) a obě
 * každoročně vyhlašované hodnoty poctivě `null`: hranici 23 % sazby i výši
 * paušální zálohy. Obojí má v enginu připravenou větev „nevím“, takže se
 * rozsvítí místo toho, aby se tiše počítalo loňskými čísly (nález K1-01).
 */
export function configForYear(year: number): TaxYearConfig {
  const known = TAX_YEAR_CONFIGS[year];
  if (known) return { ...known, unifiedRatesByYear: UNIFIED_RATES };
  // Šablona podle právního stavu: roky před registrem nemají strop 40M (platí
  // až od 2025) a krypto u nich nemá žádné osvobození (R-10b); roky za
  // registrem pokračují stavem posledního známého roku (strop jen pro krypto,
  // R-10e) — to jsou pravidla ze zákona, ne čísla vyhlašovaná na rok.
  const base = year > LAST_CONFIGURED_TAX_YEAR ? TAX_YEAR_2026_DRAFT : TAX_YEAR_2024;
  return {
    ...base,
    year,
    progressiveThreshold: null,
    flatTaxAdvance: null,
    unifiedRatesByYear: UNIFIED_RATES,
  };
}

/** R-15e: víme pro ten rok vyhlášená čísla? UI podle toho ukáže vysvětlení. */
export { isConfiguredTaxYear, LAST_CONFIGURED_TAX_YEAR };
