'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { ExemptionOutlook, HorizonDot } from '@/lib/charts-data';
import { MONTH_LABELS, plural, qty } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * Horizont osvobození v2 (docs/07 signatura, G3, vizuál H4): časový pás
 * s tečkami lotů na datu osvobození. Velikost tečky = hodnota (známe-li ceny),
 * jinak kusy; klik vede na detail pozice; hover ukazuje detailní tooltip.
 * Pod osou běží decentní kumulativní plocha „kolik % už bude bez daně".
 */

const RANGES = [
  { key: '1r', label: '1 rok', years: 1 },
  { key: '3r', label: '3 roky', years: 3 },
  { key: 'vse', label: 'vše', years: null },
] as const;

type RangeKey = (typeof RANGES)[number]['key'];

/* Geometrie SVG (viewBox 1000×170): osa s tečkami nahoře, popisky měsíců,
   dole 44px vrstva kumulativního osvobozování. */
const AXIS_Y = 56;
const TICK_TOP = 70;
const TICK_BOTTOM = 76;
const TICK_LABEL_Y = 90;
const OUTLOOK_TOP = 104; // = 100 %
const OUTLOOK_BASE = 148; // = 0 %
const X_MIN = 40;
const X_MAX = 960;

const monthLabel = (month: string): string => {
  const [y, m] = month.split('-');
  return `${MONTH_LABELS[Number(m) - 1] ?? m} ${y}`;
};

const czkCompact = (value: number): string =>
  new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 0 }).format(value) + ' Kč';

const dayNumber = (iso: string): number => new Date(`${iso}T00:00:00`).getTime() / 86_400_000;

interface Tip {
  x: number;
  y: number;
  dot: HorizonDot;
}

export function HorizonStrip({
  dots,
  today,
  outlook,
  embedded = false,
}: {
  dots: HorizonDot[];
  today: string;
  /** Kumulativní výhled osvobozování (mini vrstva pod osou); volitelný. */
  outlook?: ExemptionOutlook | null;
  /** Bez vlastní karty a titulku — pro vložení do sekce s jednotným nadpisem. */
  embedded?: boolean;
}) {
  const [range, setRange] = useState<RangeKey>('3r');
  const [tip, setTip] = useState<Tip | null>(null);

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
    const endDay = horizonEnd + pad;
    const x = (day: number) =>
      X_MIN + ((day - (minDay - pad)) / (span + 2 * pad)) * (X_MAX - X_MIN);
    const maxWeight = Math.max(...visible.map((dot) => dot.weight), 1);

    // ── popisky měsíců/roků na ose ────────────────────────────────────────
    // začínáme měsícem nejstaršího viditelného data (příp. dneška)
    const firstIso = [today, ...visible.map((dot) => `${dot.exemptFrom}-01`)].sort()[0]!;
    let tickYear = Number(firstIso.slice(0, 4));
    let tickMonth = Number(firstIso.slice(5, 7)); // 1–12
    const months: Array<{ day: number; month: number; year: number }> = [];
    for (let i = 0; i < 600; i += 1) {
      const day = dayNumber(`${tickYear}-${String(tickMonth).padStart(2, '0')}-01`);
      if (day > endDay) break;
      if (day >= minDay - pad) months.push({ day, month: tickMonth, year: tickYear });
      tickMonth += 1;
      if (tickMonth > 12) {
        tickMonth = 1;
        tickYear += 1;
      }
    }
    // hustota: měsíčně → kvartálně → jen roky (leden nese letopočet)
    const ticks = months
      .filter((m) =>
        months.length <= 16 ? true : months.length <= 48 ? (m.month - 1) % 3 === 0 : m.month === 1,
      )
      .map((m) => ({
        x: x(m.day),
        label: m.month === 1 ? String(m.year) : MONTH_LABELS[m.month - 1]!,
        isYear: m.month === 1,
      }));

    // ── kumulativní plocha osvobozování (stepAfter) ───────────────────────
    let outlookPath: { line: string; area: string; endShare: number } | null = null;
    if (outlook && outlook.points.length > 0) {
      const clampX = (v: number) => Math.min(X_MAX, Math.max(X_MIN, v));
      const yOf = (share: number) => OUTLOOK_BASE - (share / 100) * (OUTLOOK_BASE - OUTLOOK_TOP);
      const pts = outlook.points
        .map((p) => ({ day: dayNumber(p.date), share: p.exemptShare }))
        .filter((p) => p.day <= endDay)
        .sort((a, b) => a.day - b.day);
      if (pts.length > 0) {
        const x0 = clampX(x(pts[0]!.day));
        let line = `M ${x0} ${yOf(pts[0]!.share)}`;
        for (const p of pts.slice(1)) line += ` H ${clampX(x(p.day))} V ${yOf(p.share)}`;
        line += ` H ${X_MAX}`;
        outlookPath = {
          line,
          area: `${line} V ${OUTLOOK_BASE} H ${x0} Z`,
          endShare: pts[pts.length - 1]!.share,
        };
      }
    }

    return { visible, hidden, todayX: x(todayDay), x, maxWeight, ticks, outlookPath };
  }, [dots, today, range, outlook]);

  if (!view) return null;
  const basis = dots[0]?.weightBasis === 'value' ? 'hodnotě' : 'počtu kusů';

  const description = (
    <p className="max-w-[62ch] text-xs text-inkoust-tlumeny">
      Každá tečka = kusy jedné pozice a měsíce, kdy jim doběhne 3letý test. Velikost podle {basis};
      kliknutím otevřeš detail pozice.
      {view.hidden > 0 &&
        ` Mimo zobrazené období: ${view.hidden} ${plural(view.hidden, 'tečka', 'tečky', 'teček')}.`}
    </p>
  );

  const rangeButtons = (
    <div className="flex items-center gap-1" role="group" aria-label="Období horizontu">
      {RANGES.map((preset) => (
        <button
          key={preset.key}
          type="button"
          onClick={() => setRange(preset.key)}
          aria-pressed={range === preset.key}
          className={`rounded-md px-2 py-0.5 font-mono text-xs ${
            range === preset.key
              ? 'bg-ruzova-syta font-semibold text-white'
              : 'text-inkoust-tlumeny hover:text-inkoust'
          }`}
        >
          {preset.label}
        </button>
      ))}
    </div>
  );

  const tipFor = (dot: HorizonDot, cx: number, r: number): Tip => ({
    // tooltip ukotvíme nad tečku; u krajů ho držíme uvnitř plátna
    x: Math.min(880, Math.max(120, cx)),
    y: AXIS_Y - r - 4,
    dot,
  });

  const strip = (
    <>
      <div className="relative">
        {/* bez role="img" — tečky jsou odkazy a musí zůstat v accessibility tree */}
        <svg viewBox="0 0 1000 170" className="mt-3 w-full" aria-label="Horizont osvobození">
          {/* osa + popisky měsíců/roků */}
          <line
            x1={X_MIN}
            y1={AXIS_Y}
            x2={X_MAX}
            y2={AXIS_Y}
            stroke="var(--linka)"
            strokeWidth="2"
          />
          {view.ticks.map((tick) => (
            <g key={tick.x}>
              <line
                x1={tick.x}
                y1={TICK_TOP}
                x2={tick.x}
                y2={TICK_BOTTOM}
                stroke="var(--linka)"
                strokeWidth="1"
              />
              <text
                x={tick.x}
                y={TICK_LABEL_Y}
                textAnchor="middle"
                fontSize="11"
                fill="var(--inkoust-tlumeny)"
                fontFamily="var(--font-plex-mono)"
                fontWeight={tick.isYear ? 600 : 400}
              >
                {tick.label}
              </text>
            </g>
          ))}

          {/* dnešek napříč oběma vrstvami */}
          <line
            x1={view.todayX}
            y1="12"
            x2={view.todayX}
            y2={OUTLOOK_BASE}
            stroke="var(--ruzova)"
            strokeWidth="1.5"
          />
          <text
            x={view.todayX + 6}
            y="22"
            fontSize="12"
            fill="var(--ruzova)"
            fontFamily="var(--font-plex-mono)"
          >
            dnes
          </text>

          {/* mini vrstva: kumulativně „kolik % už bude bez daně" */}
          {view.outlookPath && (
            <g>
              <line
                x1={X_MIN}
                y1={OUTLOOK_BASE}
                x2={X_MAX}
                y2={OUTLOOK_BASE}
                stroke="var(--linka)"
                strokeWidth="1"
              />
              <path d={view.outlookPath.area} fill="var(--graf-1)" fillOpacity="0.12" />
              <path
                d={view.outlookPath.line}
                fill="none"
                stroke="var(--graf-1)"
                strokeWidth="1.5"
                strokeOpacity="0.8"
              />
              <text
                x={X_MAX - 4}
                y={
                  OUTLOOK_BASE -
                  (view.outlookPath.endShare / 100) * (OUTLOOK_BASE - OUTLOOK_TOP) -
                  5
                }
                textAnchor="end"
                fontSize="10"
                fill="var(--inkoust-tlumeny)"
                fontFamily="var(--font-plex-mono)"
              >
                {view.outlookPath.endShare.toLocaleString('cs-CZ')} %
              </text>
            </g>
          )}

          {/* tečky lotů */}
          {view.visible.map((dot, index) => {
            const cx = view.x(dayNumber(`${dot.exemptFrom}-01`));
            const r = 5 + Math.sqrt(dot.weight / view.maxWeight) * 8;
            const label = `${dot.label}: ${qty(dot.quantity)} ks — ${
              dot.isExempt ? 'už bez daně' : `bez daně od ${monthLabel(dot.exemptFrom)}`
            }`;
            return (
              <Link
                key={`${dot.isin}|${dot.exemptFrom}`}
                href={`/portfolio/${dot.isin}`}
                aria-label={label}
                onFocus={() => setTip(tipFor(dot, cx, r))}
                onBlur={() => setTip(null)}
              >
                <circle
                  cx={cx}
                  cy={AXIS_Y}
                  r={r}
                  fillOpacity="0.9"
                  stroke="var(--plocha)"
                  strokeWidth="1.5"
                  className={cn(
                    // dark:hover explicitně — samotný hover: by v dark prohrál s dark:fill
                    'cursor-pointer hover:fill-ruzova dark:hover:fill-ruzova',
                    // v dark módu čekající tečky světlejší, ať nesplývají s plochou
                    dot.isExempt ? 'fill-zelena' : 'fill-inkoust-tlumeny dark:fill-inkoust',
                  )}
                  style={{ animation: `dot-in 0.3s ease-out ${Math.min(index, 40) * 25}ms both` }}
                  onMouseEnter={() => setTip(tipFor(dot, cx, r))}
                  onMouseLeave={() => setTip(null)}
                />
              </Link>
            );
          })}
        </svg>

        {/* hover tooltip (H4) — pozice v procentech plátna, drží poměr stran */}
        {tip && (
          <div
            className="pointer-events-none absolute z-10 max-w-[190px] -translate-x-1/2 -translate-y-full rounded-md border border-linka bg-plocha px-3 py-2 text-xs shadow-sm"
            // CSS clamp v pixelech — procentní clamp ve viewBox jednotkách na úzkém
            // displeji nestačil (tooltip ~180 px přetékal přes okraj kontejneru)
            style={{ left: `clamp(95px, ${tip.x / 10}%, calc(100% - 95px))`, top: `${(tip.y / 170) * 100}%` }}
          >
            <p className="font-semibold text-inkoust">{tip.dot.label}</p>
            <p className="font-mono text-inkoust-tlumeny">
              {qty(tip.dot.quantity)} ks
              {tip.dot.weightBasis === 'value' && ` · ${czkCompact(tip.dot.weight)}`}
            </p>
            <p className={tip.dot.isExempt ? 'font-semibold text-zelena' : 'text-inkoust-tlumeny'}>
              {tip.dot.isExempt ? 'už bez daně' : `bez daně od ${monthLabel(tip.dot.exemptFrom)}`}
            </p>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-4 text-xs text-inkoust-tlumeny">
        <span className="flex items-center gap-1">
          <span className="inline-block size-2 rounded-full bg-zelena" /> osvobozené
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block size-2 rounded-full bg-inkoust-tlumeny dark:bg-inkoust" />{' '}
          čekající
        </span>
        {view.outlookPath && (
          <span className="flex items-center gap-1">
            <span className="inline-block h-0.5 w-4 rounded bg-graf-1" /> kumulativně bez daně
            (spodní křivka)
          </span>
        )}
      </div>
    </>
  );

  if (embedded) {
    return (
      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          {description}
          {rangeButtons}
        </div>
        {strip}
      </div>
    );
  }

  return (
    <section className="rounded-lg border border-linka bg-plocha p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-inkoust-tlumeny">
          Horizont osvobození
        </h2>
        {rangeButtons}
      </div>
      <div className="mt-1">{description}</div>
      {strip}
    </section>
  );
}
