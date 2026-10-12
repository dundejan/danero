/**
 * Pružiny rozhraní — jediné místo, kde se rozhoduje, jak se věci hýbou.
 *
 * O pružině uvažujeme dvojicí, kterou používá Apple: **tlumení** (1 = kriticky
 * tlumená, bez překmitu; pod 1 překmitne) a **odezva** v sekundách (jak rychle
 * hodnota doběhne k cíli — není to pevná délka animace).
 *
 * Knihovně ji ale předáváme FYZIKOU (tuhost, tlumení, hmotnost), ne zápisem
 * `duration` + `bounce`: pružině zadané časem `motion` 14 počáteční rychlost
 * zahazuje („time-defined springs ignore inherited velocity“). Sheet puštěný
 * z tahu pak po uvolnění prstu na snímek zastavil a rozjížděl se znovu od nuly
 * a přerušená animace při obrácení ztrácela hybnost. Pružina zadaná fyzikou
 * rychlost přebírá — od prstu (`velocity`) i od animace, kterou nahrazuje.
 *
 * - `SPRING_DEFAULT` — všechno, co se jen přesouvá nebo objevuje (sheet
 *   otevřený klepnutím, rozbalení menu). Bez překmitu.
 * - `SPRING_QUICK` — malý a častý pohyb (palec segmentového přepínače)
 *   a odchod: zavírání má být rychlejší než otevírání. Bez překmitu.
 * - `SPRING_MOMENTUM` — jen po gestu, které neslo hybnost (sheet puštěný
 *   z tahu). Lehký překmit je tu na místě, protože ho způsobila ruka.
 */
export function spring(
  dampingRatio: number,
  response: number,
): { type: 'spring'; stiffness: number; damping: number; mass: 1 } {
  const angularFrequency = (2 * Math.PI) / response;
  return {
    type: 'spring',
    stiffness: angularFrequency ** 2,
    damping: 2 * dampingRatio * angularFrequency,
    mass: 1,
  };
}

export const SPRING_DEFAULT = spring(1, 0.35);
export const SPRING_QUICK = spring(1, 0.25);
export const SPRING_MOMENTUM = spring(0.8, 0.3);

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

export interface MotionSample {
  /** Čas události v milisekundách (`event.timeStamp`). */
  time: number;
  /** Poloha taženého prvku v pixelech — skutečná, tedy už po odporu na hraně. */
  offset: number;
}

/**
 * Rychlost při puštění (px/s) z krátké historie tahu.
 *
 * Měří se jen z posledních `windowMs` pohybu a **vztahuje se k okamžiku
 * puštění**: prst, který před uvolněním zastavil a držel, žádné další události
 * pohybu neposílá, takže poslední vzorky pořád ukazují původní švih. Je-li
 * poslední pohyb starší než `restMs`, prst stál a rychlost je nula.
 */
export function releaseVelocity(
  samples: readonly MotionSample[],
  releaseTime: number,
  windowMs = 50,
  restMs = 60,
): number {
  const last = samples.at(-1);
  if (!last || releaseTime - last.time > restMs) return 0;
  const first = samples.find((sample) => last.time - sample.time <= windowMs);
  if (!first || first.time === last.time) return 0;
  return ((last.offset - first.offset) / (last.time - first.time)) * 1000;
}
