import Link from 'next/link';
import { cn } from '@/lib/utils';

export function YearSwitcher({
  years,
  active,
  hrefBase,
}: {
  years: number[];
  active: number;
  hrefBase: string;
}) {
  if (years.length <= 1) return null;
  return (
    <nav className="flex flex-wrap gap-1" aria-label="Zdaňovací období">
      {years.map((year) => (
        <Link
          key={year}
          href={`${hrefBase}?rok=${year}`}
          className={cn(
            'rounded-md px-3 py-1 font-mono text-sm',
            year === active
              ? 'bg-ruzova-syta font-semibold text-white'
              : 'text-inkoust-tlumeny hover:text-inkoust',
          )}
        >
          {year}
        </Link>
      ))}
    </nav>
  );
}
