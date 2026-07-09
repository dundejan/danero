import type { LimitStatus } from '@danero/engine';
import { czk } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Card, CardTitle } from '@/components/ui/card';

const ZONE_COLOR: Record<LimitStatus['zone'], string> = {
  OK: 'bg-zelena',
  WARNING: 'bg-jantar',
  CRITICAL: 'bg-oranz',
  EXCEEDED: 'bg-cervena',
};

const ZONE_LABEL: Record<LimitStatus['zone'], string> = {
  OK: 'v pořádku',
  WARNING: 'zvýšené čerpání',
  CRITICAL: 'těsně pod limitem',
  EXCEEDED: 'přes limit',
};

/** „Odměrka“ — svislý sloupec s ryskami 60/85/100 % (docs/07-design.md). */
export function LimitGauge({
  label,
  hint,
  status,
}: {
  label: string;
  hint: string;
  status: LimitStatus;
}) {
  const fill = Math.min(1, status.ratio);
  return (
    <Card className="flex gap-4">
      <div className="relative h-36 w-8 shrink-0 overflow-hidden rounded-md border border-linka bg-pozadi">
        <div
          className={cn('absolute inset-x-0 bottom-0 origin-bottom', ZONE_COLOR[status.zone])}
          style={{ height: `${fill * 100}%`, animation: 'gauge-grow 700ms ease-out' }}
        />
        {[0.6, 0.85].map((tick) => (
          <div
            key={tick}
            className="absolute inset-x-0 border-t border-dashed border-inkoust-tlumeny/40"
            style={{ bottom: `${tick * 100}%` }}
          />
        ))}
        <div className="absolute inset-x-0 top-0 border-t-2 border-inkoust/60" />
      </div>
      <div className="min-w-0 space-y-1">
        <CardTitle>{label}</CardTitle>
        <p className="font-mono text-lg font-medium">
          {czk(status.usedCzk)}
          <span className="text-sm text-inkoust-tlumeny"> / {czk(status.limitCzk)}</span>
        </p>
        <p
          className={cn(
            'text-sm font-semibold',
            status.zone === 'OK' && 'text-zelena',
            status.zone === 'WARNING' && 'text-jantar',
            status.zone === 'CRITICAL' && 'text-oranz',
            status.zone === 'EXCEEDED' && 'text-cervena',
          )}
        >
          {Math.round(status.ratio * 100)} % · {ZONE_LABEL[status.zone]}
        </p>
        <p className="text-xs text-inkoust-tlumeny">{hint}</p>
      </div>
    </Card>
  );
}
