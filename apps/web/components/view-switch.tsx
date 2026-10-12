'use client';

import { useState, type ReactNode } from 'react';
import { SectionHeader } from '@/components/ui/section';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { cn } from '@/lib/utils';

/**
 * Sdílený přepínač pohledů na tatáž data (graf × tabulka) nebo variant téhož
 * výpočtu (obecný × samostatný základ, jednotný × denní kurz): hlavička sekce
 * (titulek, vysvětlivka) vlevo, segmentový přepínač vpravo. Obsah pohledů
 * přichází vykreslený ze serveru (sloty) — komponenta drží jen malý klientský
 * stav „který pohled“. Bez JavaScriptu se ukáže výchozí.
 *
 * Tisk: na obrazovce je vidět jeden pohled, na papíře všechny pod sebou
 * a každý pod svým popiskem — vytištěná stránka je dokument a přepínat v ní
 * nejde. S jediným pohledem se přepínač ani popisek nekreslí.
 */
export interface View {
  key: string;
  /** Popisek segmentu; v tisku zároveň nadpis pohledu. */
  label: string;
  content: ReactNode;
}

export function ViewSwitch({
  views,
  defaultKey,
  title,
  headingAs,
  info,
  ariaLabel,
  className,
}: {
  views: View[];
  defaultKey: string;
  /** Volitelný nadpis sekce vlevo od přepínače. */
  title?: string;
  headingAs?: 'h2' | 'h3';
  /** `InfoPopover` za nadpisem. */
  info?: ReactNode;
  ariaLabel?: string;
  className?: string;
}) {
  const [active, setActive] = useState(defaultKey);
  const current = views.find((view) => view.key === active) ?? views[0];
  const several = views.length > 1;
  const control = several && (
    // `min-w-0 max-w-full`: přepínač s dlouhými popisky se v úzké sekci smí
    // smrštit a posouvat uvnitř, místo aby sekci roztáhl
    <div className="flex max-w-full min-w-0 print:hidden">
      <SegmentedControl
        ariaLabel={ariaLabel ?? 'Přepínač zobrazení'}
        value={current?.key ?? defaultKey}
        onChange={setActive}
        segments={views.map((view) => ({ key: view.key, label: view.label }))}
      />
    </div>
  );

  return (
    <div className={className}>
      {title ? (
        <SectionHeader as={headingAs} title={title} info={info} actions={control} />
      ) : (
        <div className="flex justify-end">{control}</div>
      )}
      {/* neaktivní pohledy jen skrýt, ne odmountovat — přepnutí tak nezahazuje
          klientský stav (rozsah horizontu) a nepřehrává animace */}
      {views.map((view) => (
        <div
          key={view.key}
          className={cn('mt-4', view.key !== current?.key && 'hidden print:block')}
        >
          {several && (
            <p className="type-callout mb-1 hidden font-semibold print:block">{view.label}</p>
          )}
          {view.content}
        </div>
      ))}
    </div>
  );
}
