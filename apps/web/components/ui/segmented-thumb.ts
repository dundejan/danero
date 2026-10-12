/**
 * Výpočet přesunu palce segmentového přepínače — čistá funkce, aby šla
 * otestovat bez prohlížeče (`test/segmented-control.test.ts`).
 *
 * Palec je vykreslený uvnitř vybraného segmentu a vyplňuje ho celý. Při změně
 * výběru se tedy v DOM objeví rovnou v cíli; aby to oko vidělo jako přesun,
 * dostane posun a měřítko, které ho vrátí tam, kde byl vidět naposledy,
 * a pružina obojí dovede na nulu (technika FLIP).
 *
 * „Kde byl vidět naposledy“ není vždy poloha minulého segmentu: když další
 * klepnutí přijde uprostřed pohybu, palec je někde na cestě. Proto se do
 * výpočtu bere i rozpracovaný posun a měřítko — nový pohyb pak naváže z místa,
 * kde palec opravdu je, bez skoku.
 */
export interface Span {
  /** Levá hrana segmentu (px) — v jakýchkoli souřadnicích, jen pro oba segmenty stejných. */
  left: number;
  width: number;
}

export interface ThumbOffset {
  /** Vodorovný posun palce vůči segmentu, ve kterém je vykreslený (px). */
  x: number;
  /** Vodorovné měřítko palce vůči šířce toho segmentu (levá hrana je pevná). */
  scale: number;
}

export const THUMB_AT_REST: ThumbOffset = { x: 0, scale: 1 };

export function thumbHandoff(from: Span, to: Span, inFlight: ThumbOffset = THUMB_AT_REST): ThumbOffset {
  // segment bez šířky (skrytý přepínač) nemá odkud ani kam jet
  if (from.width <= 0 || to.width <= 0) return THUMB_AT_REST;
  const visibleLeft = from.left + inFlight.x;
  const visibleWidth = from.width * inFlight.scale;
  return { x: visibleLeft - to.left, scale: visibleWidth / to.width };
}
