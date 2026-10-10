'use client';

import { Popover } from '@base-ui/react/popover';
import { useRef, useState, useSyncExternalStore } from 'react';
import { Sheet } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

/**
 * Úzké okno (telefon): vysvětlivka se neotevírá jako bublina u tlačítka, ale
 * jako spodní sheet — bublina by se na 390 px stejně roztáhla přes celou
 * šířku a prst by ji zakrýval. Rozhoduje šířka okna, ne typ ukazatele:
 * tablet s prstem má na bublinu místa dost.
 */
const NARROW_QUERY = '(max-width: 39.99rem)';

function subscribeNarrow(onChange: () => void): () => void {
  const query = window.matchMedia(NARROW_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

const useNarrow = (): boolean =>
  useSyncExternalStore(
    subscribeNarrow,
    () => window.matchMedia(NARROW_QUERY).matches,
    () => false,
  );

/** Písmeno „i“ v kroužku. Kreslené, ne znak písma — drží střed v každém řezu. */
function InfoGlyph() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className="size-4">
      <circle cx="8" cy="8" r="7.25" fill="none" stroke="currentColor" strokeWidth="1.25" />
      <circle cx="8" cy="4.75" r="0.95" fill="currentColor" />
      <path d="M8 7.25v4.25" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

const TRIGGER = [
  // viditelně 16px kroužek, klikací plocha 24 × 24 px (SC 2.5.8); na dotyku
  // ji `hit-area` natáhne na 44 px
  'inline-flex size-6 shrink-0 items-center justify-center rounded-full align-middle',
  'text-ink-muted hover:text-ink active:text-ink pointer-coarse:hit-area',
  'data-popup-open:text-accent-text aria-expanded:text-accent-text',
];

/** Typografie obsahu: krátké odstavce, případně seznam nebo odkaz. */
const BODY =
  'type-footnote text-pretty text-ink [&_a]:font-medium [&_a]:text-accent-text [&_a]:hover:underline [&>*+*]:mt-2 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-4';

/**
 * Vysvětlivka u čísla nebo pojmu: malé tlačítko „i“, které na požádání ukáže
 * krátký text. Je to hlavní nástroj textové diety (docs/07): na obrazovce
 * zůstává číslo, stav, termín a akce — „proč“, „jak se to počítá“, čísla
 * paragrafů a výjimky bydlí tady.
 *
 * - Myš a klávesnice: bublina ukotvená k tlačítku (Base UI Popover) — otevře
 *   ji klik, Enter i mezerník, zavře Escape, klik mimo nebo opětovné
 *   stisknutí; fokus se vrací na tlačítko. Vyrůstá z tlačítka
 *   (`--transform-origin`), ne ze středu.
 * - Úzké okno: tentýž obsah ve spodním sheetu (`Sheet`), který jde stáhnout.
 * - Čtečka: tlačítko se jmenuje „Vysvětlení: <label>“, bublina je dialog
 *   pojmenovaný titulkem.
 *
 * Stojí-li uvnitř bloku s `data-info-anchor` (má ho `Stat`), kotví se bublina
 * pod celý blok, aby nezakryla číslo, které vysvětluje.
 *
 * Nesmí stát UVNITŘ jiného tlačítka nebo odkazu (vnořený ovládací prvek) —
 * u klikacího řádku patří vedle něj, ne do něj.
 *
 * Obsah se vykresluje až po otevření; text, který musí být vidět vždy
 * (výhrada „orientačně, jen z investic“), proto patří vedle čísla, ne sem.
 */
export function InfoPopover({
  label,
  title,
  children,
  side = 'bottom',
  align = 'center',
  className,
}: {
  /** Čeho se vysvětlení týká — přístupný název tlačítka („Vysvětlení: …“). */
  label: string;
  /** Titulek v bublině; výchozí je `label`. `null` titulek vynechá. */
  title?: string | null;
  children: React.ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
  align?: 'start' | 'center' | 'end';
  className?: string;
}) {
  const narrow = useNarrow();
  const [sheetOpen, setSheetOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // Blok, ke kterému vysvětlivka patří (`data-info-anchor`, má ho `Stat`):
  // bublina se pak kotví pod celý blok, ne pod tlačítko — jinak by zakryla
  // právě to číslo, které vysvětluje.
  const [blockAnchored, setBlockAnchored] = useState(false);
  const anchorBlock = (): Element | null =>
    triggerRef.current?.closest('[data-info-anchor]') ?? null;
  const heading = title === undefined ? label : title;
  const ariaLabel = `Vysvětlení: ${label}`;

  if (narrow) {
    return (
      <>
        <button
          type="button"
          aria-label={ariaLabel}
          aria-haspopup="dialog"
          aria-expanded={sheetOpen}
          onClick={() => setSheetOpen(true)}
          className={cn(TRIGGER, className)}
        >
          <InfoGlyph />
        </button>
        <Sheet
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          label={heading ?? label}
          title={heading ?? undefined}
        >
          <div className={cn(BODY, 'type-callout px-1 pb-2')}>{children}</div>
        </Sheet>
      </>
    );
  }

  return (
    <Popover.Root
      onOpenChange={(open) => {
        if (open) setBlockAnchored(anchorBlock() !== null);
      }}
    >
      <Popover.Trigger ref={triggerRef} aria-label={ariaLabel} className={cn(TRIGGER, className)}>
        <InfoGlyph />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          anchor={() => anchorBlock() ?? triggerRef.current}
          side={side}
          align={blockAnchored ? 'start' : align}
          sideOffset={blockAnchored ? 10 : 6}
          collisionPadding={12}
          className="z-50"
        >
          <Popover.Popup
            aria-label={heading ? undefined : label}
            className={cn(
              'w-[min(20rem,var(--available-width))] rounded-xl bg-surface p-4 shadow-floating outline-none dark:bg-control',
              'origin-(--transform-origin) transition-[transform,opacity] duration-150 ease-(--ease-out)',
              'data-starting-style:scale-95 data-starting-style:opacity-0',
              'data-ending-style:scale-95 data-ending-style:opacity-0',
              'motion-reduce:data-starting-style:scale-100 motion-reduce:data-ending-style:scale-100',
            )}
          >
            {heading && (
              <Popover.Title className="type-footnote mb-1.5 font-semibold text-ink">
                {heading}
              </Popover.Title>
            )}
            <div className={BODY}>{children}</div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
