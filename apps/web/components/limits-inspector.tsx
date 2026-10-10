'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Sheet } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

export interface LimitEntry {
  key: string;
  /** Celý název limitu — titulek sheetu na telefonu. */
  title: string;
  /** Obsah řádku seznamu (název, odměrka, čerpání) — vykreslený na serveru. */
  row: React.ReactNode;
  /** Detail limitu (kolik zbývá, graf, vysvětlení) — vykreslený na serveru. */
  detail: React.ReactNode;
}

/** Od téhle šířky OKNA S OBSAHEM stojí detail vedle seznamu (= `@3xl`). */
const WIDE_REM = 48;

/**
 * Limity: seznam a detail vybraného limitu.
 *
 * - Široké okno: vlevo seznam, vpravo inspektor s detailem vybraného řádku —
 *   stejné rozdělení jako seznam a inspektor v aplikacích Macu. Vybraný je
 *   vždy právě jeden řádek; přepnutí je okamžité, bez animace (pracovní úkon,
 *   který člověk opakuje, ne přechod mezi místy). Šipky nahoru/dolů přecházejí
 *   mezi řádky.
 * - Úzké okno (telefon): jen seznam. Klepnutí na řádek otevře detail ve
 *   spodním sheetu, takže seznam zůstává krátký a všechny limity jsou vidět
 *   naráz — dřív se detail rozbaloval pod řádkem a ostatní limity odsunul
 *   o obrazovku níž.
 *
 * Rozhoduje šířka OKNA S OBSAHEM (`@container`), ne šířka prohlížeče: stejná
 * komponenta stojí v aplikaci vedle postranního panelu i v náhledu na úvodní
 * stránce. Rozvržení přepíná CSS; JavaScript se jen ptá, která podoba platí,
 * aby věděl, jestli má klepnutí otevřít sheet.
 *
 * Bez JavaScriptu ukazuje široké okno detail prvního limitu; na telefonu
 * zůstává seznam (čerpání, odměrka a stav jsou v řádku).
 */
export function LimitsInspector({
  entries,
  defaultKey,
  className,
}: {
  entries: LimitEntry[];
  defaultKey?: string;
  className?: string;
}) {
  const baseId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const rows = useRef<Array<HTMLButtonElement | null>>([]);
  const [selected, setSelected] = useState(defaultKey ?? entries[0]?.key);
  const [sheetOpen, setSheetOpen] = useState(false);
  // výchozí „široké“ odpovídá tomu, co server vykreslí pro stolní okno;
  // telefon si to opraví hned po připojení
  const [wide, setWide] = useState(true);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const measure = () => {
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      setWide(root.clientWidth >= WIDE_REM * rem);
    };
    // pozorovatel ohlásí první měření sám hned po připojení
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  const current = entries.find((entry) => entry.key === selected) ?? entries[0];
  const regionId = `${baseId}-detail`;

  const move = (index: number, step: number) => {
    const next = entries[index + step];
    if (!next) return;
    setSelected(next.key);
    rows.current[index + step]?.focus();
  };

  return (
    <div ref={rootRef} className={cn('@container', className)}>
      <div className="@3xl:grid @3xl:grid-cols-[minmax(0,1fr)_minmax(0,var(--inspector-width))] @3xl:items-start @3xl:gap-x-(--column-gap)">
        <div role="list" className="divide-y divide-line/70 @3xl:divide-y-0">
          {entries.map((entry, index) => {
            const active = wide && entry.key === current?.key;
            return (
              <div key={entry.key} role="listitem">
                <button
                  ref={(node) => {
                    rows.current[index] = node;
                  }}
                  type="button"
                  {...(wide
                    ? { 'aria-expanded': active, 'aria-controls': regionId }
                    : { 'aria-haspopup': 'dialog' as const })}
                  onClick={() => {
                    setSelected(entry.key);
                    if (!wide) setSheetOpen(true);
                  }}
                  onKeyDown={(event) => {
                    if (!wide) return;
                    if (event.key === 'ArrowDown') {
                      event.preventDefault();
                      move(index, 1);
                    } else if (event.key === 'ArrowUp') {
                      event.preventDefault();
                      move(index, -1);
                    }
                  }}
                  className={cn(
                    // text řádku lícuje s okrajem obsahu; zvýraznění ho přesahuje
                    'row-pressable -mx-3 block w-[calc(100%+1.5rem)] rounded-xl px-3 py-3.5 text-left',
                    active ? 'bg-canvas' : 'hover:bg-canvas/60',
                  )}
                >
                  {entry.row}
                </button>
              </div>
            );
          })}
        </div>

        {/* inspektor: jen v širokém okně; tichá plocha ho spojuje s vybraným řádkem */}
        <div
          id={regionId}
          role="region"
          aria-label={current?.title}
          className="hidden rounded-2xl bg-canvas p-5 @3xl:block"
        >
          {/* graf se v neviditelném inspektoru nekreslí (měřil by nulovou šířku) */}
          {wide && current?.detail}
        </div>
      </div>

      {current && (
        <Sheet
          open={sheetOpen && !wide}
          onClose={() => setSheetOpen(false)}
          label={current.title}
          title={current.title}
        >
          {current.detail}
        </Sheet>
      )}
    </div>
  );
}
