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
 * Pravidla sazby jsou jen v `tidy()` — tady je jen průchod stromem.
 *
 * Znění textu se nemění: vkládá se jen nezlomitelná mezera (U+00A0) a
 * nezlomitelný spojovník v „e-mail“ (U+2011). U právních textů to hlídá
 * `test/typeset.test.ts` — po převodu zpět na obyčejné mezery a spojovníky
 * musí vyjít původní text znak po znaku.
 */

const NBSP = '\u00a0';

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
  if (typeof node === 'string') return tidy(node);
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
    let set = tidy(text);
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
