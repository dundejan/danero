'use client';

import { useState, type ReactNode } from 'react';
import { SectionHeader } from '@/components/ui/section';
import { SegmentedControl } from '@/components/ui/segmented-control';

/**
 * Sdílený přepínač pohledů: hlavička sekce (titulek, vysvětlivka) vlevo,
 * segmentový přepínač vpravo. Obsah pohledů přichází jako server-rendered
 * ReactNode (sloty) — komponenta drží jen malý klientský stav „který pohled“.
 * Bez JS se vykreslí default.
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
  info,
  ariaLabel,
}: {
  views: View[];
  defaultKey: string;
  /** Volitelný nadpis sekce vlevo od přepínače. */
  title?: string;
  /** `InfoPopover` za nadpisem. */
  info?: ReactNode;
  ariaLabel?: string;
}) {
  const [active, setActive] = useState(defaultKey);
  const current = views.find((view) => view.key === active) ?? views[0];
  const control = (
    <SegmentedControl
      ariaLabel={ariaLabel ?? 'Přepínač zobrazení'}
      value={current?.key ?? defaultKey}
      onChange={setActive}
      segments={views.map((view) => ({ key: view.key, label: view.label }))}
    />
  );

  return (
    <div>
      {title ? (
        <SectionHeader title={title} info={info} actions={control} />
      ) : (
        <div className="flex justify-end">{control}</div>
      )}
      {/* neaktivní pohledy jen skrýt (hidden), ne odmountovat — přepnutí tak
          nezahazuje klientský stav (rozsah horizontu) a nepřehrává animace */}
      {views.map((view) => (
        <div key={view.key} className="mt-4" hidden={view.key !== current?.key}>
          {view.content}
        </div>
      ))}
    </div>
  );
}
