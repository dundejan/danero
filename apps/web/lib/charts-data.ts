import { d, ZERO, type Money, type Transaction } from '@danero/shared';
import type { Position, TaxYearResult } from '@danero/engine';
import type { PortfolioValuation } from '@/lib/portfolio-value';
import type { InstrumentPrice } from '@/lib/prices';
import { UNIFIED_RATES } from '@/lib/tax-config';

/**
 * Agregace pro grafy (G3). Zásada: ŽÁDNÁ daňová logika — jen přeskládání
 * hodnot, které engine už spočítal (docs/02 platí jen pro engine). Výstupy
 * jsou prosté číselné řady pro klientské komponenty grafů.
 */

export interface RunningPoint {
  /** ISO datum události. */
  date: string;
  /** Kumulativní čerpání limitu v CZK po této události. */
  value: number;
}

export interface LimitSeries {
  points: RunningPoint[];
  limitCzk: number;
  usedCzk: number;
}

const num = (value: Money): number => value.toNumber();

/** Sečte příspěvky po datech do kumulativní řady (začíná nulou 1. 1.). */
function toRunningSeries(
  year: number,
  contributions: Array<{ date: string; amountCzk: Money }>,
  initialCzk: Money = ZERO,
): RunningPoint[] {
  const sorted = [...contributions].sort((a, b) => a.date.localeCompare(b.date));
  const points: RunningPoint[] = [{ date: `${year}-01-01`, value: num(initialCzk) }];
  let running = initialCzk;
  for (const item of sorted) {
    running = running.plus(item.amountCzk);
    points.push({ date: item.date, value: num(running) });
  }
  return points;
}

/**
 * Čerpání limitu 100k v průběhu roku — příspěvky per prodej reportuje engine
 * (limit100kContributionCzk dle R-02c), tady se jen kumulují.
 */
export function limit100kSeries(result: TaxYearResult): LimitSeries {
  const contributions = result.securities.disposals.map((disposal) => ({
    date: disposal.saleDate,
    amountCzk: disposal.limit100kContributionCzk,
  }));
  return {
    points: toRunningSeries(result.year, contributions),
    limitCzk: num(result.limits.limit100k.limitCzk),
    usedCzk: num(result.limits.limit100k.usedCzk),
  };
}

/** Čerpání limitu 50k (paušální daň) — prodeje mimo osvobození + dividendy + úroky. */
export function flatTax50kSeries(result: TaxYearResult): LimitSeries | null {
  if (!result.limits.flatTax50k.applicable) return null;
  const contributions: Array<{ date: string; amountCzk: Money }> = [
    ...[...result.securities.disposals, ...result.crypto.disposals].map((disposal) => ({
      date: disposal.saleDate,
      amountCzk: disposal.taxableProceedsCzk,
    })),
    // R-12q: deriváty čerpají limit hrubými kladnými plněními
    ...result.derivatives.items.map((item) => ({ date: item.date, amountCzk: item.incomeCzk })),
    ...result.dividends.items
      .filter((item) => !item.isCzech)
      .map((item) => ({ date: item.date, amountCzk: item.grossCzk })),
    // R-07a/R-07g: český příjem vypořádaný srážkou u zdroje limit nečerpá —
    // ve výpisu úroků je kvůli časovým řadám, ale do čerpání nepatří
    ...result.dividends.interestItems
      .filter((item) => item.inBase8)
      .map((item) => ({ date: item.date, amountCzk: item.amountCzk })),
  ];
  // ruční „ostatní příjmy“ z profilu čerpají limit od začátku roku
  const initial = result.limits.flatTax50k.components.otherManualCzk;
  return {
    points: toRunningSeries(result.year, contributions, initial),
    limitCzk: num(result.limits.flatTax50k.status.limitCzk),
    usedCzk: num(result.limits.flatTax50k.status.usedCzk),
  };
}

export interface MonthRow {
  /** 'YYYY-MM' pro osu. */
  month: string;
  [country: string]: string | number;
}

export interface DividendsByMonth {
  rows: MonthRow[];
  /** Pořadí zemí = pořadí barevných slotů (top podle objemu, zbytek „Ostatní“). */
  countries: string[];
  totalCzk: number;
}

const OTHER = 'Ostatní';

/** Dividendy brutto po měsících, rozpad po státech (top 3 + Ostatní). */
export function dividendsByMonth(result: TaxYearResult): DividendsByMonth {
  const byCountry = new Map<string, Money>();
  for (const item of result.dividends.items) {
    byCountry.set(item.country, (byCountry.get(item.country) ?? ZERO).plus(item.grossCzk));
  }
  const top = [...byCountry.entries()]
    .sort((a, b) => b[1].comparedTo(a[1]))
    .slice(0, 3)
    .map(([country]) => country);
  const countries = byCountry.size > 3 ? [...top, OTHER] : top;

  // agregace Decimalem, na number až při finálním zápisu do řádků grafu
  const sums = new Map<string, Money>();
  let total = ZERO;
  for (const item of result.dividends.items) {
    if (!item.date.startsWith(`${result.year}-`)) continue;
    const slot = top.includes(item.country) ? item.country : OTHER;
    const key = `${item.date.slice(5, 7)}|${slot}`;
    sums.set(key, (sums.get(key) ?? ZERO).plus(item.grossCzk));
    total = total.plus(item.grossCzk);
  }

  const months: MonthRow[] = [];
  for (let m = 1; m <= 12; m += 1) {
    const mm = String(m).padStart(2, '0');
    const row: MonthRow = { month: `${result.year}-${mm}` };
    for (const country of countries) row[country] = num(sums.get(`${mm}|${country}`) ?? ZERO);
    months.push(row);
  }
  return { rows: months, countries, totalCzk: num(total) };
}

export interface YearBar {
  year: number;
  valueCzk: number;
}

/**
 * Realizovaný zisk/ztráta po letech — skutečný obchodní výsledek prodejů
 * (realizedResultCzk z enginu: tržby − plné náklady, bez ohledu na osvobození).
 */
export function realizedGainsByYear(resultsByYear: Map<number, TaxYearResult>): YearBar[] {
  return [...resultsByYear.entries()]
    .map(([year, result]) => ({
      year,
      valueCzk: num(
        result.securities.disposals.reduce(
          (sum, disposal) => sum.plus(disposal.realizedResultCzk),
          ZERO,
        ),
      ),
    }))
    .sort((a, b) => a.year - b.year);
}

/**
 * Poplatky po letech (obchodní poplatky + samostatné FEE transakce), orientační
 * přepočet jednotným kurzem roku poplatku. Měny bez kurzu se poctivě vykážou.
 */
export function feesByYear(txs: Transaction[]): { bars: YearBar[]; skippedCurrencies: string[] } {
  const byYear = new Map<number, Money>();
  const skipped = new Set<string>();

  const add = (date: string, amount: Money, currency: string) => {
    const year = Number(date.slice(0, 4));
    const rate =
      currency === 'CZK'
        ? d(1)
        : UNIFIED_RATES[year]?.[currency]
          ? d(UNIFIED_RATES[year]![currency]!)
          : null;
    if (!rate) {
      // kurz chybí pro konkrétní ROK (např. historie před 2020) — vykázat přesně
      skipped.add(`${currency} ${year}`);
      return;
    }
    byYear.set(year, (byYear.get(year) ?? ZERO).plus(amount.mul(rate)));
  };

  for (const tx of txs) {
    if (tx.type === 'FEE') add(tx.date, tx.amount, tx.currency);
    if ((tx.type === 'BUY' || tx.type === 'SELL') && tx.fee) {
      add(tx.tradeDate, tx.fee.amount, tx.fee.currency);
    }
  }
  // roky bez poplatků vyplnit nulou — kategorie osy nesmí tiše přeskakovat čas
  const years = [...byYear.keys()];
  const bars: YearBar[] = [];
  if (years.length > 0) {
    for (let year = Math.min(...years); year <= Math.max(...years); year += 1) {
      bars.push({ year, valueCzk: num(byYear.get(year) ?? ZERO) });
    }
  }
  return { bars, skippedCurrencies: [...skipped] };
}

export interface AllocationSlice {
  isin: string;
  label: string;
  name?: string;
  valueCzk: number;
  /** Podíl na oceněné hodnotě portfolia v % (0–100). */
  share: number;
}

export interface PortfolioAllocation {
  slices: AllocationSlice[];
  totalCzk: number;
}

/** Alokace portfolia pro koláč: VŠECHNY oceněné pozice, sestupně podle hodnoty. */
export function portfolioAllocation(valuation: PortfolioValuation): PortfolioAllocation | null {
  // rows jsou už seřazené podle hodnoty sestupně; bereme jen oceněné
  const priced = valuation.rows.filter((row) => row.valueCzk?.gt(0));
  if (priced.length === 0 || valuation.totalCzk.lte(0)) return null;

  // Decimal až do konce, num() jen na finálním výstupu pro recharts
  const slices: AllocationSlice[] = priced.map((row) => ({
    isin: row.isin,
    label: row.label,
    name: row.name,
    valueCzk: num(row.valueCzk!),
    share: num(row.valueCzk!.div(valuation.totalCzk).mul(100)),
  }));
  return { slices, totalCzk: num(valuation.totalCzk) };
}

export interface HorizonDotItem {
  isin: string;
  label: string;
  quantity: number;
  /** Příspěvek pozice k váze tečky (CZK, nebo kusy — dle weightBasis tečky). */
  weight: number;
}

export interface HorizonDot {
  /** Datum osvobození: 'YYYY-MM-DD' (denní tečka z horizonDots), po klientském
   *  slučování groupHorizonDots případně 'YYYY-MM' (měsíční tečka). */
  exemptFrom: string;
  /** Váha pro velikost tečky: součet hodnot v CZK (známe-li ceny všech pozic), jinak kusů. */
  weight: number;
  weightBasis: 'value' | 'quantity';
  isExempt: boolean;
  /** Rozpad tečky po pozicích, seřazený podle váhy sestupně (pro tooltip). */
  items: HorizonDotItem[];
}

/** Cena za kus v CZK (jednotný kurz roku); null = cena nebo kurz chybí. */
function pricePerShareCzk(
  isin: string,
  prices: Map<string, InstrumentPrice>,
  fxYear: number,
): Money | null {
  const price = prices.get(isin);
  if (!price) return null;
  if (price.currency === 'CZK') return price.price;
  const rate = UNIFIED_RATES[fxYear]?.[price.currency];
  return rate ? price.price.mul(d(rate)) : null;
}

/** Váhy lotů: CZK hodnota, jen když jde ocenit CELÉ portfolio — jinak kusy (nemíchat). */
function weightBasisFor(
  positions: Position[],
  prices: Map<string, InstrumentPrice>,
  fxYear: number,
): 'value' | 'quantity' {
  const allPriced =
    positions.length > 0 &&
    positions.every((p) => pricePerShareCzk(p.isin, prices, fxYear) !== null);
  return allPriced ? 'value' : 'quantity';
}

/**
 * Tečky horizontu osvobození (v4): jedna tečka = DEN, kdy dalším kusům doběhne
 * 3letý test (přesné datum osvobození) — isExempt je tak vůči „dnešku“ vždy
 * jednoznačné. Hrubší (měsíční) zobrazení skládá až klient přes
 * groupHorizonDots podle zvoleného rozsahu.
 */
export function horizonDots(
  positions: Position[],
  labels: Map<string, string>,
  prices: Map<string, InstrumentPrice>,
  fxYear: number,
): HorizonDot[] {
  const basis = weightBasisFor(positions, prices, fxYear);

  // agregace Decimalem, na number až na konci (peníze nikdy floatem)
  const days = new Map<
    string,
    {
      isExempt: boolean;
      weight: Money;
      byIsin: Map<string, { quantity: Money; weight: Money }>;
    }
  >();
  for (const position of positions) {
    const priceCzk = pricePerShareCzk(position.isin, prices, fxYear);
    for (const lot of position.lots) {
      // A2-3-04: horizont ukazuje cestu k osvobození — lot, který na osvobození
      // nárok nemá (obchodní majetek, stablecoin, derivát, období bez krypto
      // osvobození), do něj nepatří ani jako čekající tečka
      if (!lot.exemptionPossible) continue;
      // klíč = přesný den osvobození → loty téhož dne sdílí i stav isExempt
      const key = lot.exemptFrom;
      const weight = basis === 'value' && priceCzk ? lot.remaining.mul(priceCzk) : lot.remaining;
      let group = days.get(key);
      if (!group) {
        group = { isExempt: lot.isExempt, weight: ZERO, byIsin: new Map() };
        days.set(key, group);
      }
      group.weight = group.weight.plus(weight);
      const item = group.byIsin.get(position.isin);
      if (item) {
        item.quantity = item.quantity.plus(lot.remaining);
        item.weight = item.weight.plus(weight);
      } else {
        group.byIsin.set(position.isin, { quantity: lot.remaining, weight });
      }
    }
  }
  return [...days.entries()]
    .map(([exemptFrom, group]) => ({
      exemptFrom,
      weight: num(group.weight),
      weightBasis: basis,
      isExempt: group.isExempt,
      items: [...group.byIsin.entries()]
        .sort((a, b) => b[1].weight.comparedTo(a[1].weight))
        .map(([isin, item]) => ({
          isin,
          label: labels.get(isin) ?? isin,
          quantity: num(item.quantity),
          weight: num(item.weight),
        })),
    }))
    .sort((a, b) => a.exemptFrom.localeCompare(b.exemptFrom));
}

/**
 * Klientské slučování denních teček podle zvolené granularity zobrazení:
 * 'day' vrací tečky beze změny, 'month' slučuje po měsících — KROMĚ měsíce,
 * do kterého spadá „dnešek“: ten zůstává po dnech, aby tečky před čárou
 * „dnes“ byly zeleně osvobozené a za ní čekající (měsíční tečka by jinak
 * ležela za čárou a přitom nesla i už osvobozené kusy).
 *
 * Váhy jsou tu už čísla pro vykreslení (Decimal skončil v horizonDots) —
 * jde čistě o vizuální agregaci, žádný daňový výpočet.
 */
export function groupHorizonDots(
  dots: HorizonDot[],
  granularity: 'day' | 'month',
  today: string,
): HorizonDot[] {
  if (granularity === 'day') return dots;
  const currentMonth = today.slice(0, 7);

  const out: HorizonDot[] = [];
  const byMonth = new Map<string, HorizonDot>();
  for (const dot of dots) {
    const month = dot.exemptFrom.slice(0, 7);
    if (month === currentMonth) {
      out.push(dot); // měsíc dneška zůstává po dnech
      continue;
    }
    const merged = byMonth.get(month);
    if (!merged) {
      const copy: HorizonDot = {
        ...dot,
        exemptFrom: month,
        items: dot.items.map((item) => ({ ...item })),
      };
      byMonth.set(month, copy);
      out.push(copy);
      continue;
    }
    merged.weight += dot.weight;
    // mimo měsíc dneška je stav uniformní (celý měsíc před/po „dnes“) —
    // AND je jen pojistka, aby sloučená tečka nikdy neslibovala osvobození
    merged.isExempt = merged.isExempt && dot.isExempt;
    for (const item of dot.items) {
      const existing = merged.items.find((i) => i.isin === item.isin);
      if (existing) {
        existing.quantity += item.quantity;
        existing.weight += item.weight;
      } else {
        merged.items.push({ ...item });
      }
    }
  }
  for (const dot of byMonth.values()) dot.items.sort((a, b) => b.weight - a.weight);
  return out.sort((a, b) => a.exemptFrom.localeCompare(b.exemptFrom));
}

export interface OutlookPoint {
  date: string;
  /** Podíl osvobozeného portfolia 0–100 (%). */
  exemptShare: number;
}

export interface ExemptionOutlook {
  points: OutlookPoint[];
  /** 'value' = váženo hodnotou (ceny známe), 'quantity' = počtem kusů. */
  basis: 'value' | 'quantity';
}

/**
 * Kumulativní osvobozování portfolia v čase (výhled z exemptFrom lotů).
 * Váha lotu = hodnota v CZK (kde známe cenu i kurz), jinak fallback na kusy
 * pro celé portfolio — míchat měny bez přepočtu by lhalo.
 */
export function exemptionOutlook(
  positions: Position[],
  prices: Map<string, InstrumentPrice>,
  today: string,
  fxYear: number,
): ExemptionOutlook | null {
  const lots = positions.flatMap((position) => position.lots.map((lot) => ({ position, lot })));
  if (lots.length === 0) return null;

  const basis = weightBasisFor(positions, prices, fxYear);
  const weight = ({ position, lot }: (typeof lots)[number]): Money => {
    const priceCzk = basis === 'value' ? pricePerShareCzk(position.isin, prices, fxYear) : null;
    return priceCzk ? lot.remaining.mul(priceCzk) : lot.remaining;
  };

  const total = lots.reduce((sum, item) => sum.plus(weight(item)), ZERO);
  if (total.lte(0)) return null;

  let exempt = lots
    .filter(({ lot }) => lot.isExempt)
    .reduce((sum, item) => sum.plus(weight(item)), ZERO);

  // A2-3-04: lot bez nároku na osvobození nikdy „nedojde" — v křivce by posunul
  // podíl osvobozeného majetku ke 100 % a s datem v minulosti rozbil i osu
  const future = lots
    .filter(({ lot }) => lot.exemptionPossible && !lot.isExempt)
    .sort((a, b) => a.lot.exemptFrom.localeCompare(b.lot.exemptFrom));

  const share = () => Number(exempt.div(total).mul(100).toFixed(1));
  const points: OutlookPoint[] = [{ date: today, exemptShare: share() }];
  for (const item of future) {
    exempt = exempt.plus(weight(item));
    const last = points[points.length - 1]!;
    if (last.date === item.lot.exemptFrom) last.exemptShare = share();
    else points.push({ date: item.lot.exemptFrom, exemptShare: share() });
  }
  return { points, basis };
}
