'use client';

import { useState, type ReactNode } from 'react';
import { SectionHeader } from '@/components/ui/section';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { cn } from '@/lib/utils';

export interface Variant {
  key: string;
  /** Popisek segmentu; v tisku zároveň nadpis varianty. */
  label: string;
  content: ReactNode;
}

/**
 * Přepínač variant téhož výpočtu (obecný × samostatný základ, jednotný ×
 * denní kurz). Od `ViewSwitch` se liší tiskem: na obrazovce je vidět jedna
 * varianta, na papíře všechny pod sebou a každá s vlastním nadpisem —
 * vytištěný podklad je dokument a přepínat v něm nejde.
 *
 * Obsah variant přichází vykreslený ze serveru; komponenta drží jen stav
 * „která je vidět“. Bez JavaScriptu se ukáže výchozí.
 */
export function VariantSwitch({
  title,
  headingAs = 'h3',
  info,
  ariaLabel,
  variants,
  defaultKey,
  className,
}: {
  title: string;
  headingAs?: 'h2' | 'h3';
  /** `InfoPopover` za nadpisem. */
  info?: ReactNode;
  ariaLabel: string;
  variants: Variant[];
  defaultKey: string;
  className?: string;
}) {
  const [active, setActive] = useState(defaultKey);
  const current = variants.find((variant) => variant.key === active) ?? variants[0];

  return (
    <div className={className}>
      <SectionHeader
        as={headingAs}
        title={title}
        info={info}
        actions={
          variants.length > 1 && (
            <span className="print:hidden">
              <SegmentedControl
                ariaLabel={ariaLabel}
                value={current?.key ?? defaultKey}
                onChange={setActive}
                segments={variants.map((variant) => ({ key: variant.key, label: variant.label }))}
              />
            </span>
          )
        }
      />
      {variants.map((variant) => (
        <div
          key={variant.key}
          className={cn('mt-4', variant.key !== current?.key && 'hidden print:block')}
        >
          {variants.length > 1 && (
            <p className="type-callout mb-1 hidden font-semibold print:block">{variant.label}</p>
          )}
          {variant.content}
        </div>
      ))}
    </div>
  );
}
