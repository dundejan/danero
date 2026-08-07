import { nextBusinessDay, type IsoDate } from '@danero/shared';
import { isExchangeHoliday } from '../config/exchangeHolidays';

/**
 * R-09e — lhůty pro podání přiznání (§ 136 daňového řádu).
 *
 * Lhůta běží od konce zdaňovacího období a končí dnem téhož označení
 * (§ 33 odst. 1 DŘ), takže za ZO `R` vychází základní datum vždy na 1. den
 * měsíce v roce `R+1`: 3 měsíce papírově, 4 měsíce elektronicky, 6 měsíců
 * s poradcem. Připadne-li poslední den na sobotu, neděli nebo svátek, posouvá
 * se na nejbližší pracovní den (**§ 33 odst. 4 DŘ**).
 *
 * Datum se schválně POČÍTÁ. Napsané natvrdo je chyba, která se sama neprojeví:
 * za ZO 2024 vycházel elektronický termín na 2. 5. 2025, za ZO 2025 už na
 * 4. 5. 2026 (1. 5. je pátek a svátek, 2. a 3. 5. víkend).
 *
 * Svátky bere z kalendáře BCPP (`CZ`), který je seznamem státních a ostatních
 * svátků ČR dle zák. č. 245/2000 Sb. Mimo pokryté roky
 * (`HOLIDAY_CALENDAR_FIRST_YEAR`…`HOLIDAY_CALENDAR_LAST_YEAR`) se přeskakují
 * jen víkendy — runbook R-01a proto doplňuje kalendář každý leden.
 */
export interface FilingDeadlines {
  /** Písemné (papírové) podání — 3 měsíce, § 136 odst. 1. */
  paper: IsoDate;
  /** Elektronické podání — 4 měsíce, § 136 odst. 2 písm. a). */
  electronic: IsoDate;
  /** Podání poradcem nebo při povinném auditu — 6 měsíců, § 136 odst. 2 písm. b). */
  advisor: IsoDate;
}

const czHoliday = (date: IsoDate): boolean => isExchangeHoliday('CZ', date);

const deadline = (taxYear: number, months: number): IsoDate =>
  nextBusinessDay(
    `${taxYear + 1}-${String(months + 1).padStart(2, '0')}-01` as IsoDate,
    czHoliday,
  );

/** Lhůty pro podání přiznání za zdaňovací období `taxYear` (R-09e). */
export function filingDeadlines(taxYear: number): FilingDeadlines {
  return {
    paper: deadline(taxYear, 3),
    electronic: deadline(taxYear, 4),
    advisor: deadline(taxYear, 6),
  };
}
