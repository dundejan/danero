import Link from 'next/link';
import { cn } from '@/lib/utils';

/**
 * Řádek pozice v seznamu na telefonu — sdílený přehledem i portfoliem
 * (náhrada tabulky v úzkém okně). Dva řádky textu: vlevo název, vpravo hlavní
 * číslo a pod ním stav časového testu. Celý řádek je odkaz na detail pozice,
 * šipka to naznačuje. Bez rámečku — řádky dělí vlásová linka rodiče a stisk
 * řádek zvýrazní. Server component — dostává už naformátované texty, žádné
 * Decimal v props.
 *
 * Název se smí zalomit na dva řádky: u pozice bez tickeru (Degiro, univerzální
 * šablona) je popiskem celý název fondu a na jednom řádku z něj zbylo „Amu…“
 * (R2-02). Když se název vedle čísla nevejde ani tak (velké písmo), spadne
 * číslo pod něj — název nesmí zmizet (R2-07).
 */
export function PositionCard({
  isin,
  label,
  name,
  primaryText,
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
  /** Stav časového testu: „vše bez daně“ / „40,5 ks bez daně“ / „bez daně od …“. */
  exemptText: string;
  /** Aspoň část pozice už je bez daně — text je zelený. */
  exemptDone: boolean;
}) {
  return (
    <Link
      href={`${basePath}/portfolio/${isin}`}
      className="row-pressable -mx-2 flex min-h-11 items-center gap-3 rounded-lg px-2 py-3"
    >
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
        <span className="min-w-[min(8rem,100%)] flex-1">
          <span className="line-clamp-2 font-medium text-ink [overflow-wrap:anywhere]">
            {label}
          </span>
          {name && <span className="type-footnote block truncate text-ink-muted">{name}</span>}
        </span>
        <span className="ml-auto text-right">
          <span className="block font-medium tabular-nums">{primaryText}</span>
          <span
            className={cn(
              'type-footnote block tabular-nums',
              exemptDone ? 'text-success-text' : 'text-ink-muted',
            )}
          >
            {exemptText}
          </span>
        </span>
      </span>
      <span aria-hidden className="text-ink-muted">
        ›
      </span>
    </Link>
  );
}
