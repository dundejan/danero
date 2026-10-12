import { d, type Money } from '@danero/shared';
import { LIMIT_NAME, limitWithAmount, type LimitKind } from '@/lib/limit-names';

/**
 * Znění upozornění hlídače: titulek události limitu a převod UŽ ULOŽENÉHO
 * upozornění na dnešní názvy.
 *
 * Titulek i text upozornění se ukládají do databáze ve chvíli, kdy událost
 * vznikne (je to zároveň předmět a tělo e-mailu). Když se 11. 10. 2026 limity
 * přejmenovaly podle `lib/limit-names.ts`, nová upozornění nová jména dostala,
 * ale uložená si nesla stará — v „Posledních upozorněních“ na přehledu tak
 * stálo „Prolomen limit 50 000 Kč pro paušální daň“ hned vedle „Prolomen limit
 * paušální daně (50 000 Kč)“ a vedle seznamu limitů, kde se týž limit jmenuje
 * „Limit paušální daně“.
 *
 * Záznam o tom, co odešlo e-mailem, se nepřepisuje. Znění se proto odvozuje
 * až při ZOBRAZENÍ, a to z druhu události (dedupe klíč + typ), ne hledáním
 * ve starém textu: stejná funkce skládá titulek nové události i titulek té
 * uložené, takže se nemůžou rozejít ani při příštím přejmenování. Uložený
 * text zůstává zálohou pro všechno, co poznat nejde.
 */

/** Stav události limitu — odpovídá typům `LIMIT_WARNING` / `_CRITICAL` / `_EXCEEDED`. */
export type LimitEventLevel = 'warning' | 'critical' | 'exceeded';

/**
 * Část dedupe klíče (`limit|<část>|<pásmo>|<rok>`) → druh limitu. Klíč nese
 * jen druh, částku ne (ta se u limitů § 38g rok od roku mění).
 */
export const LIMIT_EVENT_KIND = {
  '50k': 'FLAT_TAX',
  '20k': 'EMPLOYEE_SIDE_INCOME',
  filing50k: 'GENERAL_FILING',
  '100k': 'SECURITIES',
  krypto100k: 'CRYPTO',
} as const satisfies Record<string, LimitKind>;

export type LimitEventKey = keyof typeof LIMIT_EVENT_KIND;

const LEVEL_BY_TYPE: Record<string, LimitEventLevel> = {
  LIMIT_WARNING: 'warning',
  LIMIT_CRITICAL: 'critical',
  LIMIT_EXCEEDED: 'exceeded',
};

/**
 * Titulek události limitu. Limit se „prolomí“, osvobození prodej „zruší“ —
 * stejná slovesa jako v simulátoru. A „Blížíš se: osvobození…“ by se četlo
 * jako dobrá zpráva o časovém testu, proto má osvobození vlastní předstih.
 */
export function limitEventTitle(kind: LimitKind, level: LimitEventLevel, limitCzk: Money): string {
  const name = limitWithAmount(kind, limitCzk);
  const exemption = kind === 'SECURITIES' || kind === 'CRYPTO';
  if (level === 'exceeded') return `${exemption ? 'Zrušeno' : 'Prolomen'} ${name}`;
  if (level === 'critical') return `${exemption ? 'Skoro vyčerpáno' : 'Blížíš se'}: ${name}`;
  return `Za polovinou: ${name}`;
}

/** Částka zapsaná v textu („50 000 Kč“) → číslo; `\s` bere i pevné mezery, které píše `czk()`. */
const AMOUNT_RE = /(\d[\d\s]*)\sKč/u;

function amountIn(text: string): Money | null {
  const match = AMOUNT_RE.exec(text);
  if (!match) return null;
  const digits = match[1]!.replace(/\s/gu, '');
  return digits === '' ? null : d(digits);
}

/**
 * Řádky pravidelného přehledu a lednové shrnutí, jak se psaly do 11. 10. 2026.
 * Jediné místo, kde se stará jména ještě vyskytují — a jen proto, aby je šlo
 * v uloženém textu poznat. Částka u limitů § 38g se rok od roku liší, proto
 * výraz, ne řetězec.
 */
const AMOUNT = String.raw`\d[\d\s]*\sKč`;
const LEGACY_SUMMARY_LABELS: Array<[RegExp, string]> = [
  [new RegExp(String.raw`limit ${AMOUNT} pro paušální daň:`, 'gu'), `${LIMIT_NAME.FLAT_TAX}:`],
  [new RegExp(String.raw`limit ${AMOUNT} vedlejších příjmů:`, 'gu'), `${LIMIT_NAME.EMPLOYEE_SIDE_INCOME}:`],
  [new RegExp(String.raw`limit ${AMOUNT} pro podání přiznání:`, 'gu'), `${LIMIT_NAME.GENERAL_FILING}:`],
  [new RegExp(String.raw`limit ${AMOUNT} pro osvobození prodejů:`, 'gu'), `${LIMIT_NAME.SECURITIES}:`],
  [new RegExp(String.raw`limit ${AMOUNT} pro osvobození krypta:`, 'gu'), `${LIMIT_NAME.CRYPTO}:`],
];
const LEGACY_YEAR_SUMMARY = /^Daňový report za (\d{4}) máš hotový/u;

export interface StoredNotificationText {
  dedupeKey: string;
  type: string;
  title: string;
  body: string;
}

/**
 * Titulek a text upozornění dnešními názvy.
 *
 * - Událost limitu: titulek se složí znovu z druhu limitu (dedupe klíč), stavu
 *   (typ) a částky, kterou uložený titulek jmenuje. Text („Čerpání je X z Y“)
 *   limit nejmenuje a zůstává.
 * - Pravidelný přehled a lednové shrnutí: v textu se vymění jen jména limitů
 *   a stránky; čísla zůstávají ta uložená.
 * - Cokoli jiného (časové testy, termíny, neznámý druh, titulek bez částky):
 *   uložené znění beze změny.
 *
 * U upozornění s dnešním zněním vrací přesně to, co dostala — hlídá to test.
 */
export function currentNotificationText(stored: StoredNotificationText): {
  title: string;
  body: string;
} {
  const { dedupeKey, type, title, body } = stored;

  const level = LEVEL_BY_TYPE[type];
  if (level !== undefined) {
    const [prefix, key] = dedupeKey.split('|');
    const kind = prefix === 'limit' && key !== undefined && key in LIMIT_EVENT_KIND
      ? LIMIT_EVENT_KIND[key as LimitEventKey]
      : undefined;
    const limitCzk = amountIn(title);
    if (kind === undefined || limitCzk === null) return { title, body };
    return { title: limitEventTitle(kind, level, limitCzk), body };
  }

  if (type === 'SUMMARY') {
    return {
      title,
      body: LEGACY_SUMMARY_LABELS.reduce((text, [legacy, name]) => text.replace(legacy, name), body),
    };
  }

  if (type === 'YEAR_SUMMARY') {
    return { title, body: body.replace(LEGACY_YEAR_SUMMARY, 'Report za rok $1 máš hotový') };
  }

  return { title, body };
}
