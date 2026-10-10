'use client';

import { Fragment, useId, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

export interface LimitEntry {
  key: string;
  /** Obsah řádku seznamu (název, odměrka, čerpání) — vykreslený na serveru. */
  row: React.ReactNode;
  /** Detail limitu (graf, vysvětlení) — vykreslený na serveru. */
  detail: React.ReactNode;
}

/**
 * Pracovní plocha přehledu: vlevo odpověď a seznam limitů, vpravo inspektor —
 * nahoře klíčová čísla, pod nimi detail vybraného limitu. Stejné rozdělení
 * jako seznam a inspektor v aplikacích Macu, takže vysvětlení limitu nemusí
 * do modálního okna ani pod každý řádek zvlášť.
 *
 * V úzkém okně (telefon) je všechno pod sebou a detail se rozbalí přímo pod
 * svým řádkem. Kvůli tomu jsou řádky a detaily ve zdroji proložené a široké
 * okno je mřížkou jen přeskládá: řádky do levého sloupce, detail přes zbytek
 * výšky pravého. Poslední, pružný řádek mřížky (`1fr`) pobere výšku detailu,
 * takže dlouhý detail řádky seznamu neroztahuje.
 *
 * Rozhoduje šířka OKNA S OBSAHEM (`@container`), ne šířka prohlížeče: stejná
 * komponenta stojí v aplikaci vedle postranního panelu i v náhledu na úvodní
 * stránce.
 *
 * Vybraný je vždy právě jeden řádek. Přepnutí je okamžité, bez animace —
 * je to pracovní úkon, který člověk opakuje, ne přechod mezi místy.
 * Bez JavaScriptu zůstane otevřený výchozí detail; ostatní jsou ve zdroji
 * stránky skryté, ne vynechané.
 */
export function LimitsInspector({
  lead,
  aside,
  heading,
  entries,
  defaultKey,
  className,
}: {
  /** Levý sloupec nahoře: odpověď na „musím letos něco řešit?“. */
  lead?: React.ReactNode;
  /** Pravý sloupec nahoře: klíčová čísla. */
  aside?: React.ReactNode;
  /** Nadpis seznamu. */
  heading: React.ReactNode;
  entries: LimitEntry[];
  defaultKey?: string;
  className?: string;
}) {
  const baseId = useId();
  const [selected, setSelected] = useState(defaultKey ?? entries[0]?.key);
  const rows = useRef<Array<HTMLButtonElement | null>>([]);

  const move = (index: number, step: number) => {
    const next = entries[index + step];
    if (!next) return;
    setSelected(next.key);
    rows.current[index + step]?.focus();
  };

  const asideColumn =
    '@3xl:col-start-2 @3xl:border-l @3xl:border-line/70 @3xl:pl-(--column-gap)';

  return (
    <div className={cn('@container', className)}>
      <div
        className="@3xl:grid @3xl:grid-cols-[minmax(0,1fr)_minmax(0,var(--inspector-width))] @3xl:gap-x-(--column-gap)"
        style={{ gridTemplateRows: `auto auto repeat(${entries.length}, auto) 1fr` }}
      >
        <div className="@3xl:col-start-1 @3xl:row-start-1">{lead}</div>
        <div className={cn('@3xl:row-start-1', asideColumn)}>{aside}</div>
        <div className="@3xl:col-start-1 @3xl:row-start-2">{heading}</div>
        {entries.map((entry, index) => {
          const active = entry.key === selected;
          return (
            <Fragment key={entry.key}>
              <button
                ref={(node) => {
                  rows.current[index] = node;
                }}
                type="button"
                id={`${baseId}-row-${entry.key}`}
                aria-expanded={active}
                aria-controls={`${baseId}-detail-${entry.key}`}
                onClick={() => setSelected(entry.key)}
                onKeyDown={(event) => {
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
                  'row-pressable -mx-3 block w-[calc(100%+1.5rem)] rounded-xl px-3 py-3.5 text-left @3xl:col-start-1',
                  active ? 'bg-canvas' : 'hover:bg-canvas/60',
                )}
              >
                {entry.row}
              </button>
              <div
                id={`${baseId}-detail-${entry.key}`}
                role="region"
                aria-labelledby={`${baseId}-row-${entry.key}`}
                hidden={!active}
                className={cn('pb-6 pt-3 @3xl:py-0', asideColumn)}
                // nadpis + řádky + pružný řádek na konci (ten pobere výšku detailu)
                style={{ gridRow: `2 / span ${entries.length + 2}` }}
              >
                {entry.detail}
              </div>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
