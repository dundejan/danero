import { describe, expect, it } from 'vitest';
import { HOLIDAY_CALENDAR_LAST_YEAR, isExchangeHoliday } from '../src';

/**
 * Pojistka na roční údržbu (runbook v docs/02).
 *
 * Tenhle test schválně čte **skutečný dnešek**. Není to nedeterminismus omylem:
 * kalendáře svátků jsou tabulka s koncem platnosti a mimo pokryté roky se
 * přeskakují jen víkendy — tiše a bez varování. Konstanty
 * `HOLIDAY_CALENDAR_FIRST_YEAR`/`LAST_YEAR` do téhle chvíle nikdo nečetl
 * (nález A1-03 auditu), takže expiraci nehlídalo vůbec nic.
 *
 * Kadence: pokrytý musí být běžný rok **i rok následující** (lhůty pro podání
 * za běžné ZO padnou do roku +1, R-09e). Od 1. listopadu navíc rok přespříští —
 * tím se údržba připomene s předstihem, místo aby se ozvala až 1. ledna
 * rozbitým dopočtem vypořádání.
 */
describe('runbook: kalendář burzovních svátků nesmí vyexpirovat', () => {
  const now = new Date();
  const year = now.getUTCFullYear();
  // od listopadu chceme mít nachystaný i rok přespříští
  const required = now.getUTCMonth() >= 10 ? year + 2 : year + 1;

  it(`kalendáře pokrývají rok ${required}`, () => {
    expect(
      HOLIDAY_CALENDAR_LAST_YEAR,
      `Kalendáře svátků končí rokem ${HOLIDAY_CALENDAR_LAST_YEAR}, potřebujeme ${required}. ` +
        'Doplň svátky do packages/engine/src/config/exchangeHolidays.ts a posuň ' +
        'HOLIDAY_CALENDAR_LAST_YEAR (runbook R-01a v docs/02). Bez toho se mimo ' +
        'pokryté roky přeskakují jen víkendy a časový test se otevře dřív, než smí.',
    ).toBeGreaterThanOrEqual(required);
  });

  it('pokrytý rok má u každé burzy aspoň Nový rok jako svátek', () => {
    // levná kontrola, že se nový rok opravdu doplnil do VŠECH tabulek, ne jen
    // do té, na kterou se zrovna sáhlo
    for (const calendar of ['US', 'CA', 'DE', 'UK', 'IE', 'CZ', 'TARGET2'] as const) {
      const novyRok = `${HOLIDAY_CALENDAR_LAST_YEAR}-01-01`;
      const den = new Date(`${novyRok}T00:00:00Z`).getUTCDay();
      if (den === 0 || den === 6) continue; // o víkendu se do tabulek nepíše
      expect(
        isExchangeHoliday(calendar, novyRok),
        `${calendar} nemá 1. 1. ${HOLIDAY_CALENDAR_LAST_YEAR} mezi svátky`,
      ).toBe(true);
    }
  });
});
