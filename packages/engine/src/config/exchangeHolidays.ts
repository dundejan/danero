import type { IsoDate } from '@danero/shared';

/**
 * Burzovní svátky pro dopočet data vypořádání (R-01a). Lhůta T+1/T+2 běží
 * v OBCHODNÍCH dnech burzy — bez svátků vycházelo vypořádání až o 4–5 dní dřív
 * (velikonoční týden, Vánoce) a časový test se otevíral dřív, než smí.
 *
 * Zdroje (stejný režim jako `unifiedRates.ts` — data z veřejných kalendářů burz):
 * - US (NYSE/Nasdaq): NYSE Group Holiday and Early Closings Calendar (tiskové
 *   zprávy ICE 2018–2025, nyse.com/markets/hours-calendars). Mimo pravidelné
 *   svátky obsahuje i mimořádné uzavření **9. 1. 2025** (státní smutek za
 *   J. Cartera). Juneteenth je svátkem od roku 2022.
 * - DE (Xetra/FWB): Deutsche Börse Trading Calendar
 *   (cashmarket.deutsche-boerse.com) — 1. 1., Velký pátek, Velikonoční pondělí,
 *   1. 5., 24., 25., 26. a 31. 12. Xetra naopak **obchoduje** na Nanebevstoupení,
 *   Pfingstmontag, Boží tělo i Den německé jednoty.
 * - UK (LSE): londonstockexchange.com business days + bank holidays GOV.UK
 *   (Anglie a Wales), včetně mimořádných dnů: 8. 5. 2020 (VE Day), 2.–3. 6. 2022
 *   (platinové jubileum), 19. 9. 2022 (státní pohřeb Alžběty II.), 8. 5. 2023
 *   (korunovace Karla III.). Rok 2027 zatím jen z vyhlášených bank holidays.
 * - IE (Euronext Dublin): Euronext Holiday Calendar for Cash and Derivatives
 *   markets (roční notice; 2026 ověřeno v IF251107CADE). Dublin = kalendář
 *   Euronextu + irský May Bank Holiday (1. pondělí v květnu) + irské náhradní
 *   dny za Vánoce/sv. Štěpána o víkendu. Na ostatní irské bank holidays
 *   (sv. Brigita, červen, srpen, říjen) Euronext Dublin obchoduje.
 * - CZ (BCPP): burza neobchoduje o státních svátcích ČR (zák. č. 245/2000 Sb.);
 *   kalendář vyhlašuje burzovní komora ve Věstníku burzy vždy do konce roku.
 * - TARGET2: společný vypořádací kalendář eurozóny (ECB) — 1. 1., Velký pátek,
 *   Velikonoční pondělí, 1. 5., 25. a 26. 12. Default pro ISIN bez vlastního
 *   kalendáře (konzervativní: méně obchodních dnů = pozdější nabytí).
 *
 * Poctivě k aproximacím (docs/02 R-01a): kanadské ISIN jedou na kalendáři US
 * (vlastní kalendář TSX zatím nemáme) a vypořádací systémy (T2S) bývají otevřené
 * i v den, kdy burza neobchoduje. Obojí posouvá dopočet spíš později = pozdější
 * osvobození = bezpečný směr. Datum z výpisu brokera má vždy přednost.
 */
export type ExchangeCalendar = 'US' | 'DE' | 'UK' | 'IE' | 'CZ' | 'TARGET2';

/** První pokrytý rok — starší nákupy mají časový test dávno splněný. */
export const HOLIDAY_CALENDAR_FIRST_YEAR = 2019;
/** Poslední pokrytý rok. Runbook: každý leden doplnit nový rok (docs/02, R-01a). */
export const HOLIDAY_CALENDAR_LAST_YEAR = 2027;

/** NYSE/Nasdaq — plná uzavření (zkrácené obchodní dny vypořádání neovlivňují). */
const US_HOLIDAYS: readonly IsoDate[] = [
  // 2019
  '2019-01-01', '2019-01-21', '2019-02-18', '2019-04-19', '2019-05-27',
  '2019-07-04', '2019-09-02', '2019-11-28', '2019-12-25',
  // 2020 (4. 7. připadlo na sobotu → volno v pátek 3. 7.)
  '2020-01-01', '2020-01-20', '2020-02-17', '2020-04-10', '2020-05-25',
  '2020-07-03', '2020-09-07', '2020-11-26', '2020-12-25',
  // 2021 (Vánoce v sobotu → volno v pátek 24. 12.)
  '2021-01-01', '2021-01-18', '2021-02-15', '2021-04-02', '2021-05-31',
  '2021-07-05', '2021-09-06', '2021-11-25', '2021-12-24',
  // 2022 (1. 1. v sobotu se neposouvá; Juneteenth poprvé, 19. 6. v neděli → 20. 6.)
  '2022-01-17', '2022-02-21', '2022-04-15', '2022-05-30', '2022-06-20',
  '2022-07-04', '2022-09-05', '2022-11-24', '2022-12-26',
  // 2023
  '2023-01-02', '2023-01-16', '2023-02-20', '2023-04-07', '2023-05-29',
  '2023-06-19', '2023-07-04', '2023-09-04', '2023-11-23', '2023-12-25',
  // 2024
  '2024-01-01', '2024-01-15', '2024-02-19', '2024-03-29', '2024-05-27',
  '2024-06-19', '2024-07-04', '2024-09-02', '2024-11-28', '2024-12-25',
  // 2025 (9. 1. mimořádně — státní smutek za J. Cartera)
  '2025-01-01', '2025-01-09', '2025-01-20', '2025-02-17', '2025-04-18',
  '2025-05-26', '2025-06-19', '2025-07-04', '2025-09-01', '2025-11-27',
  '2025-12-25',
  // 2026 (4. 7. v sobotu → volno v pátek 3. 7.)
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25',
  '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
  // 2027 (Juneteenth v sobotu → 18. 6.; 4. 7. v neděli → 5. 7.; Vánoce v sobotu → 24. 12.)
  '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31',
  '2027-06-18', '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24',
];

/** Xetra / Frankfurtská burza — pevná sada, jen se posouvají Velikonoce. */
const DE_HOLIDAYS: readonly IsoDate[] = [
  // 2019
  '2019-01-01', '2019-04-19', '2019-04-22', '2019-05-01',
  '2019-12-24', '2019-12-25', '2019-12-26', '2019-12-31',
  // 2020 (26. 12. v sobotu)
  '2020-01-01', '2020-04-10', '2020-04-13', '2020-05-01',
  '2020-12-24', '2020-12-25', '2020-12-31',
  // 2021 (1. 5., 25. a 26. 12. o víkendu)
  '2021-01-01', '2021-04-02', '2021-04-05', '2021-12-24', '2021-12-31',
  // 2022 (1. 1., 1. 5., 24., 25. a 31. 12. o víkendu)
  '2022-04-15', '2022-04-18', '2022-12-26',
  // 2023 (1. 1., 24. a 31. 12. o víkendu)
  '2023-04-07', '2023-04-10', '2023-05-01', '2023-12-25', '2023-12-26',
  // 2024
  '2024-01-01', '2024-03-29', '2024-04-01', '2024-05-01',
  '2024-12-24', '2024-12-25', '2024-12-26', '2024-12-31',
  // 2025
  '2025-01-01', '2025-04-18', '2025-04-21', '2025-05-01',
  '2025-12-24', '2025-12-25', '2025-12-26', '2025-12-31',
  // 2026 (26. 12. v sobotu)
  '2026-01-01', '2026-04-03', '2026-04-06', '2026-05-01',
  '2026-12-24', '2026-12-25', '2026-12-31',
  // 2027 (1. 5., 25. a 26. 12. o víkendu)
  '2027-01-01', '2027-03-26', '2027-03-29', '2027-12-24', '2027-12-31',
];

/** LSE — bank holidays Anglie a Walesu (vč. náhradních pondělí) + mimořádné dny. */
const UK_HOLIDAYS: readonly IsoDate[] = [
  // 2019
  '2019-01-01', '2019-04-19', '2019-04-22', '2019-05-06', '2019-05-27',
  '2019-08-26', '2019-12-25', '2019-12-26',
  // 2020 (květnové volno přesunuto na 8. 5. — VE Day; 26. 12. v sobotu → 28. 12.)
  '2020-01-01', '2020-04-10', '2020-04-13', '2020-05-08', '2020-05-25',
  '2020-08-31', '2020-12-25', '2020-12-28',
  // 2021 (25. a 26. 12. o víkendu → 27. a 28. 12.)
  '2021-01-01', '2021-04-02', '2021-04-05', '2021-05-03', '2021-05-31',
  '2021-08-30', '2021-12-27', '2021-12-28',
  // 2022 (1. 1. v sobotu → 3. 1.; jubileum 2.–3. 6.; 19. 9. státní pohřeb)
  '2022-01-03', '2022-04-15', '2022-04-18', '2022-05-02', '2022-06-02',
  '2022-06-03', '2022-08-29', '2022-09-19', '2022-12-26', '2022-12-27',
  // 2023 (1. 1. v neděli → 2. 1.; 8. 5. korunovace Karla III.)
  '2023-01-02', '2023-04-07', '2023-04-10', '2023-05-01', '2023-05-08',
  '2023-05-29', '2023-08-28', '2023-12-25', '2023-12-26',
  // 2024
  '2024-01-01', '2024-03-29', '2024-04-01', '2024-05-06', '2024-05-27',
  '2024-08-26', '2024-12-25', '2024-12-26',
  // 2025
  '2025-01-01', '2025-04-18', '2025-04-21', '2025-05-05', '2025-05-26',
  '2025-08-25', '2025-12-25', '2025-12-26',
  // 2026 (26. 12. v sobotu → 28. 12.)
  '2026-01-01', '2026-04-03', '2026-04-06', '2026-05-04', '2026-05-25',
  '2026-08-31', '2026-12-25', '2026-12-28',
  // 2027 (25. a 26. 12. o víkendu → 27. a 28. 12.)
  '2027-01-01', '2027-03-26', '2027-03-29', '2027-05-03', '2027-05-31',
  '2027-08-30', '2027-12-27', '2027-12-28',
];

/** Euronext Dublin — kalendář Euronextu + irský May Bank Holiday a náhradní dny. */
const IE_HOLIDAYS: readonly IsoDate[] = [
  // 2019
  '2019-01-01', '2019-04-19', '2019-04-22', '2019-05-01', '2019-05-06',
  '2019-12-25', '2019-12-26',
  // 2020 (sv. Štěpán v sobotu → náhradní pondělí 28. 12.)
  '2020-01-01', '2020-04-10', '2020-04-13', '2020-05-01', '2020-05-04',
  '2020-12-25', '2020-12-28',
  // 2021 (1. 5. v sobotu; Vánoce o víkendu → 27. a 28. 12.)
  '2021-01-01', '2021-04-02', '2021-04-05', '2021-05-03',
  '2021-12-27', '2021-12-28',
  // 2022 (1. 1. v sobotu → 3. 1.; 1. 5. v neděli; 25. 12. v neděli → 27. 12.)
  '2022-01-03', '2022-04-15', '2022-04-18', '2022-05-02',
  '2022-12-26', '2022-12-27',
  // 2023 (1. 1. v neděli → 2. 1.; 1. 5. je zároveň May Bank Holiday)
  '2023-01-02', '2023-04-07', '2023-04-10', '2023-05-01',
  '2023-12-25', '2023-12-26',
  // 2024
  '2024-01-01', '2024-03-29', '2024-04-01', '2024-05-01', '2024-05-06',
  '2024-12-25', '2024-12-26',
  // 2025
  '2025-01-01', '2025-04-18', '2025-04-21', '2025-05-01', '2025-05-05',
  '2025-12-25', '2025-12-26',
  // 2026 (ověřeno notice Euronextu IF251107CADE: 28. 12. náhrada za sv. Štěpána)
  '2026-01-01', '2026-04-03', '2026-04-06', '2026-05-01', '2026-05-04',
  '2026-12-25', '2026-12-28',
  // 2027 (1. 5. v sobotu; Vánoce o víkendu → 27. a 28. 12.)
  '2027-01-01', '2027-03-26', '2027-03-29', '2027-05-03',
  '2027-12-27', '2027-12-28',
];

/** BCPP — státní svátky a ostatní svátky ČR (zák. č. 245/2000 Sb.). */
const CZ_HOLIDAYS: readonly IsoDate[] = [
  // 2019 (6. 7., 28. 9. a 17. 11. o víkendu)
  '2019-01-01', '2019-04-19', '2019-04-22', '2019-05-01', '2019-05-08',
  '2019-07-05', '2019-10-28', '2019-12-24', '2019-12-25', '2019-12-26',
  // 2020 (5. 7. a 26. 12. o víkendu)
  '2020-01-01', '2020-04-10', '2020-04-13', '2020-05-01', '2020-05-08',
  '2020-07-06', '2020-09-28', '2020-10-28', '2020-11-17',
  '2020-12-24', '2020-12-25',
  // 2021 (1. 5., 8. 5., 25. a 26. 12. o víkendu)
  '2021-01-01', '2021-04-02', '2021-04-05', '2021-07-05', '2021-07-06',
  '2021-09-28', '2021-10-28', '2021-11-17', '2021-12-24',
  // 2022 (1. 1., 1. 5., 8. 5., 24. a 25. 12. o víkendu)
  '2022-04-15', '2022-04-18', '2022-07-05', '2022-07-06', '2022-09-28',
  '2022-10-28', '2022-11-17', '2022-12-26',
  // 2023 (1. 1., 28. 10. a 24. 12. o víkendu)
  '2023-04-07', '2023-04-10', '2023-05-01', '2023-05-08', '2023-07-05',
  '2023-07-06', '2023-09-28', '2023-11-17', '2023-12-25', '2023-12-26',
  // 2024 (6. 7., 28. 9. a 17. 11. o víkendu)
  '2024-01-01', '2024-03-29', '2024-04-01', '2024-05-01', '2024-05-08',
  '2024-07-05', '2024-10-28', '2024-12-24', '2024-12-25', '2024-12-26',
  // 2025 (5. 7., 6. 7. a 28. 9. o víkendu)
  '2025-01-01', '2025-04-18', '2025-04-21', '2025-05-01', '2025-05-08',
  '2025-10-28', '2025-11-17', '2025-12-24', '2025-12-25', '2025-12-26',
  // 2026 (5. 7. a 26. 12. o víkendu)
  '2026-01-01', '2026-04-03', '2026-04-06', '2026-05-01', '2026-05-08',
  '2026-07-06', '2026-09-28', '2026-10-28', '2026-11-17',
  '2026-12-24', '2026-12-25',
  // 2027 (1. 5., 8. 5., 25. a 26. 12. o víkendu)
  '2027-01-01', '2027-03-26', '2027-03-29', '2027-07-05', '2027-07-06',
  '2027-09-28', '2027-10-28', '2027-11-17', '2027-12-24',
];

/** TARGET2 — vypořádací kalendář eurozóny; default pro ISIN bez vlastní burzy. */
const TARGET2_HOLIDAYS: readonly IsoDate[] = [
  // 2019
  '2019-01-01', '2019-04-19', '2019-04-22', '2019-05-01', '2019-12-25', '2019-12-26',
  // 2020 (26. 12. v sobotu)
  '2020-01-01', '2020-04-10', '2020-04-13', '2020-05-01', '2020-12-25',
  // 2021 (1. 5., 25. a 26. 12. o víkendu)
  '2021-01-01', '2021-04-02', '2021-04-05',
  // 2022 (1. 1., 1. 5. a 25. 12. o víkendu)
  '2022-04-15', '2022-04-18', '2022-12-26',
  // 2023 (1. 1. v neděli — TARGET2 náhradní dny nemá)
  '2023-04-07', '2023-04-10', '2023-05-01', '2023-12-25', '2023-12-26',
  // 2024
  '2024-01-01', '2024-03-29', '2024-04-01', '2024-05-01', '2024-12-25', '2024-12-26',
  // 2025
  '2025-01-01', '2025-04-18', '2025-04-21', '2025-05-01', '2025-12-25', '2025-12-26',
  // 2026 (26. 12. v sobotu)
  '2026-01-01', '2026-04-03', '2026-04-06', '2026-05-01', '2026-12-25',
  // 2027 (1. 5., 25. a 26. 12. o víkendu)
  '2027-01-01', '2027-03-26', '2027-03-29',
];

const CALENDARS: Record<ExchangeCalendar, ReadonlySet<IsoDate>> = {
  US: new Set(US_HOLIDAYS),
  DE: new Set(DE_HOLIDAYS),
  UK: new Set(UK_HOLIDAYS),
  IE: new Set(IE_HOLIDAYS),
  CZ: new Set(CZ_HOLIDAYS),
  TARGET2: new Set(TARGET2_HOLIDAYS),
};

/** Prefix ISIN (kód země emitenta) → kalendář burzy, kde se nástroj typicky obchoduje. */
const CALENDAR_BY_ISIN_PREFIX: Record<string, ExchangeCalendar> = {
  US: 'US',
  CA: 'US', // aproximace: kalendář TSX zatím nemáme (docs/02 R-01a)
  DE: 'DE',
  GB: 'UK',
  IE: 'IE',
  CZ: 'CZ',
};

/** R-01a: výběr kalendáře podle prefixu ISIN; ostatní konzervativně TARGET2. */
export const calendarForIsin = (isin: string): ExchangeCalendar =>
  CALENDAR_BY_ISIN_PREFIX[isin.slice(0, 2).toUpperCase()] ?? 'TARGET2';

/** Je den burzovním svátkem daného kalendáře? (Mimo pokryté roky vždy false.) */
export const isExchangeHoliday = (calendar: ExchangeCalendar, date: IsoDate): boolean =>
  CALENDARS[calendar].has(date);
