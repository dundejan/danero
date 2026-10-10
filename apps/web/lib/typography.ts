/**
 * Česká sazba pro texty skládané z řetězců — jediný pomocník pro celý web
 * (titulky, perexy, popisky, texty vysvětlivek).
 *
 * Jednopísmenná předložka nebo spojka nesmí zůstat viset na konci řádku
 * („v / březnu“), číslo se nesmí odtrhnout od jednotky („100 / %“,
 * „50 000 / Kč“), paragraf od svého čísla („§ / 72“) a „e-mail“ se nesmí
 * zlomit ve spojovníku. U velkého titulku, kde má řádek tři slova, je každá
 * taková chyba vidět na první pohled.
 *
 * Čistá funkce nad řetězcem — vkládá jen nezlomitelné mezery (U+00A0)
 * a nezlomitelný spojovník (U+2011), znění textu nemění. Do dat ani do textů,
 * které se s něčím porovnávají (klíče, hodnoty polí), nepatří.
 */
const NBSP = ' ';
const NB_HYPHEN = '‑';

export function tidy(text: string): string {
  return (
    text
      // k, s, v, z, o, u, a, i (i velká na začátku věty) + mezera. Lookbehind,
      // ne zachycená mezera: „a u českých“ jsou dvě předložky za sebou a druhá
      // by jinak o svou úvodní mezeru přišla už při první shodě.
      .replace(new RegExp(`(?<=^|[\\s${NBSP}(„])([ksvzouaiKSVZOUAI]) (?=\\S)`, 'g'), `$1${NBSP}`)
      // skupiny číslic v částce („100 000“)
      .replace(/(\d) (?=\d{3}(?!\d))/g, `$1${NBSP}`)
      // číslo a jednotka
      .replace(/(\d) (?=(%|Kč|ks|let|dní|mil\.|tis\.))/g, `$1${NBSP}`)
      // značka paragrafu a zkratky před číslem („§ 72“, „odst. 6“, „č. 3“)
      .replace(/(§|odst\.|písm\.|č\.) (?=\S)/g, `$1${NBSP}`)
      .replace(/\b([eE])-mail/g, `$1${NB_HYPHEN}mail`)
  );
}

/**
 * Totéž jako komponenta — pro odstavec psaný přímo v JSX:
 * `<p><Tidy>Text s předložkou v řádku.</Tidy></p>`.
 */
export function Tidy({ children }: { children: string }): string {
  return tidy(children);
}

/**
 * Titulek upozornění bez obrázkového znaku („CRM: osvobozeno 🎉“).
 * Znak do titulku dává `lib/notifications` kvůli předmětu e-mailu, kde má své
 * místo; v seznamu na stránce by to byl jediný obrázek mezi řádky textu.
 * Čistě zobrazovací úprava — uložená upozornění ani e-maily se nemění.
 */
export function plainTitle(title: string): string {
  return title
    .replace(/\p{Extended_Pictographic}️?/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Text bez odkazů na paragrafy v závorce („… paušální dani (§ 7a)“ →
 * „… paušální dani“). Jen pro TITULKY řádků: číslo paragrafu do hlavního
 * textu nepatří (docs/07, textová dieta), plné znění s odkazem zůstává
 * v rozbalovacím detailu. Zdroj textu (engine, `lib/`) se nemění.
 */
export function withoutLawRefs(text: string): string {
  return text.replace(/\s*\((?:§|čl\.)[^)]*\)/g, '');
}
