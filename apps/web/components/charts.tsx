'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type {
  DividendsByMonth,
  ExemptionOutlook,
  LimitSeries,
  YearBar,
} from '@/lib/charts-data';
import { MONTH_LABELS } from '@/lib/format';

/**
 * Grafy G3 (Recharts, 'use client'). Barvy výhradně z design tokenů:
 * kategorické série --graf-1..4 (validované pořadí), semafor jen pro
 * stav/polaritu (zisk/ztráta, pásma limitů). Mřížka a osy ustupují datům.
 */

const SERIES = ['var(--graf-1)', 'var(--graf-2)', 'var(--graf-3)', 'var(--graf-4)'];

const czkCompact = (value: number): string =>
  new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 0 }).format(value) + ' Kč';

const czkAxis = (value: number): string => {
  const abs = Math.abs(value);
  const sign = value < 0 ? '−' : '';
  if (abs >= 1_000_000)
    return `${sign}${(abs / 1_000_000).toLocaleString('cs-CZ', { maximumFractionDigits: 1 })} mil.`;
  if (abs >= 1_000) return `${sign}${Math.round(abs / 1_000)} tis.`;
  return `${sign}${Math.round(abs)}`;
};

const monthLabel = (isoMonth: string): string => MONTH_LABELS[Number(isoMonth.slice(5, 7)) - 1] ?? isoMonth;

const dateLabel = (iso: string): string =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric' });

/** ISO datum → ms (UTC) pro časovou osu — kategorická osa by zkreslila rozestupy. */
const toMs = (iso: string): number => Date.parse(`${iso}T00:00:00Z`);

const msLabel = (ms: number): string =>
  new Date(ms).toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric' });

const axisProps = {
  tick: { fill: 'var(--inkoust-tlumeny)', fontSize: 11, fontFamily: 'var(--font-mono)' },
  axisLine: { stroke: 'var(--linka)' },
  tickLine: false as const,
};

function TooltipBox({ title, rows }: { title: string; rows: Array<{ color?: string; name: string; value: string }> }) {
  return (
    <div className="rounded-md border border-linka bg-plocha px-3 py-2 text-xs shadow-sm">
      <p className="mb-1 font-semibold text-inkoust">{title}</p>
      {rows.map((row) => (
        <p key={row.name} className="flex items-center gap-2 font-mono text-inkoust-tlumeny">
          {row.color && (
            <span className="inline-block size-2 rounded-full" style={{ background: row.color }} />
          )}
          <span>{row.name}</span>
          <span className="ml-auto pl-3 text-inkoust">{row.value}</span>
        </p>
      ))}
    </div>
  );
}

/* ── Čerpání limitu v průběhu roku ──────────────────────────────────────── */

export function LimitDrawdownChart({ series, name }: { series: LimitSeries; name: string }) {
  const year = Number(series.points[0]?.date.slice(0, 4));
  // řadu dovedeme do konce roku, ať čára nekončí v půlce plátna
  const points = [
    ...series.points,
    { date: `${year}-12-31`, value: series.points[series.points.length - 1]?.value ?? 0 },
  ].map((point) => ({ ...point, t: toMs(point.date) }));
  const max = Math.max(series.limitCzk * 1.08, series.usedCzk * 1.05);
  const monthTicks = Array.from({ length: 12 }, (_, m) => Date.UTC(year, m, 1));

  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={points} margin={{ top: 8, right: 12, bottom: 0, left: 8 }}>
        <CartesianGrid stroke="var(--linka)" strokeDasharray="2 4" vertical={false} />
        <XAxis
          {...axisProps}
          type="number"
          dataKey="t"
          domain={[Date.UTC(year, 0, 1), Date.UTC(year, 11, 31)]}
          ticks={monthTicks}
          tickFormatter={(ms: number) => MONTH_LABELS[new Date(ms).getUTCMonth()]!}
          minTickGap={20}
        />
        <YAxis {...axisProps} tickFormatter={czkAxis} width={52} domain={[0, max]} />
        <ReferenceLine
          y={series.limitCzk}
          stroke="var(--cervena)"
          strokeDasharray="4 4"
          label={{ value: 'limit', fill: 'var(--cervena)', fontSize: 10, position: 'insideTopRight' }}
        />
        <ReferenceLine y={series.limitCzk * 0.85} stroke="var(--oranz)" strokeDasharray="2 4" />
        <ReferenceLine y={series.limitCzk * 0.6} stroke="var(--jantar)" strokeDasharray="2 4" />
        <Tooltip
          content={({ active, payload }) =>
            active && payload?.[0] ? (
              <TooltipBox
                title={dateLabel(String(payload[0].payload.date))}
                rows={[{ name, value: czkCompact(Number(payload[0].value)), color: SERIES[0] }]}
              />
            ) : null
          }
        />
        <Line
          type="stepAfter"
          dataKey="value"
          stroke={SERIES[0]}
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4 }}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

/* ── Dividendy po měsících a státech (stacked bar) ──────────────────────── */

export function DividendsByMonthChart({ data }: { data: DividendsByMonth }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data.rows} margin={{ top: 8, right: 12, bottom: 0, left: 8 }}>
        <CartesianGrid stroke="var(--linka)" strokeDasharray="2 4" vertical={false} />
        <XAxis {...axisProps} dataKey="month" tickFormatter={monthLabel} />
        <YAxis {...axisProps} tickFormatter={czkAxis} width={52} />
        <Tooltip
          cursor={{ fill: 'var(--pozadi)' }}
          content={({ active, payload, label }) =>
            active && payload && payload.length > 0 ? (
              <TooltipBox
                title={monthLabel(String(label))}
                rows={payload
                  .filter((entry) => Number(entry.value) > 0)
                  .map((entry) => ({
                    name: String(entry.name),
                    value: czkCompact(Number(entry.value)),
                    color: String(entry.color),
                  }))}
              />
            ) : null
          }
        />
        <Legend
          formatter={(value: string) => (
            <span className="text-xs text-inkoust-tlumeny">{value}</span>
          )}
        />
        {data.countries.map((country, index) => (
          <Bar
            key={country}
            dataKey={country}
            stackId="dividendy"
            fill={SERIES[index % SERIES.length]}
            stroke="var(--plocha)"
            strokeWidth={2}
            maxBarSize={36}
            isAnimationActive={false}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

/* ── Realizovaný zisk/ztráta po letech (polarita → semafor) ─────────────── */

export function RealizedByYearChart({ bars }: { bars: YearBar[] }) {
  // polarita zisk/ztráta = semaforové barvy (per-entry fill; Cell je v Recharts 3 deprecated)
  const data = bars.map((bar) => ({
    ...bar,
    fill: bar.valueCzk >= 0 ? 'var(--zelena)' : 'var(--cervena)',
  }));
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 8 }}>
        <CartesianGrid stroke="var(--linka)" strokeDasharray="2 4" vertical={false} />
        <XAxis {...axisProps} dataKey="year" />
        <YAxis {...axisProps} tickFormatter={czkAxis} width={56} />
        <ReferenceLine y={0} stroke="var(--inkoust-tlumeny)" />
        <Tooltip
          cursor={{ fill: 'var(--pozadi)' }}
          content={({ active, payload, label }) =>
            active && payload?.[0] ? (
              <TooltipBox
                title={String(label)}
                rows={[
                  {
                    name: Number(payload[0].value) >= 0 ? 'Zisk' : 'Ztráta',
                    value: czkCompact(Number(payload[0].value)),
                    color: Number(payload[0].value) >= 0 ? 'var(--zelena)' : 'var(--cervena)',
                  },
                ]}
              />
            ) : null
          }
        />
        <Bar dataKey="valueCzk" maxBarSize={36} radius={[4, 4, 0, 0]} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/* ── Poplatky po letech ─────────────────────────────────────────────────── */

export function FeesByYearChart({ bars }: { bars: YearBar[] }) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={bars} margin={{ top: 8, right: 12, bottom: 0, left: 8 }}>
        <CartesianGrid stroke="var(--linka)" strokeDasharray="2 4" vertical={false} />
        <XAxis {...axisProps} dataKey="year" />
        <YAxis {...axisProps} tickFormatter={czkAxis} width={52} />
        <Tooltip
          cursor={{ fill: 'var(--pozadi)' }}
          content={({ active, payload, label }) =>
            active && payload?.[0] ? (
              <TooltipBox
                title={String(label)}
                rows={[{ name: 'Poplatky', value: czkCompact(Number(payload[0].value)), color: SERIES[0] }]}
              />
            ) : null
          }
        />
        <Bar
          dataKey="valueCzk"
          fill={SERIES[0]}
          maxBarSize={36}
          radius={[4, 4, 0, 0]}
          isAnimationActive={false}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

/* ── Výhled osvobozování portfolia ──────────────────────────────────────── */

export function ExemptionOutlookChart({ outlook }: { outlook: ExemptionOutlook }) {
  const basisLabel = outlook.basis === 'value' ? 'hodnoty' : 'kusů';
  const points = outlook.points.map((point) => ({ ...point, t: toMs(point.date) }));
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={points} margin={{ top: 8, right: 12, bottom: 0, left: 8 }}>
        <CartesianGrid stroke="var(--linka)" strokeDasharray="2 4" vertical={false} />
        <XAxis
          {...axisProps}
          type="number"
          dataKey="t"
          domain={['dataMin', 'dataMax']}
          tickFormatter={(ms: number) => msLabel(ms)}
          minTickGap={48}
        />
        <YAxis {...axisProps} domain={[0, 100]} tickFormatter={(v: number) => `${v} %`} width={44} />
        <Tooltip
          content={({ active, payload }) =>
            active && payload?.[0] ? (
              <TooltipBox
                title={dateLabel(String(payload[0].payload.date))}
                rows={[
                  {
                    name: `Bez daně (% ${basisLabel})`,
                    value: `${Number(payload[0].value).toLocaleString('cs-CZ')} %`,
                    color: 'var(--zelena)',
                  },
                ]}
              />
            ) : null
          }
        />
        <Line
          type="stepAfter"
          dataKey="exemptShare"
          stroke="var(--zelena)"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4 }}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
