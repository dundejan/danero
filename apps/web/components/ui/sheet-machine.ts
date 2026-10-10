import { projectMomentum } from '@/lib/motion';

/**
 * Stavový automat spodního sheetu — čistá funkce, aby šla celá otestovat bez
 * prohlížeče (`test/sheet-machine.test.ts`).
 *
 * Sheet si svůj stav drží SÁM. Vlastnost `open` od rodiče je jen jedna
 * z událostí, které ho mění; druhé přicházejí od prstu a od doběhlé animace.
 * První verze stav odvozovala z `open` a dokončení zavírání nechávala na
 * animaci, kterou spustila změna té vlastnosti. Když sheet při zavírání někdo
 * chytil, animace se zastavila, `open` už bylo `false` a nezbylo nic, co by ji
 * znovu spustilo — modální dialog zůstal viset a zablokoval celou aplikaci.
 *
 * Z toho plyne jediný invariant, který automat hlídá: **sheet, který je ve
 * stromu a nikdo ho nedrží, vždy někam jede** — buď k otevřené poloze, nebo
 * pryč. Komponenta pustí animaci pokaždé, když platí `mounted && !held`,
 * a po jejím doběhu pošle `settled`.
 */
export type SheetTarget = 'open' | 'closed';

export interface SheetState {
  /** Je sheet ve stromu (a jeho dialog otevřený)? */
  mounted: boolean;
  /** Kam sheet míří, nebo kde už stojí. */
  target: SheetTarget;
  /** Drží ho prst: animace stojí a polohu určuje tah. */
  held: boolean;
}

export type SheetEvent =
  /** Rodič chce sheet otevřít. */
  | { type: 'open' }
  /** Zavřít: rodič, tlačítko „Hotovo“, klepnutí mimo, Escape. */
  | { type: 'close' }
  /** Prst se sheetu dotkl — běžící animace se zastaví na místě. */
  | { type: 'grab' }
  /**
   * Prst pustil. `target` je cíl vybraný z tahu; bez něj (pouhé zachycení
   * bez pohybu, zrušený dotyk) sheet pokračuje tam, kam mířil.
   */
  | { type: 'release'; target?: SheetTarget }
  /** Animace doběhla do cíle. */
  | { type: 'settled' }
  /** Dialog zavřel prohlížeč sám (druhý Escape) — není co animovat. */
  | { type: 'dismissed' };

export const SHEET_CLOSED: SheetState = { mounted: false, target: 'closed', held: false };
export const SHEET_OPEN: SheetState = { mounted: true, target: 'open', held: false };

export function sheetReducer(state: SheetState, event: SheetEvent): SheetState {
  switch (event.type) {
    case 'open':
      if (state.mounted && state.target === 'open') return state;
      return { ...state, mounted: true, target: 'open' };
    case 'close':
      if (!state.mounted || state.target === 'closed') return state;
      return { ...state, target: 'closed' };
    case 'grab':
      if (!state.mounted || state.held) return state;
      return { ...state, held: true };
    case 'release':
      if (!state.held) return state;
      return { ...state, held: false, target: event.target ?? state.target };
    case 'settled':
      // doběhnutí animace, kterou mezitím někdo chytil, nic neznamená
      if (!state.mounted || state.held) return state;
      return state.target === 'closed' ? SHEET_CLOSED : state;
    case 'dismissed':
      return state.mounted ? SHEET_CLOSED : state;
  }
}

/**
 * Kam sheet po puštění pojede. Rozhoduje bod, kam by DOJEL (poloha + hybnost
 * promítnutá dopředu), ne místo, kde ho prst pustil: krátké švihnutí dolů ho
 * zavře i z horní poloviny, švihnutí nahoru ho vrátí i ze spodní.
 *
 * `offset` je posun od otevřené polohy v pixelech (0 = otevřený, `height` =
 * schovaný), `velocity` rychlost v px/s (kladná míří dolů).
 */
export function releaseTarget(offset: number, velocity: number, height: number): SheetTarget {
  return offset + projectMomentum(velocity) > height * 0.5 ? 'closed' : 'open';
}
