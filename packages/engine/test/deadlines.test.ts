import { describe, expect, it } from 'vitest';
import { isWeekend } from '@danero/shared';
import {
  filingDeadlines,
  HOLIDAY_CALENDAR_FIRST_YEAR,
  HOLIDAY_CALENDAR_LAST_YEAR,
  isExchangeHoliday,
} from '../src';

/** R-09e — lhůty pro podání přiznání (§ 136 + § 33 odst. 4 daňového řádu). */
describe('R-09e lhůty pro podání přiznání', () => {
  it('za ZO 2025 vychází elektronická lhůta na pondělí 4. 5. 2026, ne na 2. 5.', () => {
    // 1. 5. 2026 je pátek A státní svátek → 2. 5. sobota → 3. 5. neděle → 4. 5.
    // (2. 5. bylo správně za ZO 2024; natvrdo zapsané datum zestárlo)
    expect(filingDeadlines(2025)).toEqual({
      paper: '2026-04-01',
      electronic: '2026-05-04',
      advisor: '2026-07-01',
    });
  });

  it('za ZO 2024 vychází elektronická lhůta na pátek 2. 5. 2025', () => {
    // kontrola opačným směrem: pravidlo musí dát i historicky správnou hodnotu
    expect(filingDeadlines(2024)).toEqual({
      paper: '2025-04-01',
      electronic: '2025-05-02',
      advisor: '2025-07-01',
    });
  });

  it('papírová lhůta se posouvá, když 1. 4. připadne na Velikonoční pondělí', () => {
    // 1. 4. 2024 byl Velikonoční pondělí → papírové podání až 2. 4. 2024
    expect(filingDeadlines(2023).paper).toBe('2024-04-02');
  });

  it('žádná lhůta nikdy nepadne na víkend ani na český svátek', () => {
    // vlastnostní kontrola přes všechny roky, které kalendář pokrývá — přesně
    // ta třída chyby, kterou natvrdo zapsané datum propustí
    for (
      let taxYear = HOLIDAY_CALENDAR_FIRST_YEAR;
      taxYear + 1 <= HOLIDAY_CALENDAR_LAST_YEAR;
      taxYear += 1
    ) {
      const dates = filingDeadlines(taxYear);
      for (const [nazev, date] of Object.entries(dates)) {
        expect(isWeekend(date), `${nazev} za ZO ${taxYear} padlo na víkend (${date})`).toBe(false);
        expect(
          isExchangeHoliday('CZ', date),
          `${nazev} za ZO ${taxYear} padlo na svátek (${date})`,
        ).toBe(false);
      }
    }
  });

  it('lhůty jdou po sobě: papírově < elektronicky < s poradcem', () => {
    for (
      let taxYear = HOLIDAY_CALENDAR_FIRST_YEAR;
      taxYear + 1 <= HOLIDAY_CALENDAR_LAST_YEAR;
      taxYear += 1
    ) {
      const { paper, electronic, advisor } = filingDeadlines(taxYear);
      expect(paper < electronic, `ZO ${taxYear}: ${paper} < ${electronic}`).toBe(true);
      expect(electronic < advisor, `ZO ${taxYear}: ${electronic} < ${advisor}`).toBe(true);
    }
  });
});
