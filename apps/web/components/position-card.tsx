import Link from 'next/link';
import { cn } from '@/lib/utils';

/**
 * Mobilní karta pozice (H4): sdílený markup pro seznamy pozic na přehledu
 * i v portfoliu (`md:hidden` náhrada tabulky). Server component — dostává
 * už naformátované texty, žádné Decimal v props.
 */
export function PositionCard({
  isin,
  label,
  name,
  primaryText,
  secondaryText,
  pl,
  exemptText,
  exemptDone,
  basePath = '',
}: {
  isin: string;
  label: string;
  name?: string;
  /** Prefix odkazu na detail pozice ('' pro aplikaci, '/demo' pro demo). */
  basePath?: string;
  /** Hlavní hodnota vpravo nahoře — hodnota v Kč, nebo počet kusů. */
  primaryText: string;
  /** Doplněk pod hlavní hodnotou (např. počet kusů, když primární je Kč). */
  secondaryText?: string;
  /** Nerealizovaný zisk/ztráta jako badge (semafor podle polarity). */
  pl?: { text: string; positive: boolean } | null;
  /** „bez daně od …“ / „vše bez daně“. */
  exemptText: string;
  exemptDone: boolean;
}) {
  return (
    <Link
      href={`${basePath}/portfolio/${isin}`}
      className="block rounded-md border border-linka p-3 hover:border-inkoust-tlumeny"
    >
      <div className="flex items-baseline justify-between gap-3">
        <p className="min-w-0">
          <span className="font-medium text-inkoust">{label}</span>
          {name && <span className="block truncate text-xs text-inkoust-tlumeny">{name}</span>}
        </p>
        <p className="shrink-0 text-right">
          <span className="font-mono text-sm font-semibold">{primaryText}</span>
          {secondaryText && (
            <span className="block font-mono text-xs text-inkoust-tlumeny">{secondaryText}</span>
          )}
        </p>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
        <span
          className={cn(
            'font-medium',
            exemptDone ? 'font-semibold text-zelena' : 'text-inkoust-tlumeny',
          )}
        >
          {exemptText}
        </span>
        {pl && (
          <span
            className={cn(
              'rounded-md px-1.5 py-0.5 font-mono font-semibold',
              pl.positive ? 'bg-zelena/10 text-zelena' : 'bg-cervena/10 text-cervena',
            )}
          >
            {pl.text}
          </span>
        )}
      </div>
    </Link>
  );
}
