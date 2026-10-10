'use client';

import Link from 'next/link';
import { motion } from 'motion/react';
import { useId } from 'react';
import { SPRING_DEFAULT } from '@/lib/motion';
import { cn } from '@/lib/utils';

export interface Segment {
  key: string;
  label: React.ReactNode;
  /** Přístupný název, když `label` není text (ikona) nebo je zkrácený. */
  ariaLabel?: string;
  /** Segment jako odkaz (přepínač roku mění adresu, ne stav komponenty). */
  href?: string;
}

/**
 * Segmentový přepínač: šedá dráha, bílý palec, který se mezi segmenty přesune
 * kriticky tlumenou pružinou (žádný překmit — nic ho nevrhlo). Palec je jediný
 * prvek sdílený přes `layoutId`, takže přechod jde přerušit dalším klepnutím
 * a naváže z místa, kde zrovna je.
 *
 * Cíl dotyku: viditelná výška je 28 px (32 px pro prst), ale klikací plocha
 * segmentu je pseudo-prvkem natažená na 44 px — tak, jak to dělá systém.
 */
export function SegmentedControl({
  segments,
  value,
  onChange,
  ariaLabel,
  kind = 'toggle',
  className,
}: {
  segments: Segment[];
  value: string;
  onChange?: (key: string) => void;
  ariaLabel: string;
  /**
   * `toggle` — tlačítka s `aria-pressed` (přepnutí pohledu na stránce);
   * `nav` — odkazy s `aria-current` (každý segment je jiná adresa).
   */
  kind?: 'toggle' | 'nav';
  className?: string;
}) {
  const thumbId = useId();
  const Wrapper = kind === 'nav' ? 'nav' : 'div';

  return (
    <Wrapper
      role={kind === 'nav' ? undefined : 'group'}
      aria-label={ariaLabel}
      className={cn(
        // Bez `overflow`: ořízl by klikací plochy segmentů, které dráhu svisle
        // přesahují. Kdo čeká víc segmentů, než se vejde (roky v liště), dává
        // přepínač do vlastního vodorovně posuvného obalu.
        'inline-flex h-7 shrink-0 items-stretch rounded-lg bg-control p-0.5 pointer-coarse:h-8',
        className,
      )}
    >
      {segments.map((segment) => {
        const active = segment.key === value;
        const content = (
          <>
            {active && (
              <motion.span
                layoutId={thumbId}
                transition={SPRING_DEFAULT}
                className="absolute inset-0 rounded-[7px] bg-surface shadow-thumb dark:bg-line-control/60"
                aria-hidden
              />
            )}
            <span className="relative">{segment.label}</span>
          </>
        );
        const itemClass = cn(
          'relative inline-flex min-w-11 flex-1 items-center justify-center whitespace-nowrap rounded-[7px] px-3 text-[0.8125rem] leading-none tabular-nums',
          // klikací plocha 44 px na výšku bez změny vzhledu
          'after:absolute after:inset-x-0 after:-inset-y-2 pointer-coarse:after:-inset-y-1.5',
          active ? 'font-semibold text-ink' : 'font-medium text-ink active:opacity-60',
        );
        return segment.href ? (
          <Link
            key={segment.key}
            href={segment.href}
            aria-label={segment.ariaLabel}
            aria-current={active ? 'page' : undefined}
            className={itemClass}
            // přepnutí roku nemá odskočit na začátek stránky
            scroll={false}
          >
            {content}
          </Link>
        ) : (
          <button
            key={segment.key}
            type="button"
            aria-label={segment.ariaLabel}
            title={segment.ariaLabel}
            aria-pressed={active}
            onClick={() => onChange?.(segment.key)}
            className={itemClass}
          >
            {content}
          </button>
        );
      })}
    </Wrapper>
  );
}
