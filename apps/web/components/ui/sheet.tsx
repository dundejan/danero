'use client';

import { animate, motion, useMotionValue, useReducedMotion, useTransform } from 'motion/react';
import { useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import {
  releaseTarget,
  SHEET_CLOSED,
  SHEET_OPEN,
  sheetReducer,
} from '@/components/ui/sheet-machine';
import {
  type MotionSample,
  releaseVelocity,
  rubberBand,
  SPRING_DEFAULT,
  SPRING_MOMENTUM,
  SPRING_QUICK,
} from '@/lib/motion';
import { cn } from '@/lib/utils';

interface DragState {
  pointerId: number;
  startY: number;
  startOffset: number;
  /** Tah se počítá až po překonání prahu — do té doby je to možná klepnutí. */
  active: boolean;
  /** Dotyk začal v rolovatelném obsahu: o tah se sheet dělí s rolováním. */
  inScroller: boolean;
  samples: MotionSample[];
}

/** Práh, po kterém se dotyk bere jako tah (ne klepnutí na položku). */
const DRAG_THRESHOLD = 10;
/** Kolik posledních vzorků pohybu stačí na rychlost při puštění. */
const SAMPLE_LIMIT = 8;
/** Od jaké rychlosti (px/s) neslo puštění hybnost — a zaslouží si překmit. */
const MOMENTUM_THRESHOLD = 100;
/** Kolik pixelů před koncem dráhy se zavírání bere za hotové (pružina se k cíli
    blíží čím dál pomaleji a poslední pixely pod hranou okna nikdo nevidí). */
const EXIT_SLACK = 4;

/**
 * Úchyt a hlavička jsou místo, za které se sheet táhne — jako titulek okna,
 * ne text k označení. Myš by při tahu titulek označila a další chycení za
 * označený text by prohlížeč vzal jako přetahování textu (viz `onDragStart`).
 */
const GRIP = 'select-none';

/**
 * Spodní sheet (mobil): jediné místo v aplikaci se skutečně tažitelnou
 * plochou, a proto jediné místo s gesty.
 *
 * - Přijede zdola a tamtéž odjede (stejná dráha tam i zpět), při každém
 *   otevření — ne jen při prvním.
 * - Tah sleduje prst 1 : 1 od místa, kde plochu chytil; nad horní hranou
 *   klade rostoucí odpor místo tvrdého zastavení.
 * - Po puštění se rozhoduje podle toho, kam by sheet DOJEL (rychlost
 *   promítnutá dopředu), ne podle místa puštění — krátké švihnutí ho zavře.
 *   Pružina převezme rychlost prstu (je zadaná fyzikou, viz `lib/motion.ts`),
 *   takže mezi tahem a animací není šev.
 * - Chytit jde kdykoli — při otevírání i při zavírání. Tah naváže z místa, kde
 *   sheet zrovna je, a puštění ho pošle tam, kam ho prst hodil: zavíraný sheet
 *   jde hodem nahoru vrátit (`onReopen`), pouhé zachycení ho nechá dojet.
 *   Žádná cesta nekončí sheetem, který stojí a nereaguje — hlídá to stavový
 *   automat v `sheet-machine.ts`.
 * - Obsah vyšší než okno roluje uvnitř. Je-li odrolovaný na začátek, tah dolů
 *   za něj stáhne sheet; jinak roluje.
 * - Ztmavení pozadí je navázané na polohu sheetu, ne na čas. Stránka pod
 *   otevřeným sheetem neroluje (pravidlo pro `dialog:modal` v globals.css).
 * - Omezený pohyb: žádný posun ani tah (úchyt proto není vidět), jen krátké
 *   prolnutí.
 *
 * Staví na nativním `<dialog>`: past na fokus, Escape i návrat fokusu na
 * spouštěč dělá prohlížeč.
 *
 * S `title` dostane sheet hlavičku s titulkem a tlačítkem „Hotovo“ (zavřít
 * jde vždy i klepnutím mimo a klávesou Escape).
 */
export function Sheet({
  open,
  onClose,
  onReopen,
  label,
  title,
  doneLabel = 'Hotovo',
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  /**
   * Uživatel zavíraný sheet chytil a hodil zpátky nahoru — rodič má vrátit
   * `open` na `true`. Bez něj se sheet vrátí i tak (stav si drží sám), jen
   * o tom rodič neví a jeho spouštěč dál hlásí „zavřeno“.
   */
  onReopen?: () => void;
  /** Přístupný název dialogu. */
  label: string;
  /** Viditelný titulek; s ním sheet dostane i tlačítko pro zavření. */
  title?: string;
  /** Popisek zavíracího tlačítka vedle titulku. */
  doneLabel?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion() ?? false;

  // Vlastnost `open` je pro automat událost, ne stav: převádí se na ni při
  // vykreslení (ne v efektu), aby mezi změnou a reakcí nevznikl prázdný snímek.
  const [state, dispatch] = useReducer(sheetReducer, open ? SHEET_OPEN : SHEET_CLOSED);
  const [seenOpen, setSeenOpen] = useState(open);
  if (open !== seenOpen) {
    setSeenOpen(open);
    dispatch({ type: open ? 'open' : 'close' });
  }
  const y = useMotionValue(0);
  const fade = useMotionValue(0);
  const height = useRef(1);
  /** Rychlost prstu při puštění, kterou má převzít příští animace. */
  const handoff = useRef<number | null>(null);
  const stopAnimation = useRef<(() => void) | null>(null);
  const closedBySheet = useRef(false);
  const drag = useRef<DragState | null>(null);
  /** Komu patří tah, který začal v rolovatelném obsahu. */
  const scrollGate = useRef<'undecided' | 'sheet' | 'scroll'>('undecided');
  const suppressClick = useRef(false);

  const scrimOpacity = useTransform(() =>
    reducedMotion ? fade.get() : 1 - Math.min(Math.max(y.get() / height.current, 0), 1),
  );

  // Nově připojený sheet: otevřít dialog a postavit plochu pod hranu okna.
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    const panel = panelRef.current;
    if (!state.mounted || !dialog || !panel || dialog.open) return;
    closedBySheet.current = false;
    dialog.showModal();
    // `showModal()` dává fokus dovnitř plochy, která v tu chvíli leží pod
    // hranou okna. Dialog je proto `overflow-clip` (ořez bez rolování) — jako
    // rolovatelný kontejner by k fokusu odroloval přesně o výšku sheetu
    // a příjezd by tím vyrušil. Vynulování je pojistka pro starší prohlížeče.
    dialog.scrollTop = 0;
    height.current = panel.offsetHeight || 1;
    if (reducedMotion) {
      y.jump(0);
      fade.jump(0);
    } else {
      fade.jump(1);
      y.jump(height.current);
    }
  }, [state.mounted, reducedMotion, y, fade]);

  // Sheet, který je ve stromu a nikdo ho nedrží, jede ke svému cíli. Efekt
  // běží znovu po každém puštění (mění se `held`), takže po něm sheet nikdy
  // nezůstane stát.
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    const panel = panelRef.current;
    if (!state.mounted || state.held || !dialog || !panel) return;
    height.current = panel.offsetHeight || 1;
    // Obsah vyšší než okno roluje uvnitř sheetu; kratší slouží jako úchyt celý.
    // `touch-action` musí být nastavené dřív, než gesto začne — proto tady.
    const body = bodyRef.current;
    if (body) {
      body.style.touchAction = body.scrollHeight > body.clientHeight + 1 ? 'pan-y' : 'none';
    }

    const opening = state.target === 'open';
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      if (!opening) {
        closedBySheet.current = true;
        dialog.close();
      }
      dispatch({ type: 'settled' });
    };

    if (reducedMotion) {
      y.jump(0);
      const controls = animate(fade, opening ? 1 : 0, {
        duration: opening ? 0.2 : 0.15,
        ease: 'easeOut',
      });
      void controls.then(finish);
      const stop = () => {
        finished = true;
        controls.stop();
      };
      stopAnimation.current = stop;
      return stop;
    }

    fade.jump(1);
    const velocity = handoff.current;
    handoff.current = null;
    // Otevírá se pomaleji, než se zavírá; překmit jen po hodu, který nesl
    // hybnost. Bez předané rychlosti pružina převezme tu, kterou hodnota má
    // z přerušené animace — obrácení směru tak není náraz do zdi.
    const base = !opening
      ? SPRING_QUICK
      : velocity !== null && Math.abs(velocity) > MOMENTUM_THRESHOLD
        ? SPRING_MOMENTUM
        : SPRING_DEFAULT;
    const controls = animate(
      y,
      opening ? 0 : height.current,
      velocity === null ? base : { ...base, velocity },
    );
    void controls.then(finish);
    // Zavírání končí, jakmile plocha zmizí za hranou — nečeká se, až pružina
    // dozní na posledním půl pixelu, po tu dobu by dialog zbytečně blokoval
    // stránku pod sebou.
    const unsubscribe = opening
      ? undefined
      : y.on('change', (latest) => {
          if (latest >= height.current - EXIT_SLACK) finish();
        });
    const stop = () => {
      finished = true;
      unsubscribe?.();
      controls.stop();
    };
    stopAnimation.current = stop;
    return stop;
  }, [state.mounted, state.target, state.held, reducedMotion, y, fade]);

  // Tah, který začal v rolovatelném obsahu, patří rolování — až na jeden
  // případ: obsah je odrolovaný na začátek a prst míří dolů. Pak ho dostane
  // sheet. Rozhodne první pohyb a rozhodnutí platí do konce gesta; prohlížeči
  // se rolování odepře zrušením `touchmove` (posluchač proto nesmí být pasivní,
  // což React u svých neumí).
  useEffect(() => {
    const body = bodyRef.current;
    if (!state.mounted || !body) return;
    let startY = 0;
    const onTouchStart = (event: TouchEvent) => {
      startY = event.touches[0]?.clientY ?? 0;
      scrollGate.current = 'undecided';
    };
    const onTouchMove = (event: TouchEvent) => {
      if (body.style.touchAction !== 'pan-y') return;
      if (scrollGate.current === 'undecided') {
        const delta = (event.touches[0]?.clientY ?? startY) - startY;
        if (delta === 0) return;
        scrollGate.current = delta > 0 && body.scrollTop <= 0 ? 'sheet' : 'scroll';
      }
      if (scrollGate.current === 'sheet' && event.cancelable) event.preventDefault();
    };
    body.addEventListener('touchstart', onTouchStart, { passive: true });
    body.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => {
      body.removeEventListener('touchstart', onTouchStart);
      body.removeEventListener('touchmove', onTouchMove);
    };
  }, [state.mounted]);

  if (!state.mounted) return null;

  const requestClose = () => {
    dispatch({ type: 'close' });
    onClose();
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const dragged = drag.current;
    if (!dragged || dragged.pointerId !== event.pointerId) return;
    drag.current = null;
    if (!dragged.active) {
      // jen zachycená animace bez tahu — sheet dojede tam, kam mířil
      dispatch({ type: 'release' });
      return;
    }
    // puštění po tahu nesmí „kliknout“ na položku pod prstem
    suppressClick.current = event.type === 'pointerup';
    const velocity = releaseVelocity(dragged.samples, event.timeStamp);
    const target = releaseTarget(y.get(), velocity, height.current);
    handoff.current = velocity;
    dispatch({ type: 'release', target });
    if (target === 'closed') onClose();
    else if (!open) onReopen?.();
  };

  return (
    <dialog
      ref={dialogRef}
      aria-label={label}
      onCancel={(event) => {
        // Escape: nezavírat skokem, ale stejnou cestou jako všechno ostatní
        event.preventDefault();
        requestClose();
      }}
      onClose={() => {
        // Zavřel-li dialog prohlížeč sám (druhý Escape po sobě už zrušit
        // nejde), není co animovat — jen srovnat stav.
        if (closedBySheet.current) return;
        dispatch({ type: 'dismissed' });
        onClose();
      }}
      className="fixed inset-0 m-0 h-dvh max-h-none w-full max-w-none overflow-clip bg-transparent p-0 backdrop:bg-transparent"
    >
      <motion.div
        aria-hidden
        onClick={requestClose}
        style={{ opacity: scrimOpacity, backgroundColor: 'var(--scrim)' }}
        className="absolute inset-0 touch-none"
      />
      <motion.div
        ref={panelRef}
        style={{ y, opacity: reducedMotion ? fade : 1 }}
        onPointerDown={(event) => {
          if (reducedMotion || drag.current) return;
          if (event.pointerType === 'mouse' && event.button !== 0) return;
          suppressClick.current = false;
          const body = bodyRef.current;
          const inScroller =
            body !== null &&
            body.style.touchAction === 'pan-y' &&
            event.target instanceof Node &&
            body.contains(event.target);
          // myší se za rolovatelný obsah netáhne — označuje se v něm text
          if (inScroller && event.pointerType !== 'touch') return;
          // dotyk běžící animaci zastaví hned, ne až po vykreslení
          stopAnimation.current?.();
          const offset = y.get();
          drag.current = {
            pointerId: event.pointerId,
            startY: event.clientY,
            startOffset: offset,
            active: false,
            inScroller,
            samples: [{ time: event.timeStamp, offset }],
          };
          dispatch({ type: 'grab' });
        }}
        onPointerMove={(event) => {
          const dragged = drag.current;
          if (!dragged || dragged.pointerId !== event.pointerId) return;
          if (!dragged.active) {
            if (Math.abs(event.clientY - dragged.startY) < DRAG_THRESHOLD) return;
            if (dragged.inScroller && scrollGate.current !== 'sheet') return;
            dragged.active = true;
            // kotva se přesune sem, aby sheet po překonání prahu neposkočil,
            // a rychlost se měří až od chvíle, kdy se sheet opravdu hýbe
            dragged.startY = event.clientY;
            dragged.samples = [{ time: event.timeStamp, offset: dragged.startOffset }];
            event.currentTarget.setPointerCapture(event.pointerId);
          }
          const raw = dragged.startOffset + (event.clientY - dragged.startY);
          const offset = raw < 0 ? rubberBand(raw, height.current) : raw;
          y.set(offset);
          dragged.samples.push({ time: event.timeStamp, offset });
          if (dragged.samples.length > SAMPLE_LIMIT) dragged.samples.shift();
        }}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDragStart={(event) => {
          // Chycený sheet nesmí prohlížeč vyměnit za přetahování označeného
          // textu: tah by skončil `pointercancel` a sheet se nepohnul, a WebKit
          // neposlal ani to — sheet zůstal „v ruce“ a nešel zavřít klávesou
          // ani klepnutím mimo (změřeno 11. 10. 2026 ve všech třech jádrech).
          if (drag.current) event.preventDefault();
        }}
        onClickCapture={(event) => {
          if (!suppressClick.current) return;
          suppressClick.current = false;
          event.preventDefault();
          event.stopPropagation();
        }}
        className={cn(
          'material-sheet absolute inset-x-0 bottom-0 mx-auto flex max-h-[calc(100dvh-2.5rem)] max-w-[40rem] flex-col rounded-t-2xl shadow-floating',
          // Plocha pokračuje pod spodní hranu okna: při tahu nahoru a při
          // překmitu po hodu se sheet zvedne nad svou polohu a pod ním by jinak
          // zůstala mezera na stránku.
          'after:absolute after:inset-x-0 after:top-full after:h-[50vh] after:bg-inherit',
          className,
        )}
      >
        {/* úchyt: říká, že plochu jde stáhnout — s omezeným pohybem stáhnout
            nejde, tak ho neslibujeme (odstup shora zůstává) */}
        <div
          aria-hidden
          className={cn('flex h-6 shrink-0 touch-none items-center justify-center', GRIP)}
        >
          {!reducedMotion && <span className="h-1 w-9 rounded-full bg-ink-muted/50" />}
        </div>
        {title && (
          <div
            className={cn(
              'flex shrink-0 touch-none items-center justify-between gap-4 px-5 pb-3',
              !reducedMotion && GRIP,
            )}
          >
            <h2 className="type-title-3 min-w-0 flex-1 text-balance wrap-anywhere">{title}</h2>
            <button
              type="button"
              onClick={requestClose}
              className="type-body -my-2 -mr-2 inline-flex min-h-11 max-w-[40%] shrink-0 items-center rounded-full px-2 font-semibold text-accent-text active:opacity-50"
            >
              {/* dlouhý popisek nesmí titulek smáčknout na slovo na řádek */}
              <span className="truncate">{doneLabel}</span>
            </button>
          </div>
        )}
        <div
          ref={bodyRef}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))]"
        >
          {children}
        </div>
      </motion.div>
    </dialog>
  );
}
