'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { groupHorizonDots, type ExemptionOutlook, type HorizonDot } from '@/lib/charts-data';
import { czDate, czkCompact, MONTH_LABELS, pct, plural, qty } from '@/lib/format';
import { InfoPopover } from '@/components/ui/info-popover';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { cn } from '@/lib/utils';

/**
 * Horizont osvobození: časový pás, tečka = den (pohled „1 rok“), nebo měsíc
 * (delší pohledy — aktuální měsíc ale zůstává po dnech, ať žádná tečka neleží
 * za čárou „dnes“ s neosvobozenými kusy). Velikost tečky = celková hodnota
 * (známe-li ceny), jinak kusy. Pod osou běží kumulativní plocha „kolik % už
 * bude bez daně“.
 *
 * Pás se kreslí ve skutečných pixelech podle šířky místa, které dostane —
 * písmo i tečky tak mají na telefonu stejnou velikost jako na monitoru a nic
 * se neposouvá do strany. Minulost zabírá jen kousek: starší osvobozené kusy
 * shrnuje jedna tečka vlevo, protože rozhodují ty, které teprve přijdou.
 *
 * Rozpad tečky ukáže najetí myší, fokus z klávesnice i prst: tažením po pásu
 * se přechází mezi tečkami, takže na přesný zásah drobné tečky nezáleží.
 */

/**
 * Dvě období stačí. Tečka se dál než na konec tříletého časového testu dostat
 * nemůže, takže samostatná volba „vše“ ukazovala pořád totéž co „3 roky“, jen
 * o kousek přiblížené — klik navíc bez nové informace. „3 roky“ proto rovnou
 * je úplný pohled (`full`) a natáhne se i za tři roky, když je za čím.
 */
const RANGES = [
  { key: '1r', label: '1 rok', years: 1, full: false },
  { key: '3r', label: '3 roky', years: 3, full: true },
] as const;

type RangeKey = (typeof RANGES)[number]['key'];

/* Geometrie v pixelech: osa s tečkami nahoře, popisky měsíců, dole vrstva
   kumulativního osvobozování. Šířka se měří, výška je pevná. */
const HEIGHT = 150;
const AXIS_Y = 50;
const TICK_TOP = 66;
const TICK_BOTTOM = 71;
const TICK_LABEL_Y = 85;
const OUTLOOK_TOP = 100; // = 100 %
const OUTLOOK_BASE = 140; // = 0 %
const EDGE = 14;
/** Šířka, se kterou kreslí server a prohlížeč před prvním změřením. */
const FALLBACK_WIDTH = 1000;
/** Místo vlevo pro souhrnnou tečku starších osvobozených kusů. */
const PILE_SLOT = 38;
/** Jak velký kus pásu smí zabrat minulost (podíl z délky výhledu). */
const PAST_SHARE = 0.18;
/** Dosah prstu a myši: tečka se chytí, i když ukazatel míří těsně vedle. */
const REACH_PX = 22;

/** Klíč souhrnné tečky — není to datum, na osu času nepatří. */
const PILE_KEY = 'pile';

const monthLabel = (month: string): string => {
  const [y, m] = month.split('-');
  return `${MONTH_LABELS[Number(m) - 1] ?? m} ${y}`;
};

const isPile = (dot: HorizonDot): boolean => dot.exemptFrom === PILE_KEY;
/** Měsíční tečka nese 'YYYY-MM' (po slučování), denní plné 'YYYY-MM-DD'. */
const isMonthDot = (dot: HorizonDot): boolean => dot.exemptFrom.length === 7;
const dotIso = (dot: HorizonDot): string =>
  isMonthDot(dot) ? `${dot.exemptFrom}-01` : dot.exemptFrom;
/** Popisek tečky: měsíc („čvc 2026“), konkrétní den („23. 7. 2026“), nebo souhrn. */
const dotLabel = (dot: HorizonDot): string =>
  isPile(dot)
    ? 'Bez daně už dřív'
    : isMonthDot(dot)
      ? monthLabel(dot.exemptFrom)
      : czDate(dot.exemptFrom);

/** Celková váha tečky jako text: CZK, nebo počet kusů (weight = součet kusů). */
const totalText = (dot: HorizonDot): string =>
  dot.weightBasis === 'value' ? czkCompact(dot.weight) : `${qty(dot.weight)} ks`;

/** Max řádků rozpadu v bublině — víc pozic shrne „+ dalších N“. */
const TIP_MAX_ITEMS = 8;

const dayNumber = (iso: string): number => new Date(`${iso}T00:00:00`).getTime() / 86_400_000;

/** Sloučí starší osvobozené tečky do jedné souhrnné (jen pro vykreslení). */
function pileOf(dots: HorizonDot[]): HorizonDot | null {
  if (dots.length === 0) return null;
  const items = new Map<string, HorizonDot['items'][number]>();
  for (const dot of dots) {
    for (const item of dot.items) {
      const existing = items.get(item.isin);
      if (existing) {
        existing.quantity += item.quantity;
        existing.weight += item.weight;
      } else {
        items.set(item.isin, { ...item });
      }
    }
  }
  return {
    exemptFrom: PILE_KEY,
    weight: dots.reduce((sum, dot) => sum + dot.weight, 0),
    weightBasis: dots[0]!.weightBasis,
    isExempt: true,
    items: [...items.values()].sort((a, b) => b.weight - a.weight),
  };
}

/**
 * Výklad horizontu — do vysvětlivky u nadpisu, ne do odstavce nad grafem.
 * Přehled ji dává k nadpisu sekce (nadpis tam kreslí `ViewSwitch`), samostatný
 * horizont si ji k nadpisu přidá sám.
 */
export function HorizonInfo({ byValue }: { byValue: boolean }) {
  return (
    <InfoPopover label="Horizont osvobození" align="start">
      <p>
        Tečka je chvíle, kdy dalším kusům doběhne tříletý časový test — od té doby je jejich prodej
        bez daně. Zelené už ho mají za sebou; první tečka vlevo shrnuje všechny starší.
      </p>
      <p>
        Velikost tečky odpovídá {byValue ? 'celkové hodnotě' : 'celkovému počtu kusů'}. V pohledu na
        3 roky je tečka měsíc (aktuální měsíc po dnech), v ročním den. Najetím, klepnutím nebo
        tažením po pásu zobrazíš rozpad.
      </p>
      <p>Spodní křivka ukazuje, jaký podíl portfolia už bude bez daně.</p>
    </InfoPopover>
  );
}

interface PlacedDot {
  dot: HorizonDot;
  cx: number;
  r: number;
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
  const [width, setWidth] = useState(FALLBACK_WIDTH);
  // vybraná tečka (klíč `exemptFrom`) a čím byla vybraná — dotyk ji nechává
  // svítit i po zvednutí prstu, myš ji s odjezdem zhasne
  const [active, setActive] = useState<{ key: string; by: 'pointer' | 'touch' | 'focus' } | null>(
    null,
  );
  const wrapRef = useRef<HTMLDivElement>(null);

  // šířku známe až v prohlížeči; měří se před prvním vykreslením na obrazovku,
  // aby pás neproblikl ve zmenšené podobě
  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const measure = () => {
      if (wrap.clientWidth > 0) setWidth(wrap.clientWidth);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, []);

  // dotykem vybraná tečka zhasne klepnutím kamkoli mimo pás
  const activeBy = active?.by;
  useEffect(() => {
    if (activeBy !== 'touch') return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && wrapRef.current?.contains(event.target)) return;
      setActive(null);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [activeBy]);

  const view = useMemo(() => {
    if (dots.length === 0) return null;
    const preset = RANGES.find((r) => r.key === range)!;
    const xMax = width - EDGE;
    const narrow = width < 480;
    // „1 rok“ po dnech; delší pohledy po měsících (aktuální měsíc po dnech)
    const grouped = groupHorizonDots(dots, preset.years === 1 ? 'day' : 'month', today);
    const todayDay = dayNumber(today);
    // aritmeticky (ne skládáním data) — „29. 2. + rok“ by byl Invalid Date
    const presetEnd = todayDay + preset.years * 365.25;
    // Úplný pohled sahá i za tři roky: kusům koupeným dnes doběhne test o pár
    // dní později (vypořádání T+2, přestupný rok) a bez tohohle by z grafu
    // vypadly do hlášky „mimo zobrazené období“ — přitom nikde jinde je vidět nejde.
    const horizonEnd = preset.full
      ? Math.max(presetEnd, ...grouped.map((dot) => dayNumber(dotIso(dot))))
      : presetEnd;
    const futureSpan = Math.max(60, horizonEnd - todayDay);

    // Minulost: jen kousek před „dnes“. Starší tečky (vždy už osvobozené)
    // shrne jedna souhrnná vlevo — dřív zabíraly polovinu pásu a to, na co se
    // teprve čeká, se mačkalo vpravo.
    const pastStart = todayDay - futureSpan * PAST_SHARE;
    const older = grouped.filter((dot) => dayNumber(dotIso(dot)) < pastStart);
    const pile = pileOf(older);
    const timed = grouped.filter((dot) => {
      const day = dayNumber(dotIso(dot));
      return day >= pastStart && day <= horizonEnd;
    });
    const hidden = grouped.length - timed.length - older.length;
    const hasPast = timed.some((dot) => dayNumber(dotIso(dot)) < todayDay);

    const pad = futureSpan * 0.04;
    const startDay = hasPast || pile ? pastStart : todayDay - pad;
    const endDay = horizonEnd + pad;
    const xStart = EDGE + (pile ? PILE_SLOT : 0);
    const x = (day: number) => xStart + ((day - startDay) / (endDay - startDay)) * (xMax - xStart);
    const maxWeight = Math.max(...timed.map((dot) => dot.weight), 1);
    const scale = narrow ? 0.8 : 1;

    const placed: PlacedDot[] = timed.map((dot) => ({
      dot,
      cx: x(dayNumber(dotIso(dot))),
      // denní tečky menší — v ročním pohledu jich je vedle sebe víc
      r:
        (isMonthDot(dot)
          ? 4 + Math.sqrt(dot.weight / maxWeight) * 8
          : 3 + Math.sqrt(dot.weight / maxWeight) * 6) * scale,
    }));
    if (pile) placed.unshift({ dot: pile, cx: EDGE, r: 12 * scale });

    // ── popisky měsíců/roků na ose ────────────────────────────────────────
    const first = new Date(startDay * 86_400_000);
    let tickYear = first.getFullYear();
    let tickMonth = first.getMonth() + 1; // 1–12
    const months: Array<{ day: number; month: number; year: number }> = [];
    for (let i = 0; i < 600; i += 1) {
      const day = dayNumber(`${tickYear}-${String(tickMonth).padStart(2, '0')}-01`);
      if (day > endDay) break;
      if (day >= startDay) months.push({ day, month: tickMonth, year: tickYear });
      tickMonth += 1;
      if (tickMonth > 12) {
        tickMonth = 1;
        tickYear += 1;
      }
    }
    // hustota podle místa: měsíčně → čtvrtletně → pololetně → jen roky
    // (leden nese letopočet); popisek potřebuje aspoň 40 px
    const pxPerMonth = (xMax - xStart) / Math.max(1, (endDay - startDay) / 30.44);
    const step = [1, 3, 6, 12].find((count) => pxPerMonth * count >= 40) ?? 12;
    const ticks = months
      .filter((m) => (m.month - 1) % step === 0)
      .map((m) => ({
        x: x(m.day),
        label: m.month === 1 ? String(m.year) : MONTH_LABELS[m.month - 1]!,
        isYear: m.month === 1,
      }))
      // popisek u kraje by přetekl ven z pásu
      .filter((tick) => tick.x >= xStart + 12 && tick.x <= xMax - 12);

    // ── kumulativní plocha osvobozování (stepAfter) ───────────────────────
    let outlookPath: { line: string; area: string; endShare: number } | null = null;
    if (outlook && outlook.points.length > 0) {
      const clampX = (v: number) => Math.min(xMax, Math.max(xStart, v));
      const yOf = (share: number) => OUTLOOK_BASE - (share / 100) * (OUTLOOK_BASE - OUTLOOK_TOP);
      const pts = outlook.points
        .map((p) => ({ day: dayNumber(p.date), share: p.exemptShare }))
        .filter((p) => p.day <= endDay)
        .sort((a, b) => a.day - b.day);
      if (pts.length > 0) {
        const x0 = clampX(x(pts[0]!.day));
        let line = `M ${x0} ${yOf(pts[0]!.share)}`;
        for (const p of pts.slice(1)) line += ` H ${clampX(x(p.day))} V ${yOf(p.share)}`;
        line += ` H ${xMax}`;
        outlookPath = {
          line,
          area: `${line} V ${OUTLOOK_BASE} H ${x0} Z`,
          endShare: pts[pts.length - 1]!.share,
        };
      }
    }

    return { placed, hidden, todayX: x(todayDay), xStart, xMax, ticks, outlookPath, pile };
  }, [dots, today, range, outlook, width]);

  if (!view) return null;

  // Výklad grafu není pod nadpisem, ale ve vysvětlivce (`HorizonInfo`); tady
  // zůstává jen údaj, který se mění s daty a jinde vidět není.
  const hiddenNote =
    view.hidden > 0
      ? `Mimo zobrazené období: ${view.hidden} ${plural(view.hidden, 'tečka', 'tečky', 'teček')}.`
      : null;

  const rangeButtons = (
    <SegmentedControl
      ariaLabel="Období horizontu"
      value={range}
      onChange={(key) => {
        setRange(key as RangeKey);
        setActive(null);
      }}
      segments={RANGES.map((preset) => ({ key: preset.key, label: preset.label }))}
    />
  );

  /** Nejbližší tečka k ukazateli (v pixelech pásu), je-li v dosahu. */
  const nearest = (event: React.PointerEvent<SVGSVGElement>): PlacedDot | null => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width === 0) return null;
    const pointerX = ((event.clientX - rect.left) / rect.width) * width;
    let best: PlacedDot | null = null;
    let bestDistance = Infinity;
    for (const item of view.placed) {
      const distance = Math.abs(item.cx - pointerX);
      if (distance < bestDistance && distance <= Math.max(item.r, REACH_PX)) {
        best = item;
        bestDistance = distance;
      }
    }
    return best;
  };

  const point = (event: React.PointerEvent<SVGSVGElement>) => {
    const hit = nearest(event);
    const by = event.pointerType === 'mouse' ? 'pointer' : 'touch';
    // prst, který při tažení sjede mimo dosah teček, výběr nezhasíná
    const keepOnMiss = by === 'touch' && event.type === 'pointermove';
    setActive((current) => {
      if (!hit) return keepOnMiss ? current : null;
      return current?.key === hit.dot.exemptFrom && current.by === by
        ? current
        : { key: hit.dot.exemptFrom, by };
    });
  };

  const activeItem = active
    ? (view.placed.find((item) => item.dot.exemptFrom === active.key) ?? null)
    : null;

  // legenda jen pro stavy, které v datech opravdu jsou (žádné „osvobozené“
  // bez jediné zelené tečky)
  const hasExempt = view.placed.some((item) => item.dot.isExempt);
  const hasPending = view.placed.some((item) => !item.dot.isExempt);

  const legend = (
    <div className="type-caption flex flex-wrap gap-x-5 gap-y-1 text-ink-muted">
      {hasExempt && (
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-2 rounded-full bg-success" /> osvobozené
        </span>
      )}
      {hasPending && (
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-2 rounded-full bg-ink-muted dark:bg-ink" /> čekající
        </span>
      )}
      {view.outlookPath && (
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 rounded bg-chart-1" /> podíl bez daně
        </span>
      )}
      {hiddenNote && <span>{hiddenNote}</span>}
    </div>
  );

  // měřítko mezi souřadnicemi pásu a obrazovkou je 1 : 1, jakmile je šířka
  // změřená; do té doby (a bez JavaScriptu) se pás vejde zmenšený
  const tipLeft = activeItem ? `${(activeItem.cx / width) * 100}%` : '0';

  const strip = (
    <div ref={wrapRef} className="relative mt-3 min-w-0 max-w-full">
      {/* bez role="img" na svg — fokusovatelné tečky musí zůstat v accessibility tree */}
      <svg
        viewBox={`0 0 ${width} ${HEIGHT}`}
        height={HEIGHT}
        className="block w-full touch-pan-y select-none"
        aria-label="Horizont osvobození"
        onPointerDown={point}
        onPointerMove={point}
        onPointerLeave={(event) => {
          if (event.pointerType === 'mouse') setActive(null);
        }}
      >
        {/* osa + popisky měsíců/roků */}
        <line
          x1={view.xStart}
          y1={AXIS_Y}
          x2={view.xMax}
          y2={AXIS_Y}
          stroke="var(--line)"
          strokeWidth="1.5"
        />
        {view.ticks.map((tick) => (
          <g key={tick.x}>
            <line
              x1={tick.x}
              y1={TICK_TOP}
              x2={tick.x}
              y2={TICK_BOTTOM}
              stroke="var(--line)"
              strokeWidth="1"
            />
            <text
              x={tick.x}
              y={TICK_LABEL_Y}
              textAnchor="middle"
              fontSize="11"
              fill="var(--ink-muted)"
              fontWeight={tick.isYear ? 600 : 400}
              className="tabular-nums"
            >
              {tick.label}
            </text>
          </g>
        ))}
        {view.pile && (
          <text x={EDGE - 12} y={TICK_LABEL_Y} fontSize="11" fill="var(--ink-muted)">
            dřív
          </text>
        )}

        {/* dnešek napříč oběma vrstvami */}
        <line
          x1={view.todayX}
          y1="16"
          x2={view.todayX}
          y2={OUTLOOK_BASE}
          stroke="var(--accent)"
          strokeWidth="1.5"
        />
        <text x={view.todayX + 6} y="24" fontSize="12" fill="var(--accent-text)">
          dnes
        </text>

        {/* mini vrstva: kumulativně „kolik % už bude bez daně“ */}
        {view.outlookPath && (
          <g>
            <line
              x1={view.xStart}
              y1={OUTLOOK_BASE}
              x2={view.xMax}
              y2={OUTLOOK_BASE}
              stroke="var(--line)"
              strokeWidth="1"
            />
            <path d={view.outlookPath.area} fill="var(--chart-1)" fillOpacity="0.12" />
            <path
              d={view.outlookPath.line}
              fill="none"
              stroke="var(--chart-1)"
              strokeWidth="1.5"
              strokeOpacity="0.8"
            />
            <text
              x={view.xMax - 4}
              y={
                OUTLOOK_BASE - (view.outlookPath.endShare / 100) * (OUTLOOK_BASE - OUTLOOK_TOP) - 5
              }
              textAnchor="end"
              fontSize="11"
              fill="var(--ink-muted)"
              className="tabular-nums"
            >
              {pct(view.outlookPath.endShare, 1)}
            </text>
          </g>
        )}

        {/* tečky dnů/měsíců — víc pozic v jedné tečce, proto žádný odkaz na
            detail; rozpad po pozicích nese bublina */}
        {view.placed.map(({ dot, cx, r }) => {
          const isActive = activeItem?.dot.exemptFrom === dot.exemptFrom;
          const label = `${dotLabel(dot)} — celkem ${totalText(dot)}, ${dot.items.length} ${plural(
            dot.items.length,
            'pozice',
            'pozice',
            'pozic',
          )}${dot.isExempt && !isPile(dot) ? ', už bez daně' : ''}`;
          return (
            <circle
              key={dot.exemptFrom}
              cx={cx}
              cy={AXIS_Y}
              r={r}
              fillOpacity="0.92"
              strokeWidth={isActive ? 2 : 1.5}
              tabIndex={0}
              role="img"
              aria-label={label}
              className={cn(
                // vybraná tečka dostane akcentní obrys (barva ovládání); barvu stavu si nechává
                isActive ? 'stroke-accent' : 'stroke-surface',
                // v tmavém režimu čekající tečky světlejší, ať nesplývají s plochou
                dot.isExempt ? 'fill-success' : 'fill-ink-muted dark:fill-ink',
              )}
              onFocus={() => setActive({ key: dot.exemptFrom, by: 'focus' })}
              onBlur={() => setActive((current) => (current?.by === 'focus' ? null : current))}
            />
          );
        })}
      </svg>

      {/* bublina s rozpadem — u krajů ji pixelový clamp drží uvnitř pásu */}
      {activeItem && (
        <div
          className="pointer-events-none absolute z-10 w-max max-w-[230px] -translate-x-1/2 -translate-y-full rounded-lg bg-surface px-3 py-2 text-xs shadow-floating dark:bg-control"
          style={{
            left: `clamp(115px, ${tipLeft}, calc(100% - 115px))`,
            top: `${AXIS_Y - activeItem.r - 8}px`,
          }}
        >
          <p className="font-semibold text-ink">
            {dotLabel(activeItem.dot)} — celkem {totalText(activeItem.dot)}
          </p>
          {activeItem.dot.items.slice(0, TIP_MAX_ITEMS).map((item) => (
            <p key={item.isin} className="flex items-center gap-2 tabular-nums text-ink-muted">
              <span className="truncate">{item.label}</span>
              <span className="ml-auto whitespace-nowrap pl-2 text-ink">
                {activeItem.dot.weightBasis === 'value'
                  ? czkCompact(item.weight)
                  : `${qty(item.quantity)} ks`}
              </span>
            </p>
          ))}
          {activeItem.dot.items.length > TIP_MAX_ITEMS && (
            <p className="text-ink-muted">
              + {plural(activeItem.dot.items.length - TIP_MAX_ITEMS, 'další', 'další', 'dalších')}{' '}
              {activeItem.dot.items.length - TIP_MAX_ITEMS}
            </p>
          )}
        </div>
      )}
    </div>
  );

  const byValue = dots[0]?.weightBasis === 'value';

  if (embedded) {
    return (
      <div>
        {strip}
        <div className="mt-2 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          {legend}
          {rangeButtons}
        </div>
      </div>
    );
  }

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <h2 className="type-title-2">Horizont osvobození</h2>
          <HorizonInfo byValue={byValue} />
        </div>
        {rangeButtons}
      </div>
      {strip}
      <div className="mt-2">{legend}</div>
    </section>
  );
}
