import { d } from '@danero/shared';
import { czk } from '@/lib/format';
import { configForYear } from '@/lib/tax-config';

/**
 * Limity § 38g pro povinnost podat přiznání v daném roce, už jako text pro
 * popisky („40 000 Kč“).
 *
 * Částky se rok od roku liší — R-09a a R-09b: do ZO 2026 50 000 / 20 000 Kč,
 * od ZO 2027 100 000 / 40 000 Kč (zák. č. 180/2026 Sb.) — takže je texty
 * nesmí mít natvrdo (nález L3-01 revize 5). Limit 50 000 Kč paušální daně
 * (§ 7a) se nemění, proto tu není.
 *
 * Samostatný modul kvůli kalkulačce: je to klientská komponenta a konfiguraci
 * roku si sama načíst nemá — s ní by si do prohlížeče přibalila celý engine.
 * Texty jí proto připraví server a pošle je jako obyčejná data.
 */
export interface FilingLimitTexts {
  year: number;
  /** R-09b: vedlejší příjmy zaměstnance (§ 38g odst. 2). */
  employee: string;
  /** R-09a: obecný limit (§ 38g odst. 1). */
  general: string;
}

export function filingLimitTexts(year: number): FilingLimitTexts {
  const { limits } = configForYear(year);
  return {
    year,
    employee: czk(d(limits.employeeSideIncome)),
    general: czk(d(limits.generalFiling)),
  };
}
