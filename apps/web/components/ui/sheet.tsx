'use client';

import { animate, motion, useMotionValue, useReducedMotion, useTransform } from 'motion/react';
import { useLayoutEffect, useRef, useState } from 'react';
import { projectMomentum, rubberBand, SPRING_DEFAULT, SPRING_MOMENTUM } from '@/lib/motion';
import { cn } from '@/lib/utils';

interface DragState {
  pointerId: number;
  startY: number;
  startOffset: number;
  /** Tah se počítá až po překonání prahu — do té doby je to možná klepnutí. */
  active: boolean;
  samples: { time: number; y: number }[];
}

/** Práh, po kterém se dotyk bere jako tah (ne klepnutí na položku). */
const DRAG_THRESHOLD = 10;
/** Rychlost se měří jen z posledních milisekund pohybu — prst, který se před
    puštěním zastavil, nic neodhazuje. */
const VELOCITY_WINDOW_MS = 100;

/**
 * Spodní sheet (mobil): jediné místo v aplikaci se skutečně tažitelnou
 * plochou, a proto jediné místo s gesty.
 *
 * - Přijede zdola a tamtéž odjede (stejná dráha tam i zpět).
 * - Tah sleduje prst 1 : 1 od místa, kde plochu chytil; nad horní hranou
 *   klade rostoucí odpor místo tvrdého zastavení.
 * - Po puštění se rozhoduje podle toho, kam by sheet DOJEL (rychlost
 *   promítnutá dopředu), ne podle místa puštění — krátké švihnutí ho zavře.
 *   Pružina převezme rychlost prstu, takže mezi tahem a animací není šev.
 * - Běžící animaci jde kdykoli chytit: tah navazuje z aktuální polohy.
 * - Ztmavení pozadí je navázané na polohu sheetu, ne na čas.
 * - Omezený pohyb: žádný posun, jen krátké prolnutí.
 *
 * Staví na nativním `<dialog>`: past na fokus, Escape i návrat fokusu na
 * spouštěč dělá prohlížeč.
 */
export function Sheet({
  open,
  onClose,
  label,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  /** Přístupný název dialogu. */
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion() ?? false;

  // Po zavření zůstává sheet ve stromu, dokud nedojede — stav „dojíždí“ se
  // odvozuje při vykreslení (ne v efektu), aby mezi tím nevznikl prázdný snímek.
  const [wasOpen, setWasOpen] = useState(open);
  const [exiting, setExiting] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    setExiting(!open);
  }
  const mounted = open || exiting;

  const y = useMotionValue(0);
  const fade = useMotionValue(0);
  const height = useRef(1);
  const exitVelocity = useRef(0);
  const drag = useRef<DragState | null>(null);
  const suppressClick = useRef(false);

  const scrimOpacity = useTransform(() =>
    reducedMotion ? fade.get() : 1 - Math.min(Math.max(y.get() / height.current, 0), 1),
  );

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    const panel = panelRef.current;
    if (!mounted || !dialog || !panel) return;

    if (open) {
      const fresh = !dialog.open;
      if (fresh) dialog.showModal();
      height.current = panel.offsetHeight || 1;
      if (reducedMotion) {
        y.set(0);
        const controls = animate(fade, 1, { duration: 0.2, ease: 'easeOut' });
        return () => controls.stop();
      }
      fade.set(1);
      // nově otevřený začíná pod hranou; znovu otevřený uprostřed zavírání
      // pokračuje z místa, kde zrovna je
      if (fresh) y.set(height.current);
      const controls = animate(y, 0, SPRING_DEFAULT);
      return () => controls.stop();
    }

    const controls = reducedMotion
      ? animate(fade, 0, { duration: 0.15, ease: 'easeOut' })
      : animate(y, height.current, { ...SPRING_DEFAULT, velocity: exitVelocity.current });
    exitVelocity.current = 0;
    let cancelled = false;
    void controls.then(() => {
      if (cancelled) return;
      dialog.close();
      setExiting(false);
    });
    return () => {
      cancelled = true;
      controls.stop();
    };
  }, [open, mounted, reducedMotion, y, fade]);

  if (!mounted) return null;

  const releaseVelocity = (state: DragState): number => {
    const last = state.samples.at(-1);
    if (!last) return 0;
    const first = state.samples.find((sample) => last.time - sample.time <= VELOCITY_WINDOW_MS);
    if (!first || first === last) return 0;
    return ((last.y - first.y) / (last.time - first.time)) * 1000;
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state || state.pointerId !== event.pointerId) return;
    drag.current = null;
    if (!state.active) {
      // jen zachycená animace bez tahu — vrať sheet na místo
      if (y.get() !== 0 && open) animate(y, 0, SPRING_DEFAULT);
      return;
    }
    suppressClick.current = true;
    const velocity = releaseVelocity(state);
    const projected = y.get() + projectMomentum(velocity);
    if (projected > height.current * 0.5) {
      exitVelocity.current = velocity;
      onClose();
    } else {
      animate(y, 0, { ...SPRING_MOMENTUM, velocity });
    }
  };

  return (
    <dialog
      ref={dialogRef}
      aria-label={label}
      onCancel={(event) => {
        // Escape: nezavírat skokem, ale stejnou cestou jako všechno ostatní
        event.preventDefault();
        onClose();
      }}
      className="fixed inset-0 m-0 h-dvh max-h-none w-full max-w-none overflow-hidden bg-transparent p-0 backdrop:bg-transparent"
    >
      <motion.div
        aria-hidden
        onClick={onClose}
        style={{ opacity: scrimOpacity, backgroundColor: 'var(--scrim)' }}
        className="absolute inset-0 touch-none"
      />
      <motion.div
        ref={panelRef}
        style={{ y, opacity: reducedMotion ? fade : 1 }}
        onPointerDown={(event) => {
          if (reducedMotion || drag.current) return;
          if (event.pointerType === 'mouse' && event.button !== 0) return;
          y.stop();
          drag.current = {
            pointerId: event.pointerId,
            startY: event.clientY,
            startOffset: y.get(),
            active: false,
            samples: [{ time: event.timeStamp, y: event.clientY }],
          };
        }}
        onPointerMove={(event) => {
          const state = drag.current;
          if (!state || state.pointerId !== event.pointerId) return;
          if (!state.active) {
            if (Math.abs(event.clientY - state.startY) < DRAG_THRESHOLD) return;
            state.active = true;
            // kotva se přesune sem, aby sheet po překonání prahu neposkočil
            state.startY = event.clientY;
            event.currentTarget.setPointerCapture(event.pointerId);
          }
          const offset = state.startOffset + (event.clientY - state.startY);
          y.set(offset < 0 ? rubberBand(offset, height.current) : offset);
          state.samples.push({ time: event.timeStamp, y: event.clientY });
          if (state.samples.length > 8) state.samples.shift();
        }}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClickCapture={(event) => {
          // puštění po tahu nesmí „kliknout“ na položku pod prstem
          if (!suppressClick.current) return;
          suppressClick.current = false;
          event.preventDefault();
          event.stopPropagation();
        }}
        className={cn(
          'material-sheet absolute inset-x-0 bottom-0 touch-none rounded-t-2xl shadow-floating',
          'px-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))]',
          className,
        )}
      >
        {/* úchyt: říká, že plochu jde stáhnout */}
        <div aria-hidden className="flex h-6 items-center justify-center">
          <span className="h-1 w-9 rounded-full bg-ink-muted/50" />
        </div>
        {children}
      </motion.div>
    </dialog>
  );
}
