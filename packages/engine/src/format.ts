import { Decimal, type Money } from '@danero/shared';

/**
 * Deterministické české formátování čísel pro texty varování — záměrně bez
 * Intl (ručně přes regex), aby byl výstup enginu bit po bitu stejný v každém
 * runtime (Node, prohlížeč, testy) a šel snadno testovat na přesné texty.
 */

/** Nezlomitelná mezera — oddělovač tisíců i mezera před jednotkou (Kč, %). */
const NBSP = ' ';

/** „1234567“ → „1 234 567“ — tisíce oddělené nezlomitelnou mezerou. */
const groupThousands = (digits: string): string =>
  digits.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);

/** Číslo s desetinnou čárkou a tisíci po česku (bez jednotky). */
const czNumber = (value: Money, decimalPlaces?: number): string => {
  const abs = value.abs();
  const fixed = decimalPlaces === undefined ? abs.toFixed() : abs.toFixed(decimalPlaces);
  const [whole = '0', frac] = fixed.split('.');
  // Zaokrouhlením může ze záporné částky zbýt nula (−0,4 Kč → „-0 Kč“, nález
  // A1-3-09). Znaménko u nuly nic nesděluje a v hlášce vypadá jako chyba
  // výpočtu, takže se zahazuje — rozhoduje VYPSANÁ hodnota, ne původní.
  const isZero = !/[1-9]/.test(fixed);
  const sign = value.isNegative() && !isZero ? '-' : '';
  return `${sign}${groupThousands(whole)}${frac ? `,${frac}` : ''}`;
};

/** Částka v celých Kč (zaokrouhlení HALF_UP): „264 312 Kč“. */
export function czkText(m: Money): string {
  return `${czNumber(m.toDecimalPlaces(0, Decimal.ROUND_HALF_UP))}${NBSP}Kč`;
}

/**
 * Částka v CIZÍ měně: „1 234,56 USD“. Na rozdíl od `czkText` se zaokrouhluje
 * na dvě desetinná místa (haléře cizí měny mají smysl) a jednotkou je kód měny.
 *
 * Existuje kvůli tomu, že `Decimal.toString()` v hlášce vypíše celý periodický
 * rozvoj: vratka kapitálu 100 CZK na 3 kusy dala „snížila nabývací cenu
 * o 99.99999999999999999999999999999999 CZK“ (týž případ jako nález A1-3-08
 * u počtu kusů). Do textu pro člověka nesmí jít syrový Decimal.
 */
export function moneyText(m: Money, currency: string): string {
  return `${czNumber(m.toDecimalPlaces(2, Decimal.ROUND_HALF_UP), 2)}${NBSP}${currency}`;
}

/** Desetinný zlomek jako procento: pctText(d('0.15')) → „15 %“; pctText(r, 2) → „93,75 %“. */
export function pctText(fraction: Money, decimalPlaces = 0): string {
  const value = fraction.mul(100).toDecimalPlaces(decimalPlaces, Decimal.ROUND_HALF_UP);
  return `${czNumber(value, decimalPlaces)}${NBSP}%`;
}

/**
 * Maximum desetinných míst u počtu kusů. Osm pokryje i satoshi (1e-8 BTC),
 * což je nejjemnější jednotka, jakou výpisy brokerů reálně nesou.
 */
const QTY_DECIMALS = 8;

/**
 * Počet kusů/kontraktů: desetinná čárka, tisíce s mezerou („1 234,5“).
 *
 * Podíly z reverzních splitů jsou periodická čísla (3:1 → 0,666…) a Decimal je
 * nese na 32 platných cifer, takže se do hlášky vypsalo „prodáno o
 * 0,66666666666666666666666666666667 ks více“ (nález A1-3-08). Zaokrouhluje se
 * proto na `QTY_DECIMALS`; koncové nuly `toFixed()` bez argumentu nepřidává,
 * takže „1,5 ks“ nezhrubne na „1,50000000 ks“.
 */
export function qtyText(m: Money): string {
  return czNumber(m.toDecimalPlaces(QTY_DECIMALS, Decimal.ROUND_HALF_UP));
}

/** ISO datum po česku: „2026-03-12“ → „12. 3. 2026“. */
export function czDateText(iso: string): string {
  const [year, month, day] = iso.split('-');
  if (!year || !month || !day) return iso;
  return `${Number(day)}.${NBSP}${Number(month)}.${NBSP}${year}`;
}
