import { Children, cloneElement, isValidElement } from 'react';
import { tidy } from '@/lib/typography';

/**
 * Česká sazba pro text psaný v JSX — články, odpovědi, návody, právní texty.
 *
 * `tidy()` z `lib/typography.ts` bere řetězec, jenže dlouhé texty veřejných
 * stránek jsou odstavce s odkazy a tučnými místy uvnitř, ne řetězce. Volat
 * `tidy()` u každého kousku ručně by nikdo nedělal (a neudělal: recenze
 * našla 51 chyb zalomení na 1440 px a 91 na telefonu). `typeset()` proto
 * projde strom Reactu a sazbu pustí na každý textový list; volají ho obaly
 * (`Prose`, `ArticleSection`, `FaqList`, `SpecRow`, `Split`), ne stránky.
 *
 * Znění textu se nemění: vkládá se jen nezlomitelná mezera (U+00A0) a
 * nezlomitelný spojovník v „e-mail“ (U+2011, dělá ho `tidy()`). U právních
 * textů to hlídá `test/typeset.test.ts` — po převodu zpět na obyčejné mezery
 * a spojovníky musí vyjít původní text znak po znaku.
 */

const NBSP = '\u00a0';

/**
 * Jednotky a počítaná slova, která se nesmí odtrhnout od čísla a `tidy()` je
 * (zatím) nezná. Až je `tidy()` převezme, tenhle seznam zmizí.
 */
const UNITS =
  'roky|rok|roku|letech|měsíce|měsíců|měsíc|dnech|dnů|dny|dnem|hodin|hodiny|minutu|minut|milionů|milionu|miliony|mil\\.|tis\\.|Sb\\.';

const MONTHS =
  'ledna|února|března|dubna|května|června|července|srpna|září|října|listopadu|prosince';

/**
 * Sazba jednoho řetězce: `tidy()` a k němu případy, které recenze našla
 * v dlouhých textech a `tidy()` je neumí —
 *
 * - datum se nelomí uvnitř („15. 2. / 2025“, „1. 1. až 14. 2.“),
 * - řádek nezačíná pomlčkou („z Prahy / — a Danero“),
 * - číslo drží s dalšími jednotkami („3 / roky“, „72 / hodin“, „40 mil. / Kč“),
 * - zkratka drží s tím, co uvádí („čl. / 10“, „str. / 45“, „tzv. / elektronické“).
 */
export function typesetText(text: string): string {
  return (
    tidy(text)
      // den a měsíc číslem, případně i rok: „15. 2.“, „15. 2. 2025“
      .replace(/(?<!\d)(\d{1,2}\.) (?=\d{1,2}\.)/g, `$1${NBSP}`)
      .replace(new RegExp(`(?<!\\d)(\\d{1,2}\\.[ ${NBSP}]\\d{1,2}\\.) (?=\\d{4}(?!\\d))`, 'g'), `$1${NBSP}`)
      // den a měsíc slovem: „10. ledna“
      .replace(new RegExp(`(?<!\\d)(\\d{1,2}\\.) (?=(?:${MONTHS})(?![\\p{L}]))`, 'gu'), `$1${NBSP}`)
      // pomlčka zůstává na konci řádku u slova, za kterým stojí
      .replace(/ ([—–])(?= |$)/g, `${NBSP}$1`)
      .replace(new RegExp(`(\\d) (?=(?:${UNITS})(?![\\p{L}]))`, 'gu'), `$1${NBSP}`)
      .replace(/(mil\.|tis\.) (?=Kč)/g, `$1${NBSP}`)
      .replace(/(?<![\p{L}])(čl\.|str\.|ř\.|tzv\.|např\.) (?=\S)/gu, `$1${NBSP}`)
  );
}

/** Jednopísmenná předložka nebo spojka na konci řetězce — za ní pokračuje prvek (odkaz, tučné). */
const TRAILING_PREPOSITION = new RegExp(`(?:^|[\\s${NBSP}(„])[ksvzouaiKSVZOUAI] $`);

/**
 * Prvky, do kterých sazba nesahá: jejich text je údaj, ne věta. Kontakt
 * (`mailto:`, `tel:`) se má dát zkopírovat přesně tak, jak je zapsaný —
 * adresa se slovem „e-mail“ by jinak dostala nezlomitelný spojovník.
 */
function isVerbatim(element: React.ReactElement<{ href?: unknown }>): boolean {
  if (typeof element.type === 'string' && /^(code|pre|kbd|samp|script|style)$/.test(element.type)) {
    return true;
  }
  const { href } = element.props;
  return typeof href === 'string' && /^(mailto:|tel:)/.test(href);
}

/**
 * Strom Reactu s českou sazbou na textových listech. Sousední texty a čísla
 * (`{count} platforem`, `IČO {ico}`) se nejdřív spojí — prohlížeč je stejně
 * vykreslí jako jednu větu a pravidlo „číslo + jednotka“ musí vidět obojí.
 */
export function typeset(node: React.ReactNode): React.ReactNode {
  if (typeof node === 'string') return typesetText(node);
  if (typeof node === 'number' || node === null || node === undefined || typeof node === 'boolean') {
    return node;
  }
  if (isValidElement<{ children?: React.ReactNode; href?: unknown }>(node)) {
    const { children } = node.props;
    if (isVerbatim(node) || children === undefined || typeof children === 'function') return node;
    return cloneElement(node, undefined, typeset(children));
  }
  if (!Array.isArray(node)) return node;

  const items = Children.toArray(node);
  const result: React.ReactNode[] = [];
  let text = '';
  const flush = (beforeElement: boolean) => {
    if (text === '') return;
    let set = typesetText(text);
    // „v <a>podmínkách</a>“: mezera za předložkou patří k prvku, který následuje
    if (beforeElement && TRAILING_PREPOSITION.test(set)) set = `${set.slice(0, -1)}${NBSP}`;
    result.push(set);
    text = '';
  };
  for (const item of items) {
    if (typeof item === 'string' || typeof item === 'number') {
      text += String(item);
    } else {
      flush(true);
      result.push(typeset(item));
    }
  }
  flush(false);
  return result.length === 1 ? result[0] : result;
}
