/**
 * Česká sazba pro texty veřejných stránek: jednopísmenná předložka nebo
 * spojka nesmí zůstat viset na konci řádku („v / březnu“), číslo se nesmí
 * odtrhnout od jednotky („100 / %“, „50 000 / Kč“), paragraf od svého čísla
 * („§ / 72“) a „e-mail“ se nesmí zlomit ve spojovníku.
 *
 * Čistá funkce nad řetězcem — vkládá jen nezlomitelné mezery (U+00A0)
 * a nezlomitelný spojovník (U+2011), znění textu nemění.
 */
const NBSP = '\u00a0';
const NB_HYPHEN = '\u2011';

export function tidy(text: string): string {
  return (
    text
      // k, s, v, z, o, u, a, i (i velká na začátku věty) + mezera
      .replace(/(^|[\s(„])([ksvzouaiKSVZOUAI]) (?=\S)/g, `$1$2${NBSP}`)
      // dvě jednopísmenná slova za sebou („a v březnu“) — druhý průchod
      .replace(new RegExp(`(${NBSP})([ksvzouai]) (?=\\S)`, 'g'), `$1$2${NBSP}`)
      // číslo a jednotka nebo další skupina číslic
      .replace(/(\d) (?=(%|Kč|ks|let|dní|mil\.|\d{3}\b))/g, `$1${NBSP}`)
      // značka paragrafu a zkratky před číslem („§ 72“, „odst. 6“, „č. 3“)
      .replace(/(§|odst\.|písm\.|č\.) (?=\S)/g, `$1${NBSP}`)
      .replace(/\b([eE])-mail/g, `$1${NB_HYPHEN}mail`)
  );
}
