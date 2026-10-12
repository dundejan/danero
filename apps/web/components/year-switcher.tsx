import { SegmentedControl } from '@/components/ui/segmented-control';

/**
 * Přepínač zdaňovacího období — segmentový přepínač v nástrojové liště.
 * Každý rok je odkaz (`?rok=`), takže funguje i bez JavaScriptu a adresa
 * vždy říká, na jaký rok se uživatel dívá.
 */
export function YearSwitcher({
  years,
  active,
  hrefBase,
  className,
}: {
  years: number[];
  active: number;
  hrefBase: string;
  className?: string;
}) {
  if (years.length <= 1) return null;
  return (
    <SegmentedControl
      kind="nav"
      ariaLabel="Zdaňovací období"
      value={String(active)}
      segments={years.map((year) => ({
        key: String(year),
        label: year,
        href: `${hrefBase}?rok=${year}`,
      }))}
      className={className}
    />
  );
}
