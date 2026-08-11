/**
 * Pravidla hlídače, která si uživatel nastavuje sám (docs/05 F4, H3): kdy před
 * osvobozením se ozvat, při jakém čerpání limitu a jak často shrnovat.
 *
 * Výchozí hodnoty opisují chování, které hlídač měl, dokud se nedaly měnit —
 * web slibuje e-mail „při 60, 85 a 100 %“ a „30 a 7 dní předem“, takže defaulty
 * jsou zároveň marketingový slib.
 *
 * Jediná výjimka je `deadlineLeadDays`: natvrdo tam stálo 17 dní, což bylo číslo
 * bez důvodu a na doplnění podkladů k přiznání pozdě. Výchozích 30 dní je
 * úmyslná změna k lepšímu, uživatel si je může zkrátit.
 *
 * Seznamy se v databázi drží jako text („30,7“), ne jako `integer[]`: pole je
 * jediný typ, u kterého se PGlite a postgres.js chovají jinak, a celý
 * repozitář se mu zatím vyhýbá. Parsování je proto na jednom místě tady.
 */

/** Nabídka lhůt „kolik dní před osvobozením“ (sestupně, jak se ukazují v UI). */
export const TIME_TEST_LEAD_OPTIONS = [90, 60, 30, 14, 7, 1] as const;
/** Nabídka hranic čerpání limitu v procentech. */
export const LIMIT_THRESHOLD_OPTIONS = [50, 60, 75, 85, 90, 100] as const;
/** Nabídka „kolik dní před termínem přiznání“. */
export const DEADLINE_LEAD_OPTIONS = [45, 30, 14, 7] as const;

export const SUMMARY_FREQUENCIES = ['OFF', 'MONTHLY', 'QUARTERLY'] as const;
export type SummaryFrequency = (typeof SUMMARY_FREQUENCIES)[number];

export const EMAIL_FREQUENCIES = ['DAILY', 'WEEKLY'] as const;
export type EmailFrequency = (typeof EMAIL_FREQUENCIES)[number];

export interface NotificationRules {
  /** Lhůty před osvobozením, sestupně. Prázdné = neupozorňovat dopředu. */
  timeTestLeadDays: number[];
  /** Ozvat se i ve chvíli, kdy pozice časový test právě splnila. */
  timeTestDone: boolean;
  /** Hranice čerpání limitu v %, vzestupně. Prázdné = o limitech nepsat. */
  limitThresholdsPct: number[];
  /** Kolik dní před termínem přiznání připomenout. */
  deadlineLeadDays: number;
  /** Pravidelný přehled i ve chvíli, kdy se nic nestalo. */
  summaryFrequency: SummaryFrequency;
  /** Naléhavou událost poslat i mimo týdenní okno souhrnu. */
  urgentImmediately: boolean;
}

export const DEFAULT_NOTIFICATION_RULES: NotificationRules = {
  timeTestLeadDays: [30, 7],
  timeTestDone: true,
  limitThresholdsPct: [60, 85, 100],
  deadlineLeadDays: 30,
  summaryFrequency: 'OFF',
  urgentImmediately: true,
};

/**
 * Seznam čísel z uloženého textu. `null`/`undefined` (chybějící řádek nebo
 * sloupec) = výchozí hodnota; prázdný řetězec = uživatel schválně nechce nic.
 * Cokoli mimo nabídku se zahodí — do generování událostí nesmí vstoupit hodnota,
 * kterou UI neumí ani zobrazit.
 */
export function parseNumberList(
  raw: string | null | undefined,
  allowed: readonly number[],
  fallback: number[],
): number[] {
  if (raw === null || raw === undefined) return [...fallback];
  const values = raw
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((value) => allowed.includes(value));
  return [...new Set(values)].sort((a, b) => a - b);
}

export const formatNumberList = (values: number[]): string => values.join(',');

/** Jedna hodnota z nabídky, jinak výchozí (chybějící i nesmyslný vstup). */
export function pickOption<T>(raw: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(raw as T) ? (raw as T) : fallback;
}

/** Řádek preferencí (i neúplný) → pravidla pro hlídač. */
export function notificationRules(row: {
  timeTestLeadDays?: string | null;
  timeTestDone?: boolean | null;
  limitThresholdsPct?: string | null;
  deadlineLeadDays?: number | null;
  summaryFrequency?: string | null;
  urgentImmediately?: boolean | null;
}): NotificationRules {
  return {
    // lhůty sestupně: hlídač hledá nejbližší lhůtu ≥ počtu zbývajících dní
    timeTestLeadDays: parseNumberList(
      row.timeTestLeadDays,
      TIME_TEST_LEAD_OPTIONS,
      DEFAULT_NOTIFICATION_RULES.timeTestLeadDays,
    ).sort((a, b) => b - a),
    timeTestDone: row.timeTestDone ?? DEFAULT_NOTIFICATION_RULES.timeTestDone,
    limitThresholdsPct: parseNumberList(
      row.limitThresholdsPct,
      LIMIT_THRESHOLD_OPTIONS,
      DEFAULT_NOTIFICATION_RULES.limitThresholdsPct,
    ),
    deadlineLeadDays: pickOption(
      row.deadlineLeadDays,
      DEADLINE_LEAD_OPTIONS,
      DEFAULT_NOTIFICATION_RULES.deadlineLeadDays,
    ),
    summaryFrequency: pickOption(
      row.summaryFrequency,
      SUMMARY_FREQUENCIES,
      DEFAULT_NOTIFICATION_RULES.summaryFrequency,
    ),
    urgentImmediately:
      row.urgentImmediately ?? DEFAULT_NOTIFICATION_RULES.urgentImmediately,
  };
}

/**
 * Období pravidelného přehledu, do kterého spadá dnešek — zároveň část dedupe
 * klíče, takže za jedno období odejde nejvýš jeden.
 */
export function summaryPeriod(today: string, frequency: SummaryFrequency): string | null {
  if (frequency === 'OFF') return null;
  const [year, month] = [today.slice(0, 4), Number(today.slice(5, 7))];
  return frequency === 'MONTHLY'
    ? `${year}-${String(month).padStart(2, '0')}`
    : `${year}-Q${Math.floor((month - 1) / 3) + 1}`;
}
