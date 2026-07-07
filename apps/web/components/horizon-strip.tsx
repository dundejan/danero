import type { Position } from '@danero/engine';
import { diffDays } from '@danero/shared';
import { czDate } from '@/lib/format';
import { Card, CardTitle } from '@/components/ui/card';

interface Dot {
  isin: string;
  label: string;
  exemptFrom: string;
  quantity: number;
  isExempt: boolean;
}

/**
 * Signatura Danera (docs/07): časový pás, po kterém loty putují k růžové linii
 * dneška. Nalevo (zelené) už jsou osvobozené, napravo čekají. Seskupeno po
 * (ISIN, měsíc osvobození), velikost tečky ~ √množství.
 */
export function HorizonStrip({
  positions,
  labels,
  today,
}: {
  positions: Position[];
  labels: Map<string, string>;
  today: string;
}) {
  const dots = new Map<string, Dot>();
  for (const position of positions) {
    for (const lot of position.lots) {
      const month = lot.exemptFrom.slice(0, 7);
      const key = `${position.isin}|${month}`;
      const existing = dots.get(key);
      if (existing) {
        existing.quantity += lot.remaining.toNumber();
        if (lot.exemptFrom < existing.exemptFrom) existing.exemptFrom = lot.exemptFrom;
        existing.isExempt = existing.isExempt || lot.isExempt;
      } else {
        dots.set(key, {
          isin: position.isin,
          label: labels.get(position.isin) ?? position.isin,
          exemptFrom: lot.exemptFrom,
          quantity: lot.remaining.toNumber(),
          isExempt: lot.isExempt,
        });
      }
    }
  }
  const items = [...dots.values()];
  if (items.length === 0) return null;

  const dates = items.map((d) => d.exemptFrom).concat(today);
  const min = dates.reduce((a, b) => (a < b ? a : b));
  const max = dates.reduce((a, b) => (a > b ? a : b));
  const span = Math.max(60, diffDays(min, max));
  const pad = span * 0.06;
  const x = (date: string): number =>
    40 + ((diffDays(min, date) + pad) / (span + 2 * pad)) * 920;
  const maxQty = Math.max(...items.map((d) => d.quantity));
  const radius = (quantity: number): number => 3 + Math.sqrt(quantity / maxQty) * 6;

  const todayX = x(today);

  return (
    <Card className="space-y-3">
      <div className="flex items-baseline justify-between">
        <CardTitle>Horizont osvobození</CardTitle>
        <p className="text-xs text-inkoust-tlumeny">
          <span className="mr-3 inline-flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full bg-zelena" /> osvobozené
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full bg-inkoust-tlumeny" /> čekající
          </span>
        </p>
      </div>
      <svg viewBox="0 0 1000 110" className="h-28 w-full" role="img" aria-label="Časová osa osvobození pozic">
        <line x1="40" y1="60" x2="960" y2="60" stroke="var(--linka)" strokeWidth="1" />
        <line x1={todayX} y1="14" x2={todayX} y2="96" stroke="var(--ruzova)" strokeWidth="2" />
        <text
          x={todayX}
          y="10"
          textAnchor="middle"
          fill="var(--ruzova)"
          style={{ font: '600 11px var(--font-plex-mono), monospace' }}
        >
          dnes
        </text>
        {items.map((dot) => (
          <circle
            key={`${dot.isin}-${dot.exemptFrom}`}
            cx={x(dot.exemptFrom)}
            cy={60}
            r={radius(dot.quantity)}
            fill={dot.isExempt ? 'var(--zelena)' : 'var(--inkoust-tlumeny)'}
            opacity={0.85}
          >
            <title>
              {`${dot.label}: ${dot.quantity.toFixed(2)} ks — bez daně od ${czDate(dot.exemptFrom)}`}
            </title>
          </circle>
        ))}
        <text
          x="960"
          y="96"
          textAnchor="end"
          fill="var(--inkoust-tlumeny)"
          style={{ font: '10px var(--font-plex-mono), monospace' }}
        >
          {czDate(max)}
        </text>
        <text
          x="40"
          y="96"
          fill="var(--inkoust-tlumeny)"
          style={{ font: '10px var(--font-plex-mono), monospace' }}
        >
          {czDate(min)}
        </text>
      </svg>
    </Card>
  );
}
