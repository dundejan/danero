/**
 * Pružiny rozhraní — jediné místo, kde se rozhoduje, jak se věci hýbou.
 *
 * Zápis `bounce` + `duration` odpovídá dvojici, ve které o pružinách uvažuje
 * Apple (tlumení + odezva): `bounce: 0` je kriticky tlumená pružina bez
 * překmitu, `duration` je odezva v sekundách, ne pevná délka animace.
 *
 * - `SPRING_DEFAULT` — všechno, co se jen přesouvá nebo objevuje (palec
 *   segmentového přepínače, popover, sheet otevřený klepnutím). Bez překmitu.
 * - `SPRING_MOMENTUM` — jen po gestu, které neslo hybnost (sheet puštěný
 *   z tahu). Lehký překmit je tu na místě, protože ho způsobila ruka.
 */
export const SPRING_DEFAULT = { type: 'spring', bounce: 0, duration: 0.35 } as const;
export const SPRING_MOMENTUM = { type: 'spring', bounce: 0.2, duration: 0.35 } as const;

/**
 * Kam by tažený prvek dojel, kdyby ho nikdo nezastavil — stejný exponenciální
 * doběh jako u rolování. Cíl (zavřít / vrátit) se vybírá podle tohohle bodu,
 * ne podle místa, kde prst plochu pustil: švihnutí tak sheet „odhodí“.
 */
export function projectMomentum(velocityPxPerSecond: number, decelerationRate = 0.998): number {
  return ((velocityPxPerSecond / 1000) * decelerationRate) / (1 - decelerationRate);
}

/**
 * Měkká hranice: čím dál za okraj se táhne, tím méně prvek následuje.
 * Tvrdé zastavení působí jako zamrzlé rozhraní.
 */
export function rubberBand(overshoot: number, dimension: number, constant = 0.55): number {
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}
