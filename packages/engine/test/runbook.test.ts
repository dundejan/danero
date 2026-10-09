import { describe, expect, it } from 'vitest';
import { HOLIDAY_CALENDAR_LAST_YEAR, isExchangeHoliday } from '../src';

const CALENDARS = ['US', 'CA', 'DE', 'UK', 'IE', 'CZ', 'TARGET2'] as const;

/**
 * Nejmenší počet svátků VE VŠEDNÍ DEN, jaký může kalendář za rok mít — práh
 * pojistky níž. Není to odhad, ale dno nejchudšího ze sedmi kalendářů
 * (TARGET2: 1. 1., Velký pátek, Velikonoční pondělí, 1. 5., 25. a 26. 12.):
 * Velký pátek a Velikonoční pondělí na víkend nepadnou nikdy a z pevných dat
 * vyjde na všední den vždy aspoň jedno — když je 25. i 26. 12. o víkendu, je
 * 1. 1. téhož roku čtvrtek nebo pátek. Přesně tři mají TARGET2 v letech 2021,
 * 2022 a 2027 a Xetra v roce 2022; zbylých pět kalendářů má v každém pokrytém
 * roce aspoň šest.
 *
 * Práh je schválně společný a nízký: nesmí spadnout nad správně doplněným
 * rokem. Chytí tabulku, na kterou se zapomnělo, i tabulku s jedním dvěma
 * řádky; tabulku doplněnou z poloviny nepozná — tu musí zachytit porovnání
 * s vyhlášeným kalendářem burzy při údržbě.
 */
const MIN_WEEKDAY_HOLIDAYS = 3;

const NEW_YEAR = `${HOLIDAY_CALENDAR_LAST_YEAR}-01-01`;

const isWeekend = (day: Date): boolean => day.getUTCDay() === 0 || day.getUTCDay() === 6;

/** Počet svátků kalendáře ve všední den — průchodem celého roku den po dni. */
const weekdayHolidays = (calendar: (typeof CALENDARS)[number], year: number): number => {
  let found = 0;
  const day = new Date(Date.UTC(year, 0, 1));
  while (day.getUTCFullYear() === year) {
    if (!isWeekend(day) && isExchangeHoliday(calendar, day.toISOString().slice(0, 10))) found += 1;
    day.setUTCDate(day.getUTCDate() + 1);
  }
  return found;
};

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

  it(`poslední pokrytý rok má u každé burzy aspoň ${MIN_WEEKDAY_HOLIDAYS} svátky ve všední den`, () => {
    // kontrola, že se nový rok opravdu doplnil do VŠECH tabulek, ne jen do té,
    // na kterou se zrovna sáhlo — a že se doplnil celý, ne jedním řádkem
    // (nález L13-04). Počítá se průchodem roku, ne jedním pevným datem: Nový rok
    // 2028 je sobota a 25. 12. 2027 taky, takže kontrola „1. 1. je svátek" by
    // u takového roku neověřila nic.
    for (const calendar of CALENDARS) {
      const found = weekdayHolidays(calendar, HOLIDAY_CALENDAR_LAST_YEAR);
      expect(
        found,
        `${calendar}: počet svátků ve všední den v roce ${HOLIDAY_CALENDAR_LAST_YEAR} je ${found}, ` +
          `nejméně jich má být ${MIN_WEEKDAY_HOLIDAYS}. Tabulka v ` +
          'packages/engine/src/config/exchangeHolidays.ts nový rok nemá, nebo ho má jen zčásti — ' +
          'doplň ho celý podle kalendáře burzy (runbook R-01a v docs/02).',
      ).toBeGreaterThanOrEqual(MIN_WEEKDAY_HOLIDAYS);
    }
  });

  // Nový rok o víkendu se do tabulek nepíše, takže tahle kontrola pak nemá co
  // ověřit — ať je v takovém roce vidět jako přeskočená, ne jako zelená
  it.skipIf(isWeekend(new Date(`${NEW_YEAR}T00:00:00Z`)))(
    'Nový rok posledního pokrytého roku je svátkem každé burzy',
    () => {
      for (const calendar of CALENDARS) {
        expect(
          isExchangeHoliday(calendar, NEW_YEAR),
          `${calendar} nemá 1. 1. ${HOLIDAY_CALENDAR_LAST_YEAR} mezi svátky`,
        ).toBe(true);
      }
    },
  );
});

/**
 * Rok 2028 (nález L3-03): doplněný s předstihem, protože pojistka výš ho od
 * 1. 11. 2026 vyžaduje. Data jsou dopočtená pravidly z komentářů
 * `exchangeHolidays.ts`; test drží ta místa, kde pravidlo dává jiný den než
 * prosté datum svátku.
 */
describe('R-01a kalendáře burzovních svátků pro rok 2028', () => {
  const holiday = (calendar: (typeof CALENDARS)[number], date: string): boolean =>
    isExchangeHoliday(calendar, date);

  it('kalendáře rok 2028 pokrývají', () => {
    expect(HOLIDAY_CALENDAR_LAST_YEAR).toBeGreaterThanOrEqual(2028);
  });

  it('Velký pátek 14. 4. 2028 je svátkem všech sedmi kalendářů', () => {
    for (const calendar of CALENDARS) {
      expect(holiday(calendar, '2028-04-14'), `${calendar} nemá Velký pátek 2028`).toBe(true);
    }
  });

  it('Velikonoční pondělí 17. 4. 2028 se obchoduje jen v USA a v Kanadě', () => {
    for (const calendar of CALENDARS) {
      const trades = calendar === 'US' || calendar === 'CA';
      expect(holiday(calendar, '2028-04-17'), `${calendar} 17. 4. 2028`).toBe(!trades);
    }
  });

  it('Nový rok v sobotu: náhradní pondělí 3. 1. mají jen Londýn, Dublin a Toronto', () => {
    // NYSE sobotní Nový rok neposouvá (stejně jako 2022), Xetra, BCPP ani
    // TARGET2 náhradní dny neznají
    for (const calendar of CALENDARS) {
      const substitute = calendar === 'UK' || calendar === 'IE' || calendar === 'CA';
      expect(holiday(calendar, '2028-01-03'), `${calendar} 3. 1. 2028`).toBe(substitute);
    }
  });

  it('pohyblivé a náhradní dny vycházejí podle pravidel burz', () => {
    const expected: Array<[(typeof CALENDARS)[number], string]> = [
      ['US', '2028-01-17'], // M. L. King — 3. pondělí v lednu
      ['US', '2028-02-21'], // Washington — 3. pondělí v únoru
      ['US', '2028-05-29'], // Memorial Day — poslední pondělí v květnu
      ['US', '2028-06-19'], // Juneteenth (pondělí)
      ['US', '2028-07-04'],
      ['US', '2028-09-04'], // Labor Day — 1. pondělí v září
      ['US', '2028-11-23'], // Díkůvzdání — 4. čtvrtek v listopadu
      ['UK', '2028-05-01'], // Early May — 1. pondělí v květnu
      ['UK', '2028-05-29'], // Spring — poslední pondělí v květnu
      ['UK', '2028-08-28'], // Summer — poslední pondělí v srpnu
      ['IE', '2028-05-01'], // 1. 5. je zároveň irský May Bank Holiday
      ['CA', '2028-02-21'], // Family Day — 3. pondělí v únoru
      ['CA', '2028-05-22'], // Victoria Day — pondělí před 25. 5.
      ['CA', '2028-07-03'], // Canada Day v sobotu → pondělí
      ['CA', '2028-08-07'], // Civic Holiday — 1. pondělí v srpnu
      ['CA', '2028-10-09'], // Thanksgiving — 2. pondělí v říjnu
      ['CZ', '2028-05-01'],
      ['CZ', '2028-05-08'],
      ['CZ', '2028-07-05'],
      ['CZ', '2028-07-06'],
      ['CZ', '2028-09-28'],
      ['CZ', '2028-11-17'],
      ['DE', '2028-05-01'],
      ['TARGET2', '2028-05-01'],
    ];
    for (const [calendar, date] of expected) {
      expect(holiday(calendar, date), `${calendar} ${date}`).toBe(true);
    }
    // Vánoce 2028 jsou pondělí a úterý — oba dny všude kromě USA (tam jen 25. 12.)
    for (const calendar of CALENDARS) {
      expect(holiday(calendar, '2028-12-25'), `${calendar} 25. 12. 2028`).toBe(true);
      expect(holiday(calendar, '2028-12-26'), `${calendar} 26. 12. 2028`).toBe(calendar !== 'US');
    }
  });

  it('svátek o víkendu se do tabulky nepíše', () => {
    // 1. 1. (sobota), 28. 10. (sobota), 24. a 31. 12. (neděle)
    for (const calendar of CALENDARS) {
      for (const date of ['2028-01-01', '2028-10-28', '2028-12-24', '2028-12-31']) {
        expect(holiday(calendar, date), `${calendar} ${date} je víkend`).toBe(false);
      }
    }
  });
});
