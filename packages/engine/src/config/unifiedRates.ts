/**
 * OVĚŘENÉ jednotné kurzy (§ 38 odst. 1 ZDP) z pokynů GFŘ řady D — CZK za
 * 1 jednotku měny. Extrahováno z oficiálních PDF finanční správy (8. 7. 2026),
 * kompletní kurzovní lístky viz zdroje níže; tabulka docs/podklady/jednotne-kurzy-gfr.md.
 *
 * Zdroje (financnisprava.gov.cz):
 * - 2020: pokyn GFŘ-D-49 (č.j. 27/21/7100-10111-010440)
 * - 2021: pokyn GFŘ-D-54 (č.j. 209/22/7100-10111-010440, FZ 1/2022)
 * - 2022: pokyn GFŘ-D-60 (č.j. 174/23/7100-10111-010440, FZ 1/2023)
 * - 2023: pokyn GFŘ-D-63 (č.j. 77/24/7100-10111-010440, FZ 1/2024)
 * - 2024: pokyn GFŘ-D-66 (č.j. 8091/25/7100-10111-010440 — ruší chybný D-65)
 * - 2025: pokyn GFŘ-D-75 (č.j. 95534/25/7100-10111-802540, 19. 1. 2026)
 *
 * POZOR: pokyny kotují JPY za 100 jednotek — zde normalizováno na 1 JPY
 * (hodnota z pokynu / 100), aby fx převod fungoval jednotně.
 */
export const UNIFIED_RATES_VERIFIED: Record<number, Record<string, string>> = {
  2020: {
    USD: '23.14', EUR: '26.50', GBP: '29.80', PLN: '5.93', CHF: '24.74',
    AUD: '16.00', CAD: '17.23', JPY: '0.2176', NOK: '2.46', SEK: '2.53', DKK: '3.55',
  },
  2021: {
    USD: '21.72', EUR: '25.65', GBP: '29.88', PLN: '5.61', CHF: '23.76',
    AUD: '16.26', CAD: '17.33', JPY: '0.1969', NOK: '2.52', SEK: '2.53', DKK: '3.45',
  },
  2022: {
    USD: '23.41', EUR: '24.54', GBP: '28.72', PLN: '5.24', CHF: '24.51',
    AUD: '16.21', CAD: '17.93', JPY: '0.1779', NOK: '2.43', SEK: '2.30', DKK: '3.30',
  },
  2023: {
    USD: '22.14', EUR: '23.97', GBP: '27.59', PLN: '5.31', CHF: '24.69',
    AUD: '14.67', CAD: '16.40', JPY: '0.1567', NOK: '2.09', SEK: '2.09', DKK: '3.22',
  },
  2024: {
    USD: '23.28', EUR: '25.16', GBP: '29.78', PLN: '5.85', CHF: '26.40',
    AUD: '15.31', CAD: '16.96', JPY: '0.1535', NOK: '2.16', SEK: '2.20', DKK: '3.37',
  },
  2025: {
    USD: '21.84', EUR: '24.66', GBP: '28.80', PLN: '5.82', CHF: '26.33',
    AUD: '14.06', CAD: '15.61', JPY: '0.1459', NOK: '2.11', SEK: '2.23', DKK: '3.30',
  },
};

/** Poslední rok, za který existuje vydaný pokyn GFŘ (ověřený kurz). */
export const LAST_VERIFIED_RATE_YEAR = 2025;
