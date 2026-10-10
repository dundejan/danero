import Link from 'next/link';
import { cn } from '@/lib/utils';

/**
 * Mobilní řádek pozice: sdílený markup pro seznamy pozic na přehledu
 * i v portfoliu (`md:hidden` náhrada tabulky). Bez rámečku — řádky dělí
 * vlásová linka rodiče a stisk řádek zvýrazní. Server component — dostává
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
      className="row-pressable -mx-2 block rounded-lg px-2 py-3"
    >
      <div className="flex items-baseline justify-between gap-3">
        <p className="min-w-0">
          <span className="font-medium text-ink">{label}</span>
          {name && <span className="block truncate text-xs text-ink-muted">{name}</span>}
        </p>
        <p className="shrink-0 text-right">
          <span className="tabular-nums text-sm font-semibold">{primaryText}</span>
          {secondaryText && (
            <span className="block tabular-nums text-xs text-ink-muted">{secondaryText}</span>
          )}
        </p>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
        <span
          className={cn(
            'font-medium',
            exemptDone ? 'font-semibold text-success-text' : 'text-ink-muted',
          )}
        >
          {exemptText}
        </span>
        {pl && (
          <span
            className={cn(
              'tabular-nums font-medium',
              pl.positive ? 'text-success-text' : 'text-danger',
            )}
          >
            {pl.text}
          </span>
        )}
      </div>
    </Link>
  );
}
