import { cn } from '@/lib/utils';

/**
 * Klíčové číslo: tichý popisek, pod ním číslo, pod ním nejvýš pár slov.
 * Vysvětlení („jak se to počítá“) patří do `info` (`InfoPopover` za popiskem),
 * ne do odstavce pod číslem. `note` je místo pro krátkou výhradu, která
 * zmizet nesmí („orientačně, jen z investic“), nebo pro kontext čísla
 * („z 50 000 Kč“).
 *
 * Skupinu čísel vedle sebe obal do `<dl className="…">` — `Stat` je dvojice
 * `dt`/`dd`. Velikost `lg` má na stránce nejvýš jedno až dvě čísla.
 */
export function Stat({
  label,
  value,
  note,
  info,
  size = 'md',
  tone,
  className,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  note?: React.ReactNode;
  info?: React.ReactNode;
  size?: 'md' | 'lg';
  /** Barva čísla, když samo nese stav (překročený limit). */
  tone?: 'danger' | 'success';
  className?: string;
}) {
  return (
    // `data-info-anchor`: vysvětlivka se otevře pod celým blokem, ne přes číslo
    <div data-info-anchor className={className}>
      {/* `min-h-6` = výška tlačítka vysvětlivky: popisek s „i“ a bez něj jsou
          stejně vysoké, takže čísla vedle sebe stojí na jedné lince */}
      <dt className="type-footnote flex min-h-6 items-center gap-1 text-ink-muted">
        {label}
        {info}
      </dt>
      <dd
        className={cn(
          'mt-1',
          size === 'lg' ? 'type-figure-lg' : 'type-figure',
          tone === 'danger' && 'text-danger',
          tone === 'success' && 'text-success-text',
        )}
      >
        {value}
      </dd>
      {note && <dd className="type-footnote mt-1 text-ink-muted">{note}</dd>}
    </div>
  );
}
