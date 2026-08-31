import type { IsoDate } from '@danero/shared';
import { logEvent } from './log';

/**
 * Jediný zdroj „dneška“ pro celou aplikaci (nález K1-07).
 *
 * Do 31. 8. 2026 si osm vstupních bodů (přehled, report, portfolio, detail
 * pozice, simulátor, XML pro EPO, cron kurzů a razítko v reportu) četlo hodiny
 * samo přes `new Date().toISOString().slice(0, 10)`. Přechod roku se tím nedal
 * otestovat vůbec — a zároveň to bylo osm kopií jednoho rozhodnutí, které se
 * dvakrát lišily (`getUTCFullYear()` vs. řez ISO řetězce).
 *
 * Dvě věci, které tenhle modul řeší:
 *
 * 1. **Zóna.** Zdaňovací období je kalendářní rok (§ 16b ZDP) a ten se láme
 *    půlnocí v Česku, ne v UTC. Z UTC data plyne, že 1. ledna mezi 00:00 a 01:00
 *    pražského času (v létě dvě hodiny) aplikace tvrdí, že je pořád loni:
 *    zrovna skončený rok se tak nezafixoval při generování podkladů (K1-05).
 * 2. **Podstrčitelnost.** `DANERO_NOW` (ISO okamžik) přepíše „teď“ — jen mimo
 *    produkci, aby se přes proměnnou prostředí nedala posunout ostrá instalace.
 *    Testy si tím posunou hodiny na 1. 1. 2027 a uvidí, co aplikace udělá.
 */
export const TAX_TIME_ZONE = 'Europe/Prague';

/** Proměnná prostředí, kterou si testy a lokální ladění podstrčí čas. */
const NOW_OVERRIDE_ENV = 'DANERO_NOW';

/**
 * „Teď“ — v produkci vždy systémový čas. Mimo produkci smí `DANERO_NOW`
 * (ISO 8601) posunout hodiny; nesmyslná hodnota se ohlásí do logu a spadne
 * zpátky na systémový čas, ať se test nedívá na `Invalid Date`.
 */
export function now(): Date {
  const override = process.env[NOW_OVERRIDE_ENV];
  if (override && process.env.NODE_ENV !== 'production') {
    const parsed = new Date(override);
    if (!Number.isNaN(parsed.getTime())) return parsed;
    logEvent('warn', 'clock.invalid_override', { value: override });
  }
  return new Date();
}

const CZ_DATE_PARTS = new Intl.DateTimeFormat('cs-CZ', {
  timeZone: TAX_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Dnešní datum v české zóně jako ISO řetězec `YYYY-MM-DD`. */
export function today(instant: Date = now()): IsoDate {
  // formátování po částech, ne `toLocaleDateString` — pořadí a oddělovače
  // locale se mezi verzemi ICU mění, čísla částí ne
  const parts = CZ_DATE_PARTS.formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** Běžné zdaňovací období — rok, ve kterém se v Česku právě je. */
export function currentTaxYear(instant: Date = now()): number {
  return Number(today(instant).slice(0, 4));
}
