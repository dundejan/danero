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

const ZONE_TEXT: Record<LimitStatus['zone'], string> = {
  OK: 'text-zelena',
  WARNING: 'text-jantar',
  CRITICAL: 'text-oranz',
  EXCEEDED: 'text-cervena',
};

const ZONE_LABEL: Record<LimitStatus['zone'], string> = {
  OK: 'v pořádku',
  WARNING: 'zvýšené čerpání',
  CRITICAL: 'těsně pod limitem',
  EXCEEDED: 'přes limit',
};

/** Pásmo z poměru čerpání — stejné prahy jako engine (60/85/100 %). */
export const zoneForRatio = (ratio: number): LimitStatus['zone'] =>
  ratio > 1 ? 'EXCEEDED' : ratio >= 0.85 ? 'CRITICAL' : ratio >= 0.6 ? 'WARNING' : 'OK';

/**
 * Vodorovný bar čerpání limitu (H4): dráha 0–100 % limitu, výplň barvou pásma,
 * svislá ryska na 100 %. Při přetečení se škála protáhne na 130 % — výplň se
 * zastaví na rysce a dál pokračuje šrafovaně červeně (poctivé „kolik přes").
 */
export function LimitBar({
  ratio,
  zone,
  animate = true,
  className,
}: {
  ratio: number;
  zone: LimitStatus['zone'];
  animate?: boolean;
  className?: string;
}) {
  const exceeded = zone === 'EXCEEDED';
  const scale = exceeded ? 1.3 : 1;
  const markPct = (1 / scale) * 100;
  const fillPct = (Math.min(ratio, 1) / scale) * 100;
  const overPct = exceeded ? ((Math.min(ratio, 1.3) - 1) / scale) * 100 : 0;

  return (
    <div
      className={cn('relative h-2.5 w-full overflow-hidden rounded-full bg-linka/40', className)}
    >
      <div
        className={cn('absolute inset-y-0 left-0 origin-left rounded-l-full', ZONE_COLOR[zone])}
        style={{
          width: `${fillPct}%`,
          animation: animate ? 'gauge-grow 700ms ease-out' : undefined,
        }}
      />
      {exceeded && overPct > 0 && (
        <div
          aria-hidden
          className="absolute inset-y-0"
          style={{
            left: `${markPct}%`,
            width: `${overPct}%`,
            background:
              'repeating-linear-gradient(135deg, var(--cervena) 0 4px, transparent 4px 8px)',
          }}
        />
      )}
      <div
        aria-hidden
        className="absolute inset-y-0 w-0.5 bg-inkoust/60"
        style={{ left: `calc(${markPct}% - 1px)` }}
      />
    </div>
  );
}

/** KPI karta limitu: hodnota/limit + procento se štítkem zóny nad barem. */
export function LimitGauge({
  label,
  hint,
  status,
}: {
  label: string;
  hint: string;
  status: LimitStatus;
}) {
  return (
    <Card className="space-y-1.5">
      <CardTitle>{label}</CardTitle>
      <p className="font-mono text-lg font-medium">
        {czk(status.usedCzk)}
        <span className="text-sm text-inkoust-tlumeny"> / {czk(status.limitCzk)}</span>
      </p>
      <p className={cn('text-sm font-semibold', ZONE_TEXT[status.zone])}>
        {Math.round(status.ratio * 100)} % · {ZONE_LABEL[status.zone]}
      </p>
      <LimitBar ratio={status.ratio} zone={status.zone} />
      <p className="pt-1 text-xs text-inkoust-tlumeny">{hint}</p>
    </Card>
  );
}
