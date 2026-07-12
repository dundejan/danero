'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
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
  PortfolioAllocation,
  YearBar,
} from '@/lib/charts-data';
import { czkCompact, MONTH_LABELS, pct } from '@/lib/format';

/**
 * Grafy G3 (Recharts, 'use client'). Barvy výhradně z design tokenů:
 * kategorické série --graf-1..4 (pevné pořadí; největší kategorie — třeba US
 * v dividendách — dostává --graf-1), semafor jen pro stav/polaritu
 * (zisk/ztráta, pásma limitů). Brand růžová v sériích není — zůstává jen
 * akcentem (dnes/limit/aktivní). Mřížka a osy ustupují datům.
 */

const SERIES = ['var(--graf-1)', 'var(--graf-2)', 'var(--graf-3)', 'var(--graf-4)'];

const czkAxis = (value: number): string => {
  const abs = Math.abs(value);
  const sign = value < 0 ? '−' : '';
  if (abs >= 1_000_000)
    return `${sign}${(abs / 1_000_000).toLocaleString('cs-CZ', { maximumFractionDigits: 1 })} mil.`;
  if (abs >= 1_000) return `${sign}${Math.round(abs / 1_000)} tis.`;
  return `${sign}${Math.round(abs)}`;
};

const monthLabel = (isoMonth: string): string =>
  MONTH_LABELS[Number(isoMonth.slice(5, 7)) - 1] ?? isoMonth;

const dateLabel = (iso: string): string =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('cs-CZ', {
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
  });

/** ISO datum → ms (UTC) pro časovou osu — kategorická osa by zkreslila rozestupy. */
const toMs = (iso: string): number => Date.parse(`${iso}T00:00:00Z`);

const msLabel = (ms: number): string =>
  new Date(ms).toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric' });

const axisProps = {
  tick: { fill: 'var(--inkoust-tlumeny)', fontSize: 11, fontFamily: 'var(--font-mono)' },
  axisLine: { stroke: 'var(--linka)' },
  tickLine: false as const,
};

/**
 * Ticky na kulatých hodnotách (H4): krok 1/2/5×10^n, 4–5 ticků,
 * domain [0, niceMax]. Záporné minimum (ztrátové roky) protáhne osu
 * dolů stejným krokem — nula zůstává tickem.
 */
function niceTicks(max: number, min = 0): { domain: [number, number]; ticks: number[] } {
  const lo = Math.min(min, 0);
  const hi = Math.max(max, 1);
  const rawStep = (hi - lo) / 4;
  const pow = 10 ** Math.floor(Math.log10(rawStep));
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= rawStep)!;
  const niceMax = Math.ceil(hi / step) * step;
  const niceMin = lo < 0 ? Math.floor(lo / step) * step : 0;
  const ticks: number[] = [];
  for (let v = niceMin; v <= niceMax + step / 2; v += step) ticks.push(v);
  return { domain: [niceMin, niceMax], ticks };
}

function TooltipBox({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ color?: string; name: string; value: string }>;
}) {
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
  const lastValue = series.points[series.points.length - 1]?.value ?? 0;
  // řadu dovedeme do konce roku, ať čára nekončí v půlce plátna
  const points = [...series.points, { date: `${year}-12-31`, value: lastValue }].map((point) => ({
    ...point,
    t: toMs(point.date),
  }));
  // kulaté ticky; 1,05× nad limitem/maximem, ať referenční čára nelepí na strop
  const yScale = niceTicks(Math.max(series.limitCzk, series.usedCzk) * 1.05);
  const monthTicks = Array.from({ length: 12 }, (_, m) => Date.UTC(year, m, 1));

  return (
    <div>
      {/* stav ke konci roku mimo kreslicí plochu — nepřekrývá popisek „limit“ */}
      <p className="mb-1 text-right font-mono text-xs text-inkoust-tlumeny">
        k 31. 12.: <span className="text-inkoust">{czkCompact(lastValue)}</span>
      </p>
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
          <YAxis
            {...axisProps}
            tickFormatter={czkAxis}
            width={52}
            domain={yScale.domain}
            ticks={yScale.ticks}
          />
          <ReferenceLine
            y={series.limitCzk}
            stroke="var(--cervena)"
            strokeDasharray="4 4"
            label={{
              value: 'limit',
              fill: 'var(--cervena)',
              fontSize: 10,
              position: 'insideTopRight',
            }}
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
    </div>
  );
}

/* ── Dividendy po měsících a státech (stacked bar) ──────────────────────── */

export function DividendsByMonthChart({ data }: { data: DividendsByMonth }) {
  // maximum měsíčního SOUČTU (sloupce jsou stackované)
  const yScale = niceTicks(
    Math.max(
      ...data.rows.map((row) => data.countries.reduce((sum, c) => sum + Number(row[c] ?? 0), 0)),
      0,
    ),
  );
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data.rows} margin={{ top: 8, right: 12, bottom: 0, left: 8 }}>
        <CartesianGrid stroke="var(--linka)" strokeDasharray="2 4" vertical={false} />
        <XAxis {...axisProps} dataKey="month" tickFormatter={monthLabel} />
        <YAxis
          {...axisProps}
          tickFormatter={czkAxis}
          width={52}
          domain={yScale.domain}
          ticks={yScale.ticks}
        />
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
  const yScale = niceTicks(
    Math.max(...bars.map((bar) => bar.valueCzk), 0),
    Math.min(...bars.map((bar) => bar.valueCzk), 0),
  );
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 8 }}>
        <CartesianGrid stroke="var(--linka)" strokeDasharray="2 4" vertical={false} />
        <XAxis {...axisProps} dataKey="year" />
        <YAxis
          {...axisProps}
          tickFormatter={czkAxis}
          width={56}
          domain={yScale.domain}
          ticks={yScale.ticks}
        />
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
  const yScale = niceTicks(Math.max(...bars.map((bar) => bar.valueCzk), 0));
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={bars} margin={{ top: 8, right: 12, bottom: 0, left: 8 }}>
        <CartesianGrid stroke="var(--linka)" strokeDasharray="2 4" vertical={false} />
        <XAxis {...axisProps} dataKey="year" />
        <YAxis
          {...axisProps}
          tickFormatter={czkAxis}
          width={52}
          domain={yScale.domain}
          ticks={yScale.ticks}
        />
        <Tooltip
          cursor={{ fill: 'var(--pozadi)' }}
          content={({ active, payload, label }) =>
            active && payload?.[0] ? (
              <TooltipBox
                title={String(label)}
                rows={[
                  {
                    name: 'Poplatky',
                    value: czkCompact(Number(payload[0].value)),
                    color: SERIES[0],
                  },
                ]}
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
        <YAxis
          {...axisProps}
          domain={[0, 100]}
          tickFormatter={(v: number) => `${v} %`}
          width={44}
        />
        <Tooltip
          content={({ active, payload }) =>
            active && payload?.[0] ? (
              <TooltipBox
                title={dateLabel(String(payload[0].payload.date))}
                rows={[
                  {
                    name: `Bez daně (% ${basisLabel})`,
                    value: pct(Number(payload[0].value), 1),
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

/* ── Alokace portfolia (velký koláč všech pozic) ────────────────────────── */

const RADIAN = Math.PI / 180;

/** Rozšířená paleta pro koláč (--graf-5..8 zatím jen tady, série grafů dál 1–4). */
const PIE_SERIES = [...SERIES, 'var(--graf-5)', 'var(--graf-6)', 'var(--graf-7)', 'var(--graf-8)'];

/** Přímý popisek výseče: ticker těsně za vnějším okrajem, jen pro podíl ≥ 3 %
    — inkoust na ploše karty drží kontrast v obou režimech. */
function pieSliceLabel(props: {
  cx?: number;
  cy?: number;
  midAngle?: number;
  outerRadius?: number;
  payload?: { label: string; share: number };
}) {
  const { cx, cy, midAngle, outerRadius, payload } = props;
  if (
    cx === undefined ||
    cy === undefined ||
    midAngle === undefined ||
    outerRadius === undefined ||
    !payload ||
    payload.share < 3
  ) {
    return null;
  }
  const r = outerRadius + 10;
  const x = cx + r * Math.cos(-midAngle * RADIAN);
  return (
    <text
      x={x}
      y={cy + r * Math.sin(-midAngle * RADIAN)}
      textAnchor={x > cx ? 'start' : 'end'}
      dominantBaseline="central"
      fill="var(--inkoust)"
      fontSize={11}
      fontFamily="var(--font-mono)"
    >
      {payload.label}
    </text>
  );
}

export function AllocationPie({ allocation }: { allocation: PortfolioAllocation }) {
  // Kategorické střídání --graf-1..8 podle pořadí (index mod 8) — barva jen
  // odděluje sousední výseče, identitu nese přímý popisek a tooltip. Paleta
  // validována dataviz skriptem vč. wrap-around páru 8↔1.
  const count = allocation.slices.length;
  const fillFor = (index: number): string => {
    // wrap-around: při n mod 8 == 1 by poslední výseč měla barvu první —
    // dostane místo ní graf-3 (odlišná i od předchozí graf-8)
    if (count > PIE_SERIES.length && index === count - 1 && count % PIE_SERIES.length === 1) {
      return PIE_SERIES[2]!;
    }
    return PIE_SERIES[index % PIE_SERIES.length]!;
  };
  const data = allocation.slices.map((slice, index) => ({
    ...slice,
    fill: fillFor(index),
  }));
  return (
    <div>
      <div className="relative">
        <ResponsiveContainer width="100%" height={360}>
          <PieChart margin={{ top: 16, right: 16, bottom: 16, left: 16 }}>
            <Pie
              data={data}
              dataKey="valueCzk"
              nameKey="label"
              innerRadius="55%"
              outerRadius="85%"
              paddingAngle={0.5}
              stroke="var(--plocha)"
              strokeWidth={2}
              isAnimationActive={false}
              label={pieSliceLabel}
              labelLine={false}
            />
            <Tooltip
              content={({ active, payload }) =>
                active && payload?.[0] ? (
                  <TooltipBox
                    title={(() => {
                      const slice = payload[0].payload as { label: string; name?: string };
                      return slice.name ? `${slice.label} — ${slice.name}` : slice.label;
                    })()}
                    rows={[
                      {
                        name: 'Hodnota',
                        value: czkCompact(Number(payload[0].value)),
                        color: String((payload[0].payload as { fill: string }).fill),
                      },
                      {
                        name: 'Podíl',
                        value: pct((payload[0].payload as { share: number }).share, 1),
                      },
                    ]}
                  />
                ) : null
              }
            />
          </PieChart>
        </ResponsiveContainer>
        {/* uprostřed koláče celková hodnota — text nenese barvu série */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-[10px] uppercase tracking-wide text-inkoust-tlumeny">celkem</span>
          <span className="font-mono text-sm font-semibold text-inkoust">
            {czkCompact(allocation.totalCzk)}
          </span>
        </div>
      </div>
      <p className="mt-2 text-xs text-inkoust-tlumeny">
        Barvy jen odlišují sousední výseče — pořadí je podle hodnoty. Pozice bez ceny od brokera v
        grafu nejsou.
      </p>
    </div>
  );
}
