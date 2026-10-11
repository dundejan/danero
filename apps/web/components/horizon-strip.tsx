'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  groupHorizonDots,
  outlookBasisNote,
  type ExemptionOutlook,
  type HorizonDot,
  type HorizonWeightBasis,
} from '@/lib/charts-data';
import { czDate, czkCompact, MONTH_LABELS, pct, plural, qty } from '@/lib/format';
import { InfoPopover } from '@/components/ui/info-popover';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { cn } from '@/lib/utils';

/**
 * Horizont osvobození: časový pás, tečka = den (pohled „1 rok“), nebo měsíc
 * (delší pohledy — aktuální měsíc ale zůstává po dnech, ať žádná tečka neleží
 * za čárou „dnes“ s neosvobozenými kusy). Velikost tečky = celková hodnota
 * (známe-li ceny), jinak nabývací cena; kusy jen u jediného titulu. Pod osou
 * běží kumulativní plocha „kolik % už bude bez daně“.
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
/** Popisek měsíce blíž než tolik pixelů k čáře „dnes“ se nekreslí. */
const TODAY_CLEARANCE = 18;
/** Dosah prstu a myši: tečka se chytí, i když ukazatel míří těsně vedle. */
const REACH_PX = 22;

/** Bublina s rozpadem tečky: nejširší podoba a odstup od tečky. */
const TIP_MAX_WIDTH = 230;
const TIP_GAP = 10;

/**
 * Kam bublina patří. Stojí VEDLE tečky a uvnitř pásu — ne nad ní: nad pásem
 * je nadpis sekce a bublina nejlevější tečky (souhrn starších kusů, tedy ta
 * nejvyšší) ho celý zakryla. Vedle tečky taky neleží pod prstem.
 *
 * - Vpravo, když se tam vejde celá; jinak na tu stranu, kde je víc místa,
 *   a zúžená na šířku, která tam zbývá (telefon, tečka uprostřed pásu).
 * - Svisle je vystředěná na tečku; vyšší bublina začíná u horní hrany pásu
 *   a roste dolů přes legendu, ne nahoru přes nadpis.
 *
 * Souřadnice jsou v pixelech pásu (`width` × `HEIGHT`).
 */
export function tipPlacement(args: { cx: number; r: number; width: number; tipHeight: number }): {
  side: 'left' | 'right';
  /** Vzdálenost bližší hrany bubliny od téže hrany pásu. */
  inset: number;
  maxWidth: number;
  top: number;
} {
  const { cx, r, width, tipHeight } = args;
  const rightSpace = width - (cx + r + TIP_GAP);
  const leftSpace = cx - r - TIP_GAP;
  const side = rightSpace >= TIP_MAX_WIDTH || rightSpace >= leftSpace ? 'right' : 'left';
  return {
    side,
    inset: side === 'right' ? cx + r + TIP_GAP : width - (cx - r - TIP_GAP),
    maxWidth: Math.min(TIP_MAX_WIDTH, Math.max(side === 'right' ? rightSpace : leftSpace, 0)),
    top: Math.max(0, AXIS_Y - tipHeight / 2),
  };
}

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

/**
 * Rozpětí sloučených termínů: „úno – kvě 2027“, „lis 2026 – úno 2027“, u dnů
 * „3. 10. 2026 – 25. 10. 2026“.
 */
const rangeLabel = (first: HorizonDot, last: HorizonDot): string => {
  if (
    isMonthDot(first) &&
    isMonthDot(last) &&
    first.exemptFrom.slice(0, 4) === last.exemptFrom.slice(0, 4)
  ) {
    return `${MONTH_LABELS[Number(first.exemptFrom.slice(5, 7)) - 1]} – ${monthLabel(last.exemptFrom)}`;
  }
  return `${dotLabel(first)} – ${dotLabel(last)}`;
};

/**
 * Součet tečky jako text: částka v Kč, když se váží hodnotou. Pozice bez ceny
 * do částky nevstupuje — text to přizná, aby „0 Kč“ nevypadalo jako bezcenná
 * pozice. Bez cen zbývají kusy, a ty se sčítají jen v rámci jednoho titulu:
 * u tečky s víc tituly součet není (`null`) a kusy nese rozpad po pozicích.
 * Do 11. 10. 2026 tu stálo „celkem 46 ks“ za 40 akcií a 6 kusů fondu.
 */
const totalText = (dot: HorizonDot): string | null => {
  if (dot.weightBasis !== 'value') {
    const [only, ...others] = dot.items;
    return only && others.length === 0 ? `celkem ${qty(only.quantity)} ks` : null;
  }
  const unpriced = dot.items.filter((item) => item.unpriced).length;
  if (unpriced === dot.items.length) return 'bez ceny';
  return `celkem ${czkCompact(dot.weight)}${unpriced > 0 ? ' + bez ceny' : ''}`;
};

/** Max řádků rozpadu v bublině — víc pozic shrne „+ dalších N“. */
const TIP_MAX_ITEMS = 8;

const dayNumber = (iso: string): number => new Date(`${iso}T00:00:00`).getTime() / 86_400_000;

/** Sloučí tečky do jedné: váhy se sečtou, pozice téhož titulu taky (jen pro vykreslení). */
function mergeDots(dots: HorizonDot[], exemptFrom: string): HorizonDot {
  const items = new Map<string, HorizonDot['items'][number]>();
  for (const dot of dots) {
    for (const item of dot.items) {
      const existing = items.get(item.isin);
      if (existing) {
        existing.quantity += item.quantity;
        existing.weight += item.weight;
        if (!item.unpriced) delete existing.unpriced;
      } else {
        items.set(item.isin, { ...item });
      }
    }
  }
  return {
    exemptFrom,
    weight: dots.reduce((sum, dot) => sum + dot.weight, 0),
    weightBasis: dots[0]!.weightBasis,
    isExempt: dots.every((dot) => dot.isExempt),
    items: [...items.values()].sort((a, b) => b.weight - a.weight),
  };
}

/** Sloučí starší osvobozené tečky do jedné souhrnné (jen pro vykreslení). */
function pileOf(dots: HorizonDot[]): HorizonDot | null {
  return dots.length === 0 ? null : { ...mergeDots(dots, PILE_KEY), isExempt: true };
}

/**
 * Výklad horizontu — do vysvětlivky u nadpisu, ne do odstavce nad grafem.
 * Přehled ji dává k nadpisu sekce (nadpis tam kreslí `ViewSwitch`), samostatný
 * horizont si ji k nadpisu přidá sám.
 */
export function HorizonInfo({
  basis,
  outlook,
}: {
  basis: HorizonWeightBasis | undefined;
  /** Křivka pod tečkami; `null` = nekreslí se a vysvětlivka o ní mlčí. */
  outlook: ExemptionOutlook | null;
}) {
  // Legenda, ne návod (R1B-24): co tečka, barva a velikost znamenají. Jak se
  // pás ovládá, pozná člověk najetím nebo klepnutím.
  const size =
    basis === 'value'
      ? 'celkové hodnotě'
      : basis === 'cost'
        ? // proč ne dnešní hodnotě, říká hned věta o křivce — bez křivky to řekne tahle
          `nabývací ceně${outlook ? '' : ' (dnešní ceny známe jen od připojeného brokera)'}`
        : 'počtu kusů';
  const outlookNote = outlook ? outlookBasisNote(outlook) : null;
  return (
    <InfoPopover label="Horizont osvobození" align="start">
      <p>
        Tečka je chvíle, kdy dalším kusům doběhne tříletý časový test — od té doby je jejich prodej
        bez daně. Zelené už ho mají za sebou; první tečka vlevo shrnuje všechny starší.
      </p>
      <p>
        Velikost tečky odpovídá {size}; termíny blízko sebe se slučují do jedné.
      </p>
      {outlook && (
        <p>
          Spodní křivka je podíl portfolia, který už bude bez daně.
          {/* z čeho se podíl počítá, když to není celé portfolio v dnešních
              cenách — totéž znění jako u křivky na portfoliu */}
          {outlookNote && ` ${outlookNote}`}
        </p>
      )}
    </InfoPopover>
  );
}

interface PlacedDot {
  dot: HorizonDot;
  cx: number;
  r: number;
  /** Popisek do bubliny a pro čtečku: den, měsíc, nebo rozpětí sloučených termínů. */
  label: string;
}

/** Nejmenší poloměr, na který se sousední tečky různého stavu smí zmenšit. */
const MIN_RADIUS = 3;

/**
 * Tečky, které by se překryly, sloučí do jedné (R1A-13). Ve tříletém pohledu
 * připadá na telefonu na měsíc šest pixelů a přes dvacet teček se slilo do tří
 * šedých hroud — jednotlivou nešlo rozeznat ani trefit prstem. Sloučená tečka
 * stojí uprostřed svého rozpětí, nese součet vah a rozpad všech pozic; bublina
 * řekne, které období shrnuje.
 *
 * - Slučují se jen tečky téhož stavu: zelená (už bez daně) a čekající nikdy
 *   nesplynou, hranici mezi nimi drží čára „dnes“. Když se přes ni přece
 *   dotknou, obě se zmenší, aby jedna nezakryla druhou (R1B-25).
 * - V úzkém pásu stačí ke sloučení dotyk; v širokém až výrazný překryv (střed
 *   jedné tečky uvnitř druhé) — tam je místa dost a lehký přesah nevadí.
 * - Sloučená tečka je větší, takže může dosáhnout na další souseda — proto
 *   se prochází opakovaně, dokud se něco mění.
 */
function separateDots(
  dots: PlacedDot[],
  radius: (weight: number, maxWeight: number, monthDot: boolean) => number,
  narrow: boolean,
): PlacedDot[] {
  // člen shluku si pamatuje první a poslední původní tečku kvůli popisku a poloze
  type Cluster = PlacedDot & { first: PlacedDot; last: PlacedDot; members: HorizonDot[] };
  let clusters: Cluster[] = [...dots]
    .sort((a, b) => a.cx - b.cx)
    .map((dot) => ({ ...dot, first: dot, last: dot, members: [dot.dot] }));

  const collide = (a: Cluster, b: Cluster): boolean => {
    const distance = Math.abs(b.cx - a.cx);
    return narrow ? distance < a.r + b.r + 1 : distance < Math.max(a.r, b.r);
  };

  for (let pass = 0; pass < 12; pass += 1) {
    const maxWeight = Math.max(...clusters.map((cluster) => cluster.dot.weight), 1);
    const next: Cluster[] = [];
    let merged = false;
    for (const cluster of clusters) {
      const previous = next.at(-1);
      if (
        previous &&
        previous.dot.isExempt === cluster.dot.isExempt &&
        collide(previous, cluster)
      ) {
        const members = [...previous.members, ...cluster.members];
        const dot = mergeDots(
          members,
          `${previous.first.dot.exemptFrom}…${cluster.last.dot.exemptFrom}`,
        );
        next[next.length - 1] = {
          dot,
          cx: (previous.first.cx + cluster.last.cx) / 2,
          r: radius(dot.weight, Math.max(maxWeight, dot.weight), isMonthDot(previous.first.dot)),
          label: rangeLabel(previous.first.dot, cluster.last.dot),
          first: previous.first,
          last: cluster.last,
          members,
        };
        merged = true;
      } else {
        next.push(cluster);
      }
    }
    clusters = next;
    if (!merged) break;
  }

  // po sloučení se poloměry přepočítají proti největší tečce v pásu
  const maxWeight = Math.max(...clusters.map((cluster) => cluster.dot.weight), 1);
  const placed: PlacedDot[] = clusters.map(({ dot, cx, label, first }) => ({
    dot,
    cx,
    label,
    r: radius(dot.weight, maxWeight, isMonthDot(first.dot)),
  }));

  // sousedé různého stavu (kolem čáry „dnes“) se neslučují — jen si ustoupí
  for (let i = 1; i < placed.length; i += 1) {
    const a = placed[i - 1]!;
    const b = placed[i]!;
    const distance = b.cx - a.cx;
    if (a.dot.isExempt === b.dot.isExempt || distance >= a.r + b.r) continue;
    const shrink = Math.max(distance - 1, 0) / (a.r + b.r);
    a.r = Math.max(MIN_RADIUS, a.r * shrink);
    b.r = Math.max(MIN_RADIUS, b.r * shrink);
  }
  return placed;
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
  // Tečka, na které se zastaví tabulátor (viz `moveFocus`); `null` = výchozí.
  const [roving, setRoving] = useState<string | null>(null);
  const [tipHeight, setTipHeight] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);

  // Výška bubliny se zná až po vykreslení (počet pozic, zalomený titulek);
  // měří se před nakreslením na obrazovku, takže bublina neposkočí.
  useLayoutEffect(() => {
    const height = tipRef.current?.offsetHeight ?? 0;
    setTipHeight((current) => (current === height ? current : height));
  });

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

    // denní tečky menší — v ročním pohledu jich je vedle sebe víc
    const radius = (weight: number, max: number, monthDot: boolean): number =>
      (monthDot ? 4 + Math.sqrt(weight / max) * 8 : 3 + Math.sqrt(weight / max) * 6) * scale;
    const placed = separateDots(
      timed.map((dot) => ({
        dot,
        cx: x(dayNumber(dotIso(dot))),
        r: radius(dot.weight, maxWeight, isMonthDot(dot)),
        label: dotLabel(dot),
      })),
      radius,
      narrow,
    );
    if (pile) placed.unshift({ dot: pile, cx: EDGE, r: 12 * scale, label: dotLabel(pile) });

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
      // popisek u kraje by přetekl ven z pásu; popisek pod čarou „dnes“ by
      // čára přeškrtla (R1B-25)
      .filter(
        (tick) =>
          tick.x >= xStart + 12 &&
          tick.x <= xMax - 12 &&
          Math.abs(tick.x - x(todayDay)) > TODAY_CLEARANCE,
      );

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
        setRoving(null);
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
  const activeTotal = activeItem ? totalText(activeItem.dot) : null;

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
          <span className="inline-block size-2 rounded-full bg-ink-muted" /> čekající
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
  const tip = activeItem
    ? tipPlacement({ cx: activeItem.cx, r: activeItem.r, width, tipHeight })
    : null;

  /*
   * Pás je pro klávesnici JEDNA zastávka, ne tolik, kolik má teček (v demu
   * 27): tabulátor zastaví na jedné tečce a mezi tečkami se chodí šipkami,
   * Home a End — jako v každé jiné skupině voleb. Zastávkou je naposledy
   * navštívená tečka, jinak nejbližší čekající (kvůli ní se na pás chodí).
   */
  const rovingKey =
    view.placed.find((item) => item.dot.exemptFrom === roving)?.dot.exemptFrom ??
    (view.placed.find((item) => !item.dot.isExempt) ?? view.placed[0])?.dot.exemptFrom;
  const moveFocus = (event: React.KeyboardEvent<SVGCircleElement>, index: number) => {
    const last = view.placed.length - 1;
    const target =
      event.key === 'ArrowRight'
        ? Math.min(index + 1, last)
        : event.key === 'ArrowLeft'
          ? Math.max(index - 1, 0)
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : null;
    if (target === null) return;
    event.preventDefault();
    const circles = event.currentTarget.parentElement?.querySelectorAll<SVGCircleElement>(
      'circle[data-dot]',
    );
    circles?.[target]?.focus();
  };

  const strip = (
    <div ref={wrapRef} className="relative mt-3 min-w-0 max-w-full">
      {/* bez role="img" na svg — fokusovatelné tečky musí zůstat v accessibility tree;
          skupina je pojmenovaná, aby čtečka řekla, čeho jsou tečky součástí */}
      <svg
        viewBox={`0 0 ${width} ${HEIGHT}`}
        height={HEIGHT}
        className="block w-full touch-pan-y select-none"
        role="group"
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
              letterSpacing="0.01em"
              fill="var(--ink-muted)"
              fontWeight={tick.isYear ? 600 : 400}
              className="tabular-nums"
            >
              {tick.label}
            </text>
          </g>
        ))}
        {view.pile && (
          <text
            x={EDGE - 12}
            y={TICK_LABEL_Y}
            fontSize="11"
            letterSpacing="0.01em"
            fill="var(--ink-muted)"
          >
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
            {/* Popisek podílu stojí UVNITŘ plochy pod křivkou, jakmile se tam
                vejde — nad ní se u horního okraje tlačil na popisky měsíců
                (R1B-25). U nízkého podílu zůstává nad křivkou. */}
            <text
              x={view.xMax - 4}
              y={
                view.outlookPath.endShare >= 45
                  ? OUTLOOK_BASE -
                    (view.outlookPath.endShare / 100) * (OUTLOOK_BASE - OUTLOOK_TOP) +
                    13
                  : OUTLOOK_BASE -
                    (view.outlookPath.endShare / 100) * (OUTLOOK_BASE - OUTLOOK_TOP) -
                    5
              }
              textAnchor="end"
              fontSize="11"
              letterSpacing="0.01em"
              fill="var(--ink-muted)"
              className="tabular-nums"
            >
              {pct(view.outlookPath.endShare, 1)}
            </text>
          </g>
        )}

        {/* tečky dnů/měsíců — víc pozic v jedné tečce, proto žádný odkaz na
            detail; rozpad po pozicích nese bublina */}
        {view.placed.map(({ dot, cx, r, label: placedLabel }, index) => {
          const isActive = activeItem?.dot.exemptFrom === dot.exemptFrom;
          const total = totalText(dot);
          const label = `${placedLabel} — ${total ? `${total}, ` : ''}${dot.items.length} ${plural(
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
              data-dot=""
              tabIndex={dot.exemptFrom === rovingKey ? 0 : -1}
              role="img"
              aria-label={label}
              className={cn(
                // vybraná tečka dostane akcentní obrys (barva ovládání); barvu stavu si nechává
                isActive ? 'stroke-accent' : 'stroke-surface',
                // Čekající tečky jsou tiché v obou režimech (R1B-07): v tmavém byly
                // čistě bílé, tedy nejjasnější prvek stránky — důraz ale patří
                // zeleným. `ink-muted` má na černé kontrast přes 7 : 1.
                dot.isExempt ? 'fill-success' : 'fill-ink-muted',
              )}
              onKeyDown={(event) => moveFocus(event, index)}
              onFocus={() => {
                setActive({ key: dot.exemptFrom, by: 'focus' });
                setRoving(dot.exemptFrom);
              }}
              onBlur={() => setActive((current) => (current?.by === 'focus' ? null : current))}
            />
          );
        })}
      </svg>

      {/* bublina s rozpadem — vedle tečky a uvnitř pásu (`tipPlacement`) */}
      {activeItem && tip && (
        <div
          ref={tipRef}
          className="pointer-events-none absolute z-10 w-max rounded-lg bg-surface px-3 py-2 text-xs shadow-floating dark:bg-control"
          style={{
            [tip.side === 'right' ? 'left' : 'right']: `${(tip.inset / width) * 100}%`,
            top: `${tip.top}px`,
            maxWidth: `${tip.maxWidth}px`,
          }}
        >
          <p className="font-semibold text-ink">
            {activeItem.label}
            {activeTotal && ` — ${activeTotal}`}
          </p>
          {activeItem.dot.items.slice(0, TIP_MAX_ITEMS).map((item) => (
            <p key={item.isin} className="flex items-center gap-2 tabular-nums text-ink-muted">
              <span className="truncate">{item.label}</span>
              <span className="ml-auto whitespace-nowrap pl-2 text-ink">
                {activeItem.dot.weightBasis === 'value' && !item.unpriced
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
          {/* jen při chůzi klávesnicí: jak se dostat na další tečku */}
          {active?.by === 'focus' && view.placed.length > 1 && (
            <p className="mt-1 text-ink-muted">Další tečka: šipky ← →</p>
          )}
        </div>
      )}
    </div>
  );

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
          <HorizonInfo basis={dots[0]?.weightBasis} outlook={outlook ?? null} />
        </div>
        {rangeButtons}
      </div>
      {strip}
      <div className="mt-2">{legend}</div>
    </section>
  );
}
