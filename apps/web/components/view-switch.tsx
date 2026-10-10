'use client';

import { useState, type ReactNode } from 'react';
import { SegmentedControl } from '@/components/ui/segmented-control';

/**
 * Sdílený přepínač pohledů: nadpis sekce vlevo, segmentový přepínač vpravo.
 * Obsah pohledů přichází jako server-rendered ReactNode (sloty) — komponenta
 * drží jen malý klientský stav „který pohled“. Bez JS se vykreslí default.
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
  /** Volitelný nadpis sekce vlevo od přepínače. */
  title?: string;
  ariaLabel?: string;
}) {
  const [active, setActive] = useState(defaultKey);
  const current = views.find((view) => view.key === active) ?? views[0];

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        {title ? <h2 className="type-title-2">{title}</h2> : <span aria-hidden />}
        <SegmentedControl
          ariaLabel={ariaLabel ?? 'Přepínač zobrazení'}
          value={current?.key ?? defaultKey}
          onChange={setActive}
          segments={views.map((view) => ({ key: view.key, label: view.label }))}
        />
      </div>
      {/* neaktivní pohledy jen skrýt (hidden), ne odmountovat — přepnutí tak
          nezahazuje klientský stav (rozsah horizontu) a nepřehrává animace */}
      {views.map((view) => (
        <div key={view.key} className="mt-5" hidden={view.key !== current?.key}>
          {view.content}
        </div>
      ))}
    </div>
  );
}
