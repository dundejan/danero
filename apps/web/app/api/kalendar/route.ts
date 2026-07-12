/**
 * Daňový kalendář investora (docs/12) — ICS feed k odebrání nebo jednorázovému
 * importu. Celodenní události s ročním opakováním; přesná data úředních termínů
 * se při víkendu posouvají na další pracovní den (říká to popis události).
 * Statický obsah → dlouhá cache.
 */

interface Udalost {
  /** MM-DD prvního výskytu (rok 2027 — první celá sezóna Danera). */
  den: string;
  nazev: string;
  popis: string;
}

const UDALOSTI: Udalost[] = [
  {
    den: '12-31',
    nazev: 'Poslední den pro letošní daňové tahy',
    popis:
      'Dnes končí zdaňovací období: poslední šance dočerpat limit 100 000 Kč osvobozených prodejů, prodat ztrátu proti zisku nebo počkat s prodejem na časový test. Zkontroluj stav na danero.cz.',
  },
  {
    den: '01-10',
    nazev: 'Paušální režim: oznámení změn',
    popis:
      'OSVČ: do 10. ledna se oznamuje vstup do paušálního režimu nebo jeho změna. Pokud jsi loni prolomil limit 50 000 Kč jiných příjmů, řeš to teď. Připadne-li termín na víkend, platí nejbližší pracovní den.',
  },
  {
    den: '04-01',
    nazev: 'Daňové přiznání — papírové podání',
    popis:
      'Základní lhůta pro podání přiznání za loňský rok v papírové podobě. Připadne-li na víkend či svátek, posouvá se na nejbližší pracovní den. Podklady připraví danero.cz.',
  },
  {
    den: '05-02',
    nazev: 'Daňové přiznání — elektronické podání',
    popis:
      'Lhůta pro elektronické podání přiznání za loňský rok (většina investorů). Připadne-li na víkend či svátek, posouvá se na nejbližší pracovní den — v roce 2027 na 3. 5. XML pro podatelnu připraví danero.cz.',
  },
  {
    den: '07-01',
    nazev: 'Daňové přiznání — s poradcem',
    popis:
      'Prodloužená lhůta pro podání s daňovým poradcem. Připadne-li na víkend či svátek, posouvá se na nejbližší pracovní den.',
  },
];

function icsEscape(text: string): string {
  return text.replaceAll('\\', '\\\\').replaceAll(';', '\\;').replaceAll(',', '\\,');
}

/** Řádky přes 75 oktetů ICS vyžaduje lámat (folding) — pokračování mezerou. */
function fold(line: string): string {
  const parts: string[] = [];
  let rest = line;
  while (rest.length > 73) {
    parts.push(rest.slice(0, 73));
    rest = ' ' + rest.slice(73);
  }
  parts.push(rest);
  return parts.join('\r\n');
}

function buildCalendar(): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Danero//danovy-kalendar-investora//CS',
    'X-WR-CALNAME:Daňový kalendář investora (Danero)',
    'X-WR-TIMEZONE:Europe/Prague',
  ];
  for (const udalost of UDALOSTI) {
    // první výskyt: prosinec 2026 (konec roku), jinak sezóna 2027
    const rok = udalost.den === '12-31' ? '2026' : '2027';
    const datum = `${rok}${udalost.den.replace('-', '')}`;
    lines.push(
      'BEGIN:VEVENT',
      `UID:danero-kalendar-${udalost.den}@danero.cz`,
      `DTSTAMP:${rok}0101T000000Z`,
      `DTSTART;VALUE=DATE:${datum}`,
      'RRULE:FREQ=YEARLY',
      fold(`SUMMARY:${icsEscape(udalost.nazev)}`),
      fold(`DESCRIPTION:${icsEscape(udalost.popis)}`),
      'TRANSP:TRANSPARENT',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

export function GET(): Response {
  return new Response(buildCalendar(), {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'attachment; filename="danovy-kalendar-investora.ics"',
      'Cache-Control': 'public, max-age=86400',
    },
  });
}
