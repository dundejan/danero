import { describe, expect, it } from 'vitest';
import {
  releaseTarget,
  SHEET_CLOSED,
  SHEET_OPEN,
  sheetReducer,
  type SheetEvent,
  type SheetState,
} from '@/components/ui/sheet-machine';

const run = (events: SheetEvent[], from: SheetState = SHEET_CLOSED): SheetState =>
  events.reduce(sheetReducer, from);

/**
 * Sheet, který je ve stromu a nikdo ho nedrží, musí někam jet: komponenta pak
 * pustí animaci a po ní pošle `settled`. Tady stačí ověřit, že po `settled`
 * je sheet buď otevřený, nebo pryč — nikdy „zavřený, ale pořád ve stromu“.
 */
const afterAnimation = (state: SheetState): SheetState =>
  state.mounted && !state.held ? sheetReducer(state, { type: 'settled' }) : state;

describe('stavový automat sheetu', () => {
  it('otevře se, zavře se a po doběhu zmizí ze stromu', () => {
    const opened = run([{ type: 'open' }, { type: 'settled' }]);
    expect(opened).toEqual(SHEET_OPEN);
    const closing = sheetReducer(opened, { type: 'close' });
    expect(closing).toEqual({ mounted: true, target: 'closed', held: false });
    expect(sheetReducer(closing, { type: 'settled' })).toEqual(SHEET_CLOSED);
  });

  it('sheet chycený při zavírání a puštěný bez tahu dojede pryč (R3-01)', () => {
    // dřív: animaci zastavil dotyk, `open` už bylo false a nic ji nedokončilo —
    // modální dialog zůstal viset a zablokoval aplikaci
    const released = run([{ type: 'close' }, { type: 'grab' }, { type: 'release' }], SHEET_OPEN);
    expect(released).toEqual({ mounted: true, target: 'closed', held: false });
    expect(afterAnimation(released)).toEqual(SHEET_CLOSED);
  });

  it('doběh animace, kterou mezitím někdo chytil, sheet nezavře', () => {
    const held = run([{ type: 'close' }, { type: 'grab' }], SHEET_OPEN);
    expect(sheetReducer(held, { type: 'settled' })).toBe(held);
    expect(held.mounted).toBe(true);
  });

  it('sheet chycený při zavírání a hozený nahoru se vrátí', () => {
    const released = run(
      [{ type: 'close' }, { type: 'grab' }, { type: 'release', target: 'open' }],
      SHEET_OPEN,
    );
    expect(released).toEqual(SHEET_OPEN);
    expect(afterAnimation(released)).toEqual(SHEET_OPEN);
  });

  it('otevřený sheet stažený dolů se zavře i bez odpovědi rodiče', () => {
    // automat nečeká, až rodič přepne `open` — stav si drží sám
    const released = run([{ type: 'grab' }, { type: 'release', target: 'closed' }], SHEET_OPEN);
    expect(afterAnimation(released)).toEqual(SHEET_CLOSED);
    // opožděná odpověď rodiče (`open` → false) už nic nemění
    expect(sheetReducer(SHEET_CLOSED, { type: 'close' })).toBe(SHEET_CLOSED);
  });

  it('žádná posloupnost událostí neskončí sheetem, který stojí zavřený ve stromu', () => {
    const events: SheetEvent[] = [
      { type: 'open' },
      { type: 'close' },
      { type: 'grab' },
      { type: 'release' },
      { type: 'release', target: 'open' },
      { type: 'release', target: 'closed' },
      { type: 'settled' },
      { type: 'dismissed' },
    ];
    // všechny posloupnosti do délky 5 z obou výchozích stavů
    let frontier: SheetState[] = [SHEET_CLOSED, SHEET_OPEN];
    for (let depth = 0; depth < 5; depth += 1) {
      frontier = frontier.flatMap((state) => events.map((event) => sheetReducer(state, event)));
      for (const state of frontier) {
        // prst vždycky jednou pustí; pak sheet dojede a je buď otevřený, nebo pryč
        const released = sheetReducer(state, { type: 'release' });
        const rested = afterAnimation(released);
        expect(rested.held).toBe(false);
        expect(rested.mounted).toBe(rested.target === 'open');
      }
    }
  });

  it('opakované události stav nemění (žádné zbytečné překreslení ani restart animace)', () => {
    expect(sheetReducer(SHEET_OPEN, { type: 'open' })).toBe(SHEET_OPEN);
    expect(sheetReducer(SHEET_CLOSED, { type: 'close' })).toBe(SHEET_CLOSED);
    expect(sheetReducer(SHEET_CLOSED, { type: 'grab' })).toBe(SHEET_CLOSED);
    expect(sheetReducer(SHEET_OPEN, { type: 'release', target: 'closed' })).toBe(SHEET_OPEN);
    expect(sheetReducer(SHEET_CLOSED, { type: 'dismissed' })).toBe(SHEET_CLOSED);
  });

  it('zavření prohlížečem (druhý Escape) odmontuje sheet hned', () => {
    expect(sheetReducer(SHEET_OPEN, { type: 'dismissed' })).toEqual(SHEET_CLOSED);
  });
});

describe('kam sheet po puštění pojede', () => {
  const height = 400;

  it('bez hybnosti rozhoduje polovina výšky', () => {
    expect(releaseTarget(150, 0, height)).toBe('open');
    expect(releaseTarget(250, 0, height)).toBe('closed');
  });

  it('krátké švihnutí dolů zavře i z horní poloviny', () => {
    expect(releaseTarget(50, 600, height)).toBe('closed');
  });

  it('švihnutí nahoru vrátí i ze spodní poloviny', () => {
    expect(releaseTarget(300, -600, height)).toBe('open');
  });

  it('tah nad horní hranu (odpor) vždy vrací', () => {
    expect(releaseTarget(-40, 0, height)).toBe('open');
  });
});
