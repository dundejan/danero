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
import type { LegendPayload } from 'recharts';
import type {
  DividendsByMonth,
  ExemptionOutlook,
  LimitSeries,
  YearBar,
} from '@/lib/charts-data';
import { czkCompact, MONTH_LABELS, pct } from '@/lib/format';

/**
 * Grafy G3 (Recharts, 'use client'). Barvy výhradně z design tokenů:
 * kategorické série --chart-1..4 (pevné pořadí; největší kategorie — třeba US
 * v dividendách — dostává --chart-1), semafor jen pro stav/polaritu
 * (zisk/ztráta, čára limitu). Mřížka a osy ustupují datům.
 *
 * Přístupnost: každý graf dostává `title` a `desc` — Recharts je vykreslí do
 * `<svg role="application" tabindex="0">`. Bez nich se na graf dá klávesnicí
 * vstoupit, ale čtečka o něm neřekne vůbec nic. `desc` proto nese i skutečná
 * čísla, ne jen popis typu grafu; jinak jsou data pro nevidomého nedostupná.
 */

const SERIES = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)'];

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

export const dateLabel = (iso: string): string =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('cs-CZ', {
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
  });

/** ISO datum → ms (UTC) pro časovou osu — kategorická osa by zkreslila rozestupy. */
export const toMs = (iso: string): number => Date.parse(`${iso}T00:00:00Z`);

/**
 * K1-06: `toMs` parsuje datum jako UTC půlnoc, takže se popisek osy musí
 * formátovat v UTC. Bez toho ukazovala osa západně od Greenwiche den předem —
 * a tooltip téhož grafu (přes `dateLabel`) přitom správné datum.
 */
export const msLabel = (ms: number): string =>
  new Date(ms).toLocaleDateString('cs-CZ', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
  });

const axisProps = {
  tick: { fill: 'var(--ink-muted)', fontSize: 11, fontFamily: 'var(--font-sans)' },
  axisLine: { stroke: 'var(--line)' },
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
  // Osa je v celých korunách: s krokem pod 1 Kč vycházely u haléřových
  // částek popisky „0, 1, 1“ (R2-28).
  const step = Math.max(1, [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= rawStep)!);
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
    <div className="rounded-lg bg-surface px-3 py-2 text-xs shadow-floating dark:bg-control">
      <p className="mb-1 font-semibold text-ink">{title}</p>
      {rows.map((row) => (
        <p key={row.name} className="flex items-center gap-2 tabular-nums text-ink-muted">
          {row.color && (
            <span className="inline-block size-2 rounded-full" style={{ background: row.color }} />
          )}
          <span>{row.name}</span>
          <span className="ml-auto pl-3 text-ink">{row.value}</span>
        </p>
      ))}
    </div>
  );
}

/**
 * Vlastní legenda. Výchozí legenda Rechartu kreslí ke každé sérii
 * `<svg aria-label="US legend icon">` — anglický řetězec, který čtečka
 * doopravdy přečte (audit H2-09, porušení pravidla 1). `formatter` mění jen
 * text vedle ikony, ne její popisek, takže je potřeba vlastní `content`.
 * Barevná tečka je čistě dekorativní (identitu nese text vedle ní), proto
 * `aria-hidden` — čtečka pak oznámí jen „US, CZ“, ne obrázky.
 */
function ChartLegend({ payload }: { payload?: ReadonlyArray<LegendPayload> }) {
  return (
    <ul className="flex flex-wrap justify-center gap-x-4 gap-y-1 pt-2">
      {(payload ?? []).map((entry) => (
        <li
          key={String(entry.value)}
          className="flex items-center gap-1.5 text-xs text-ink-muted"
        >
          <span
            aria-hidden
            className="inline-block size-2 shrink-0 rounded-full"
            style={{ background: entry.color }}
          />
          {entry.value}
        </li>
      ))}
    </ul>
  );
}

/* ── Čerpání limitu v průběhu roku ────────────────────────────────────────
   V grafu je jediná vodicí čára: limit. Pásma 60 a 85 % se nekreslí (Janovo
   rozhodnutí 10. 10. 2026) — stav limitu nese odměrka a slovní popis vedle
   grafu, tři čáry navíc jen ubíraly čitelnost křivce. Totéž platí pro každý
   další graf limitu. Graf nemá popisek ani legendu: osa, křivka a slovo
   „limit“ u čáry stačí. */

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
      <ResponsiveContainer width="100%" height={220}>
        <LineChart
          data={points}
          margin={{ top: 8, right: 12, bottom: 0, left: 8 }}
          title={`Čerpání limitu ${czkCompact(series.limitCzk)} v roce ${year} — ${name.toLowerCase()}`}
          desc={`Kumulativní řada od 1. 1. ${year}; k 31. 12. ${czkCompact(lastValue)} z limitu ${czkCompact(series.limitCzk)}. Přerušovaná čára označuje limit.`}
        >
          <CartesianGrid stroke="var(--line)" strokeDasharray="2 4" vertical={false} />
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
            stroke="var(--danger)"
            strokeDasharray="4 4"
            // Popisek stojí vlevo NAD čarou (u vodorovné čáry to je
            // `insideBottomLeft`): řada tam teprve začíná od nuly. Vpravo pod
            // čarou ho při čerpání těsně pod limitem přeškrtla křivka (R1B-25)
            // a u limitu u dna grafu se kryl s popisky osy (R2-15).
            label={{
              value: 'limit',
              fill: 'var(--danger)',
              fontSize: 10,
              position: 'insideBottomLeft',
            }}
          />
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
      <BarChart
        data={data.rows}
        margin={{ top: 8, right: 12, bottom: 0, left: 8 }}
        title="Dividendy po měsících a státech"
        desc={`Skládané sloupce: brutto dividendy v Kč po měsících, barevně podle státu (${data.countries.join(', ')}). Celkem ${czkCompact(data.totalCzk)}.`}
      >
        <CartesianGrid stroke="var(--line)" strokeDasharray="2 4" vertical={false} />
        <XAxis {...axisProps} dataKey="month" tickFormatter={monthLabel} />
        <YAxis
          {...axisProps}
          tickFormatter={czkAxis}
          width={52}
          domain={yScale.domain}
          ticks={yScale.ticks}
        />
        <Tooltip
          cursor={{ fill: 'var(--canvas)' }}
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
        <Legend content={(props) => <ChartLegend payload={props.payload} />} />
        {data.countries.map((country, index) => (
          <Bar
            key={country}
            dataKey={country}
            stackId="dividendy"
            fill={SERIES[index % SERIES.length]}
            stroke="var(--surface)"
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
    fill: bar.valueCzk >= 0 ? 'var(--success)' : 'var(--danger)',
  }));
  const yScale = niceTicks(
    Math.max(...bars.map((bar) => bar.valueCzk), 0),
    Math.min(...bars.map((bar) => bar.valueCzk), 0),
  );
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart
        data={data}
        margin={{ top: 8, right: 12, bottom: 0, left: 8 }}
        title="Realizovaný zisk a ztráta po letech"
        desc={`Sloupce podle let: ${bars.map((bar) => `${bar.year} ${czkCompact(bar.valueCzk)}`).join(', ')}. Zelená = zisk, červená = ztráta.`}
      >
        <CartesianGrid stroke="var(--line)" strokeDasharray="2 4" vertical={false} />
        <XAxis {...axisProps} dataKey="year" />
        <YAxis
          {...axisProps}
          tickFormatter={czkAxis}
          width={56}
          domain={yScale.domain}
          ticks={yScale.ticks}
        />
        <ReferenceLine y={0} stroke="var(--ink-muted)" />
        <Tooltip
          cursor={{ fill: 'var(--canvas)' }}
          content={({ active, payload, label }) =>
            active && payload?.[0] ? (
              <TooltipBox
                title={String(label)}
                rows={[
                  {
                    name: Number(payload[0].value) >= 0 ? 'Zisk' : 'Ztráta',
                    value: czkCompact(Number(payload[0].value)),
                    color: Number(payload[0].value) >= 0 ? 'var(--success)' : 'var(--danger)',
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
      <BarChart
        data={bars}
        margin={{ top: 8, right: 12, bottom: 0, left: 8 }}
        title="Poplatky brokerům po letech"
        desc={`Sloupce podle let: ${bars.map((bar) => `${bar.year} ${czkCompact(bar.valueCzk)}`).join(', ')}.`}
      >
        <CartesianGrid stroke="var(--line)" strokeDasharray="2 4" vertical={false} />
        <XAxis {...axisProps} dataKey="year" />
        <YAxis
          {...axisProps}
          tickFormatter={czkAxis}
          width={52}
          domain={yScale.domain}
          ticks={yScale.ticks}
        />
        <Tooltip
          cursor={{ fill: 'var(--canvas)' }}
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
  const firstPoint = outlook.points[0];
  const lastPoint = outlook.points[outlook.points.length - 1];
  // Osa času: „dnes“ a začátky dalších let. Z dat jednotlivých nákupů na ni
  // vycházela nahodilá data („29. 5. 2027“), která nic neříkala — přesný den
  // ukáže bublina nad křivkou.
  const startMs = points[0]?.t ?? 0;
  const endMs = points[points.length - 1]?.t ?? startMs;
  const yearTicks: number[] = [];
  for (
    let year = new Date(startMs).getUTCFullYear() + 1;
    Date.UTC(year, 0, 1) <= endMs;
    year += 1
  ) {
    const tick = Date.UTC(year, 0, 1);
    // letopočet těsně za „dnes“ by se s ním překryl
    if (tick - startMs > (endMs - startMs) * 0.07) yearTicks.push(tick);
  }
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart
        data={points}
        margin={{ top: 8, right: 12, bottom: 0, left: 8 }}
        title="Osvobozování portfolia v čase"
        desc={
          firstPoint && lastPoint
            ? `Podíl ${basisLabel} portfolia, který půjde prodat bez daně: dnes ${pct(firstPoint.exemptShare, 1)}, k ${dateLabel(lastPoint.date)} ${pct(lastPoint.exemptShare, 1)}.`
            : `Podíl ${basisLabel} portfolia, který půjde prodat bez daně, v čase.`
        }
      >
        <CartesianGrid stroke="var(--line)" strokeDasharray="2 4" vertical={false} />
        <XAxis
          {...axisProps}
          type="number"
          dataKey="t"
          domain={['dataMin', 'dataMax']}
          ticks={[startMs, ...yearTicks]}
          tickFormatter={(ms: number) =>
            ms === startMs ? 'dnes' : String(new Date(ms).getUTCFullYear())
          }
        />
        <YAxis
          {...axisProps}
          domain={[0, 100]}
          ticks={[0, 50, 100]}
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
                    color: SERIES[0],
                  },
                ]}
              />
            ) : null
          }
        />
        <Line
          type="stepAfter"
          dataKey="exemptShare"
          // stejná barva jako táž křivka pod horizontem na přehledu (R1B-11)
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
