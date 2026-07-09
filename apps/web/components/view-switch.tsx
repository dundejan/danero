'use client';

import { useState, type ReactNode } from 'react';

/**
 * Sdílený přepínač pohledů (H4): segmented control ve stylu horizon-strip.
 * Obsah pohledů přichází jako server-rendered ReactNode (sloty) — komponenta
 * drží jen malý klientský stav „který pohled". Bez JS se vykreslí default.
 */
export interface View {
  key: string;
  label: string;
  content: ReactNode;
}

export function ViewSwitch({
  views,
  defaultKey,
  title,
  ariaLabel,
}: {
  views: View[];
  defaultKey: string;
  /** Volitelný jednotný nadpis sekce (styl CardTitle) vlevo od přepínače. */
  title?: string;
  ariaLabel?: string;
}) {
  const [active, setActive] = useState(defaultKey);
  const current = views.find((view) => view.key === active) ?? views[0];

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        {title ? (
          <h2 className="text-sm font-semibold uppercase tracking-wide text-inkoust-tlumeny">
            {title}
          </h2>
        ) : (
          <span aria-hidden />
        )}
        <div
          className="flex items-center gap-1"
          role="group"
          aria-label={ariaLabel ?? 'Přepínač zobrazení'}
        >
          {views.map((view) => (
            <button
              key={view.key}
              type="button"
              onClick={() => setActive(view.key)}
              aria-pressed={view.key === current?.key}
              className={`rounded-md px-2 py-0.5 font-mono text-xs ${
                view.key === current?.key
                  ? 'bg-ruzova-syta font-semibold text-white'
                  : 'text-inkoust-tlumeny hover:text-inkoust'
              }`}
            >
              {view.label}
            </button>
          ))}
        </div>
      </div>
      {/* neaktivní pohledy jen skrýt (hidden), ne odmountovat — přepnutí tak
          nezahazuje klientský stav (rozsah horizontu) a nepřehrává animace */}
      {views.map((view) => (
        <div key={view.key} className="mt-3" hidden={view.key !== current?.key}>
          {view.content}
        </div>
      ))}
    </div>
  );
}
