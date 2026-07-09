'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { HorizonDot } from '@/lib/charts-data';
import { MONTH_LABELS, plural } from '@/lib/format';

/**
 * Horizont osvobození v2 (docs/07 signatura, G3): časový pás s tečkami lotů
 * na datu osvobození. Velikost tečky = hodnota (známe-li ceny), jinak kusy;
 * klik vede na detail pozice; přepínač období místo nekonečně dlouhé osy.
 */

const RANGES = [
  { key: '1r', label: '1 rok', years: 1 },
  { key: '3r', label: '3 roky', years: 3 },
  { key: 'vse', label: 'vše', years: null },
] as const;

type RangeKey = (typeof RANGES)[number]['key'];

const monthLabel = (month: string): string => {
  const [y, m] = month.split('-');
  return `${MONTH_LABELS[Number(m) - 1] ?? m} ${y}`;
};

const dayNumber = (iso: string): number => new Date(`${iso}T00:00:00`).getTime() / 86_400_000;

export function HorizonStrip({ dots, today }: { dots: HorizonDot[]; today: string }) {
  const [range, setRange] = useState<RangeKey>('3r');

  const view = useMemo(() => {
    if (dots.length === 0) return null;
    const preset = RANGES.find((r) => r.key === range)!;
    const todayDay = dayNumber(today);
    // aritmeticky (ne skládáním data) — „29. 2. + rok“ by byl Invalid Date
    const horizonEnd = preset.years
      ? todayDay + preset.years * 365.25
      : Math.max(...dots.map((dot) => dayNumber(`${dot.exemptFrom}-01`)), todayDay);

    const visible = dots.filter((dot) => dayNumber(`${dot.exemptFrom}-01`) <= horizonEnd);
    const hidden = dots.length - visible.length;
    const minDay = Math.min(todayDay, ...visible.map((dot) => dayNumber(`${dot.exemptFrom}-01`)));
    const span = Math.max(60, horizonEnd - minDay);
    const pad = span * 0.06;
    const x = (day: number) => 40 + ((day - (minDay - pad)) / (span + 2 * pad)) * 920;
    const maxWeight = Math.max(...visible.map((dot) => dot.weight), 1);

    return { visible, hidden, todayX: x(todayDay), x, maxWeight };
  }, [dots, today, range]);

  if (!view) return null;
  const basis = dots[0]?.weightBasis === 'value' ? 'hodnotě' : 'počtu kusů';

  return (
    <section className="rounded-lg border border-linka bg-plocha p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-inkoust-tlumeny">
          Horizont osvobození
        </h2>
        <div className="flex items-center gap-1" role="group" aria-label="Období horizontu">
          {RANGES.map((preset) => (
            <button
              key={preset.key}
              type="button"
              onClick={() => setRange(preset.key)}
              aria-pressed={range === preset.key}
              className={`rounded-md px-2 py-0.5 font-mono text-xs ${
                range === preset.key
                  ? 'bg-ruzova font-semibold text-white'
                  : 'text-inkoust-tlumeny hover:text-inkoust'
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>
      <p className="mt-1 text-xs text-inkoust-tlumeny">
        Každá tečka = kusy jedné pozice a měsíce, kdy jim doběhne 3letý test. Velikost podle{' '}
        {basis}; kliknutím otevřeš detail pozice.
        {view.hidden > 0 &&
          ` Mimo zobrazené období: ${view.hidden} ${plural(view.hidden, 'tečka', 'tečky', 'teček')}.`}
      </p>

      {/* bez role="img" — tečky jsou odkazy a musí zůstat v accessibility tree */}
      <svg viewBox="0 0 1000 110" className="mt-3 w-full" aria-label="Horizont osvobození">
        <line x1="40" y1="70" x2="960" y2="70" stroke="var(--linka)" strokeWidth="2" />
        <line
          x1={view.todayX}
          y1="18"
          x2={view.todayX}
          y2="92"
          stroke="var(--ruzova)"
          strokeWidth="2"
        />
        <text
          x={view.todayX + 6}
          y="28"
          fontSize="12"
          fill="var(--ruzova)"
          fontFamily="var(--font-plex-mono)"
        >
          dnes
        </text>
        {view.visible.map((dot, index) => {
          const cx = view.x(dayNumber(`${dot.exemptFrom}-01`));
          const r = 3 + Math.sqrt(dot.weight / view.maxWeight) * 7;
          return (
            <Link key={`${dot.isin}|${dot.exemptFrom}`} href={`/portfolio/${dot.isin}`}>
              <circle
                cx={cx}
                cy="70"
                r={r}
                fill={dot.isExempt ? 'var(--zelena)' : 'var(--inkoust-tlumeny)'}
                fillOpacity="0.85"
                stroke="var(--plocha)"
                strokeWidth="1.5"
                className="cursor-pointer hover:fill-[var(--ruzova)]"
                style={{ animation: `dot-in 0.3s ease-out ${Math.min(index, 40) * 25}ms both` }}
              >
                <title>
                  {`${dot.label}: ${dot.quantity.toLocaleString('cs-CZ')} ks — ${
                    dot.isExempt ? 'už bez daně' : `bez daně od ${monthLabel(dot.exemptFrom)}`
                  }`}
                </title>
              </circle>
            </Link>
          );
        })}
      </svg>

      <div className="flex gap-4 text-xs text-inkoust-tlumeny">
        <span className="flex items-center gap-1">
          <span className="inline-block size-2 rounded-full bg-zelena" /> osvobozené
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block size-2 rounded-full bg-inkoust-tlumeny" /> čekající
        </span>
      </div>
    </section>
  );
}
