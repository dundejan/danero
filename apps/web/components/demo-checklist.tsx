'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

/**
 * Naváděcí checklist prohlídky dema: tenký pruh pod bannerem se třemi kroky,
 * které mají návštěvníkovi ukázat to nejlepší. Aktuální krok se zvýrazní;
 * na poslední stránce (report) vede závěrečný krok na registraci.
 */
const STEPS = [
  { href: '/demo/prehled', label: 'Horizont osvobození — najeď na tečky' },
  { href: '/demo/simulator', label: 'Simulátor — prodej nanečisto' },
  { href: '/demo/report', label: 'Report — podklady k přiznání' },
] as const;

export function DemoChecklist() {
  const pathname = usePathname();
  const onReport = pathname.startsWith('/demo/report');

  return (
    <nav
      aria-label="Prohlídka dema"
      className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-b border-linka bg-plocha px-4 py-2 text-xs text-inkoust-tlumeny md:px-6"
    >
      <span aria-hidden className="font-mono font-semibold uppercase tracking-wide">
        Vyzkoušej si:
      </span>
      <ol className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        {STEPS.map((krok, index) => {
          const last = index === STEPS.length - 1;
          // na reportu je prohlídka u konce — poslední krok vede na registraci
          const target = last && onReport ? '/registrace' : krok.href;
          const text = last && onReport ? 'Hotovo? Založ si účet' : krok.label;
          const active = pathname.startsWith(krok.href) && target === krok.href;
          return (
            <li key={krok.href} className="flex items-baseline gap-x-2">
              {index > 0 && <span aria-hidden>·</span>}
              <Link
                href={target}
                className={cn(
                  'hover:text-ruzova',
                  active ? 'font-semibold text-ruzova' : 'font-medium',
                )}
              >
                <span className="font-mono">{index + 1}.</span> {text}
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
