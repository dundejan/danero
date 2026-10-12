/**
 * Česká sazba pro texty skládané z řetězců — jediný pomocník pro celý web
 * (titulky, perexy, popisky, texty vysvětlivek, dlouhé texty veřejných stránek).
 *
 * Jednopísmenná předložka nebo spojka nesmí zůstat viset na konci řádku
 * („v / březnu“), číslo se nesmí odtrhnout od jednotky („100 / %“,
 * „50 000 / Kč“, „3 / roky“), paragraf ani zkratka od toho, co uvádí
 * („§ / 72“, „čl. / 10“), datum se nesmí rozlomit uvnitř („15. 2. / 2025“)
 * a řádek nesmí začínat pomlčkou.
 * U velkého titulku, kde má řádek tři slova, je každá taková chyba vidět na
 * první pohled; v dlouhých textech jich recenze redesignu našla desítky.
 *
 * Čistá funkce nad řetězcem — vkládá JEN nezlomitelné mezery (U+00A0), žádný
 * jiný znak nemění ani nepřidává (hlídá `test/typeset.test.ts`). Pevnou mezeru
 * bere hledání v prohlížeči jako obyčejnou a čtečka taky; do hodnot polí
 * formuláře, klíčů ani textů, které se s něčím porovnávají, ale nepatří.
 *
 * Do 11. 10. 2026 měnila i spojovník v „e-mail“ za nezlomitelný (U+2011).
 * Je to jiný znak: Ctrl+F „e-mail“ takový výskyt nenašlo a zkopírovaný text
 * nesl spojovník, který hledání v poště ani tabulce nepozná. Zalomení
 * „e- / mail“ hlídá styl, ne znak: `typeset()` slovo obalí
 * `white-space: nowrap`. Řetězec z `tidy()` obal nést nemůže — text, kde by
 * zalomení vadilo, proto pošli přes `typeset()`.
 *
 * Text psaný v JSX (odstavec s odkazy a tučnými místy) prochází
 * `typeset()` z `components/typeset.tsx`, který tuhle funkci pustí na každý
 * textový list. Pravidla jsou jen tady — jedno místo pravdy.
 */
const NBSP = '\u00a0';

/**
 * Jednotky a počítaná slova, která se nesmí odtrhnout od čísla. Za slovem
 * nesmí pokračovat písmeno („5 letadel“ jednotka není).
 */
const UNITS =
  'Kč|ks|let|letech|roky|rok|roku|měsíce|měsíců|měsíc|dní|dnech|dnů|dny|dnem|hodin|hodiny|minutu|minut|milionů|milionu|miliony|mil\\.|tis\\.|Sb\\.';

const MONTHS =
  'ledna|února|března|dubna|května|června|července|srpna|září|října|listopadu|prosince';

export function tidy(text: string): string {
  return (
    text
      // k, s, v, z, o, u, a, i (i velká na začátku věty) + mezera. Lookbehind,
      // ne zachycená mezera: „a u českých“ jsou dvě předložky za sebou a druhá
      // by jinak o svou úvodní mezeru přišla už při první shodě.
      .replace(new RegExp(`(?<=^|[\\s${NBSP}(„])([ksvzouaiKSVZOUAI]) (?=\\S)`, 'g'), `$1${NBSP}`)
      // skupiny číslic v částce („100 000“)
      .replace(/(\d) (?=\d{3}(?!\d))/g, `$1${NBSP}`)
      // číslo a jednotka („100 %“, „50 000 Kč“, „3 roky“, „72 hodin“, „40 mil. Kč“)
      .replace(/(\d) (?=%)/g, `$1${NBSP}`)
      .replace(new RegExp(`(\\d) (?=(?:${UNITS})(?![\\p{L}]))`, 'gu'), `$1${NBSP}`)
      .replace(/(mil\.|tis\.) (?=Kč)/g, `$1${NBSP}`)
      // značka paragrafu a zkratky před tím, co uvádějí („§ 72“, „odst. 6“,
      // „č. 3“, „čl. 10“, „ř. 86“, „tzv. elektronické“)
      .replace(/(§|odst\.|písm\.|č\.) (?=\S)/g, `$1${NBSP}`)
      .replace(/(?<![\p{L}])(čl\.|str\.|ř\.|tzv\.|např\.) (?=\S)/gu, `$1${NBSP}`)
      // den a měsíc číslem, případně i rok: „15. 2.“, „15. 2. 2025“
      .replace(/(?<!\d)(\d{1,2}\.) (?=\d{1,2}\.)/g, `$1${NBSP}`)
      .replace(
        new RegExp(`(?<!\\d)(\\d{1,2}\\.[ ${NBSP}]\\d{1,2}\\.) (?=\\d{4}(?!\\d))`, 'g'),
        `$1${NBSP}`,
      )
      // den a měsíc slovem: „10. ledna“
      .replace(new RegExp(`(?<!\\d)(\\d{1,2}\\.) (?=(?:${MONTHS})(?![\\p{L}]))`, 'gu'), `$1${NBSP}`)
      // pomlčka zůstává na konci řádku u slova, za kterým stojí
      .replace(/ ([—–])(?= |$)/g, `${NBSP}$1`)
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
    // Slévají se jen obyčejné mezery a konce řádků. `\s` bere i pevnou mezeru,
    // kterou do částky píše `czk()` — titulek se pak lámal uprostřed čísla.
    .replace(/[ \t\r\n]+/g, ' ')
    .replace(/^ | $/g, '');
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
