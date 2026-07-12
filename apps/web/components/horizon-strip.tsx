'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { groupHorizonDots, type ExemptionOutlook, type HorizonDot } from '@/lib/charts-data';
import { czDate, czkCompact, MONTH_LABELS, pct, plural, qty } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * Horizont osvobození v4 (docs/07 signatura, G3, vizuál H4): časový pás,
 * tečka = den (pohled „1 rok“), nebo měsíc (delší pohledy — aktuální měsíc
 * ale zůstává po dnech, ať žádná tečka neleží za čárou „dnes“ s neosvobozenými
 * kusy). Velikost tečky = celková hodnota (známe-li ceny), jinak kusy;
 * hover/focus ukazuje rozpad po pozicích. Pod osou běží decentní kumulativní
 * plocha „kolik % už bude bez daně“.
 */

const RANGES = [
  { key: '1r', label: '1 rok', years: 1 },
  { key: '3r', label: '3 roky', years: 3 },
  { key: 'vse', label: 'vše', years: null },
] as const;

type RangeKey = (typeof RANGES)[number]['key'];

/* Geometrie SVG (viewBox 1000×170): osa s tečkami nahoře, popisky měsíců,
   dole 44px vrstva kumulativního osvobozování. */
const VIEWBOX_WIDTH = 1000;
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

/** Měsíční tečka nese 'YYYY-MM' (po slučování), denní plné 'YYYY-MM-DD'. */
const isMonthDot = (dot: HorizonDot): boolean => dot.exemptFrom.length === 7;
const dotIso = (dot: HorizonDot): string =>
  isMonthDot(dot) ? `${dot.exemptFrom}-01` : dot.exemptFrom;
/** Popisek tečky: měsíc („čvc 2026“), nebo konkrétní den („23. 7. 2026“). */
const dotLabel = (dot: HorizonDot): string =>
  isMonthDot(dot) ? monthLabel(dot.exemptFrom) : czDate(dot.exemptFrom);

/** Celková váha tečky jako text: CZK, nebo počet kusů (weight = součet kusů). */
const totalText = (dot: HorizonDot): string =>
  dot.weightBasis === 'value' ? czkCompact(dot.weight) : `${qty(dot.weight)} ks`;

/** Max řádků rozpadu v tooltipu — víc pozic shrne „+ dalších N“. */
const TIP_MAX_ITEMS = 8;

const dayNumber = (iso: string): number => new Date(`${iso}T00:00:00`).getTime() / 86_400_000;

interface Tip {
  /** Pozice v pixelech vůči vnějšímu wrapperu (mimo overflow kontejner). */
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
  const wrapRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // gradientová affordance na pravé hraně — jen dokud je vpravo co odscrollovat
  const [fadeRight, setFadeRight] = useState(false);

  const syncFade = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setFadeRight(el.scrollWidth - el.clientWidth - el.scrollLeft > 8);
  }, []);

  const view = useMemo(() => {
    if (dots.length === 0) return null;
    const preset = RANGES.find((r) => r.key === range)!;
    // „1 rok“ po dnech; delší pohledy po měsících (aktuální měsíc po dnech)
    const grouped = groupHorizonDots(dots, preset.years === 1 ? 'day' : 'month', today);
    const todayDay = dayNumber(today);
    // aritmeticky (ne skládáním data) — „29. 2. + rok“ by byl Invalid Date
    const horizonEnd = preset.years
      ? todayDay + preset.years * 365.25
      : Math.max(...grouped.map((dot) => dayNumber(dotIso(dot))), todayDay);

    const visible = grouped.filter((dot) => dayNumber(dotIso(dot)) <= horizonEnd);
    const hidden = grouped.length - visible.length;
    const minDay = Math.min(todayDay, ...visible.map((dot) => dayNumber(dotIso(dot))));
    const span = Math.max(60, horizonEnd - minDay);
    const pad = span * 0.06;
    const endDay = horizonEnd + pad;
    const x = (day: number) =>
      X_MIN + ((day - (minDay - pad)) / (span + 2 * pad)) * (X_MAX - X_MIN);
    const maxWeight = Math.max(...visible.map((dot) => dot.weight), 1);

    // ── popisky měsíců/roků na ose ────────────────────────────────────────
    // začínáme měsícem nejstaršího viditelného data (příp. dneška)
    const firstIso = [today, ...visible.map(dotIso)].sort()[0]!;
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

  // mobil: pás přetéká (min-w 640 px) → výchozí odscrollování na čáru „dnes“,
  // ať uživatel nezírá na dávno osvobozenou historii vlevo
  const todayX = view?.todayX;
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || todayX === undefined) return;
    if (el.scrollWidth > el.clientWidth) {
      const target = (todayX / VIEWBOX_WIDTH) * el.scrollWidth - el.clientWidth * 0.4;
      el.scrollLeft = Math.max(0, Math.min(target, el.scrollWidth - el.clientWidth));
    }
    syncFade();
  }, [todayX, syncFade]);

  if (!view) return null;
  const basis = dots[0]?.weightBasis === 'value' ? 'celkové hodnoty' : 'celkového počtu kusů';

  const description = (
    <p className="max-w-[62ch] text-xs text-inkoust-tlumeny">
      {range === '1r'
        ? 'Každá tečka = den, kdy doběhne 3letý test dalším kusům'
        : 'Každá tečka = měsíc (aktuální měsíc po dnech), kdy doběhne 3letý test dalším kusům'}
      ; velikost podle {basis}. Najetím či klepnutím zobrazíš rozpad.
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

  // tooltip kotvíme v pixelech z geometrie tečky (bounding rect) vůči vnějšímu
  // wrapperu — žije mimo overflow-x kontejner, který by ho svisle ořízl
  const showTip = (dot: HorizonDot) => (event: { currentTarget: SVGCircleElement }) => {
    const wrapRect = wrapRef.current?.getBoundingClientRect();
    if (!wrapRect) return;
    const dotRect = event.currentTarget.getBoundingClientRect();
    setTip({
      x: dotRect.left + dotRect.width / 2 - wrapRect.left,
      y: dotRect.top - wrapRect.top - 6,
      dot,
    });
  };

  // legenda jen pro stavy, které v datech opravdu jsou (žádné „osvobozené“
  // bez jediné zelené tečky)
  const hasExempt = view.visible.some((dot) => dot.isExempt);
  const hasPending = view.visible.some((dot) => !dot.isExempt);

  const strip = (
    <>
      {/* mobil: pás scrolluje uvnitř vlastního wrapperu — tečky a popisky
          zůstanou čitelné a stránka nepřetéká; min-w-0/max-w-full drží šířku
          i uvnitř flex/grid rodičů (jinak by kontejner narostl a ořízl bez scrollu) */}
      <div ref={wrapRef} className="relative min-w-0 max-w-full">
        <div ref={scrollRef} onScroll={syncFade} className="w-full overflow-x-auto">
          <div className="min-w-[640px] md:min-w-0">
            {/* bez role="img" na svg — fokusovatelné tečky musí zůstat v accessibility tree */}
            <svg
              viewBox={`0 0 ${VIEWBOX_WIDTH} 170`}
              className="mt-3 w-full"
              aria-label="Horizont osvobození"
            >
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

              {/* mini vrstva: kumulativně „kolik % už bude bez daně“ */}
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
                    {pct(view.outlookPath.endShare, 1)}
                  </text>
                </g>
              )}

              {/* tečky dnů/měsíců — víc pozic v jedné tečce, proto žádný odkaz na detail;
                tooltip (hover i focus) nese rozpad po pozicích */}
              {view.visible.map((dot, index) => {
                const cx = view.x(dayNumber(dotIso(dot)));
                // denní tečky menší — v ročním pohledu jich je vedle sebe víc
                const r = isMonthDot(dot)
                  ? 5 + Math.sqrt(dot.weight / view.maxWeight) * 8
                  : 3.5 + Math.sqrt(dot.weight / view.maxWeight) * 6.5;
                const label = `${dotLabel(dot)} — celkem ${totalText(dot)}, ${
                  dot.items.length
                } ${plural(dot.items.length, 'pozice', 'pozice', 'pozic')}${
                  dot.isExempt ? ', už bez daně' : ''
                }`;
                return (
                  <circle
                    key={dot.exemptFrom}
                    cx={cx}
                    cy={AXIS_Y}
                    r={r}
                    fillOpacity="0.9"
                    stroke="var(--plocha)"
                    strokeWidth="1.5"
                    tabIndex={0}
                    role="img"
                    aria-label={label}
                    className={cn(
                      // dark:hover explicitně — samotný hover: by v dark prohrál s dark:fill
                      // viditelný focus ring: globální outline (:focus-visible) + růžový stroke,
                      // žádné focus:outline-none (a11y)
                      'hover:fill-ruzova focus-visible:fill-ruzova focus-visible:stroke-ruzova dark:hover:fill-ruzova',
                      // v dark módu čekající tečky světlejší, ať nesplývají s plochou
                      dot.isExempt ? 'fill-zelena' : 'fill-inkoust-tlumeny dark:fill-inkoust',
                    )}
                    style={{ animation: `dot-in 0.3s ease-out ${Math.min(index, 40) * 25}ms both` }}
                    onMouseEnter={showTip(dot)}
                    onMouseLeave={() => setTip(null)}
                    onFocus={showTip(dot)}
                    onBlur={() => setTip(null)}
                  />
                );
              })}
            </svg>
          </div>
        </div>

        {/* affordance přetečení: gradient „vpravo je toho víc“ (jen při overflow) */}
        {fadeRight && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 right-0 w-12 bg-gradient-to-r from-transparent to-plocha"
          />
        )}

        {/* hover/focus tooltip — mimo overflow-x kontejner (ten by ho svisle
            ořízl); u krajů ho pixelový clamp drží uvnitř wrapperu */}
        {tip && (
          <div
            className="pointer-events-none absolute z-10 max-w-[230px] -translate-x-1/2 -translate-y-full rounded-md border border-linka bg-plocha px-3 py-2 text-xs shadow-sm"
            style={{ left: `clamp(115px, ${tip.x}px, calc(100% - 115px))`, top: `${tip.y}px` }}
          >
            <p className="font-semibold text-inkoust">
              {dotLabel(tip.dot)} — celkem {totalText(tip.dot)}
            </p>
            {tip.dot.items.slice(0, TIP_MAX_ITEMS).map((item) => (
              <p key={item.isin} className="flex items-center gap-2 font-mono text-inkoust-tlumeny">
                <span className="truncate">{item.label}</span>
                <span className="ml-auto whitespace-nowrap pl-2 text-inkoust">
                  {tip.dot.weightBasis === 'value'
                    ? czkCompact(item.weight)
                    : `${qty(item.quantity)} ks`}
                </span>
              </p>
            ))}
            {tip.dot.items.length > TIP_MAX_ITEMS && (
              <p className="text-inkoust-tlumeny">
                + {plural(tip.dot.items.length - TIP_MAX_ITEMS, 'další', 'další', 'dalších')}{' '}
                {tip.dot.items.length - TIP_MAX_ITEMS}
              </p>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-4 text-xs text-inkoust-tlumeny">
        {hasExempt && (
          <span className="flex items-center gap-1">
            <span className="inline-block size-2 rounded-full bg-zelena" /> osvobozené
          </span>
        )}
        {hasPending && (
          <span className="flex items-center gap-1">
            <span className="inline-block size-2 rounded-full bg-inkoust-tlumeny dark:bg-inkoust" />{' '}
            čekající
          </span>
        )}
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
