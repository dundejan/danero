import { d, ZERO, type Money, type Transaction } from '@danero/shared';
import type { Position, TaxYearResult } from '@danero/engine';
import type { PortfolioValuation } from '@/lib/portfolio-value';
import { plural } from '@/lib/format';
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
  const contributions = [
    ...result.securities.disposals.map((disposal) => ({
      date: disposal.saleDate,
      amountCzk: disposal.limit100kContributionCzk,
    })),
    // R-13e/K6b-01: shorty mají vlastní tabulku a v `disposals` nejsou — bez
    // nich končila křivka u portfolia long 60k + short 60k na 60 000, zatímco
    // měřák nad ní hlásil 120 000.
    ...shortOpenContributions(result),
  ];
  return {
    points: toRunningSeries(result.year, contributions),
    limitCzk: num(result.limits.limit100k.limitCzk),
    usedCzk: num(result.limits.limit100k.usedCzk),
  };
}

/**
 * Body křivky za prodeje NAKRÁTKO. `incomeCzk` nese jen událost, která plnění
 * přinesla (otevření shortu, případně uzavření při opačném výkladu R-13b),
 * takže se z položek dá poskládat průběh stejně jako z prodejů.
 */
function shortOpenContributions(
  result: TaxYearResult,
): Array<{ date: string; amountCzk: Money }> {
  return result.shortSales.items
    .filter((item) => item.incomeCzk.gt(0))
    .map((item) => ({ date: item.date, amountCzk: item.incomeCzk }));
}

/** Čerpání limitu 50k (paušální daň) — prodeje mimo osvobození + dividendy + úroky. */
export function flatTax50kSeries(result: TaxYearResult): LimitSeries | null {
  if (!result.limits.flatTax50k.applicable) return null;
  const contributions: Array<{ date: string; amountCzk: Money }> = [
    ...[...result.securities.disposals, ...result.crypto.disposals].map((disposal) => ({
      date: disposal.saleDate,
      amountCzk: disposal.taxableProceedsCzk,
    })),
    // R-13k: shorty čerpají limit svým zdanitelným příjmem — a jen tehdy, když
    // druh není osvobozený stovkou (rozhoduje se v enginu, kde je to známé)
    ...(result.securities.taxableShortIncomeCzk.gt(0) ? shortOpenContributions(result) : []),
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

/**
 * Čím se váží velikost tečky horizontu:
 * - `value` — dnešní hodnotou v CZK (aspoň jedna pozice má cenu od brokera),
 * - `cost` — nabývací cenou v CZK (cenu nemá žádná pozice; kusy různých titulů
 *   se sčítat nedají),
 * - `quantity` — počtem kusů, jen když je v horizontu jediný titul.
 */
export type HorizonWeightBasis = 'value' | 'cost' | 'quantity';

export interface HorizonDotItem {
  isin: string;
  label: string;
  quantity: number;
  /** Příspěvek pozice k váze tečky (CZK, nebo kusy — dle weightBasis tečky). */
  weight: number;
  /**
   * Pozice k váze nepřispívá, protože chybí to, čím se váží: cena od brokera
   * (`value`), případně nabývací cena nebo kurz její měny (`cost`). V rozpadu
   * se ukáže počtem kusů, ne jako „0 Kč“.
   */
  unpriced?: true;
}

export interface HorizonDot {
  /** Datum osvobození: 'YYYY-MM-DD' (denní tečka z horizonDots), po klientském
   *  slučování groupHorizonDots případně 'YYYY-MM' (měsíční tečka). */
  exemptFrom: string;
  /**
   * Váha pro velikost tečky: součet v CZK (hodnota, bez cen nabývací cena);
   * kusy jen u portfolia o jediném titulu. Je to číslo pro vykreslení, ne
   * údaj k zobrazení — nabývací cena tu není daňový výdaj (viz `rateToCzk`).
   */
  weight: number;
  weightBasis: HorizonWeightBasis;
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
  const rate = rateToCzk(price.currency, fxYear);
  return rate ? price.price.mul(rate) : null;
}

/**
 * Jednotný kurz měny pro ORIENTAČNÍ přepočet na koruny — tentýž, kterým se
 * oceňuje portfolio (kurz běžného roku). Pence (GBX, tak nakupuje T212 na
 * londýnské burze) jdou přes libru. Není to kurz pro daně: výdaj se v přiznání
 * přepočítává kurzem roku nákupu (R-06) a to dělá engine, ne grafy.
 */
function rateToCzk(currency: string, fxYear: number): Money | null {
  if (currency === 'CZK') return d(1);
  if (currency === 'GBX') {
    const pound = UNIFIED_RATES[fxYear]?.GBP;
    return pound ? d(pound).div(100) : null;
  }
  const rate = UNIFIED_RATES[fxYear]?.[currency];
  return rate ? d(rate) : null;
}

/**
 * Čím se váží tečky horizontu (viz `HorizonWeightBasis`).
 *
 * Kusy různých instrumentů se sčítat ani porovnávat nedají — a přesto se jimi
 * portfolio vážilo dvakrát. Nejdřív stačila JEDINÁ pozice bez ceny a celé
 * portfolio se přepnulo na kusy: sto milionů kusů levné mince přebilo všechno
 * ostatní („Bez daně už dnes 0 %“ u portfolia za miliardy, R2-10). Pozice bez
 * ceny proto z vážení hodnotou vypadne a volající řekne, kolik jich je.
 * Do 11. 10. 2026 pak totéž zůstalo u portfolia bez jediné ceny, tedy u každého,
 * kdo jen nahrává výpisy: tečka s mincí byla největší a akcie za desetinásobek
 * vedle ní sotva vidět. Bez cen se proto váží nabývací cenou — tu výpisy
 * nesou (až na kusy přibylé za nulu); na kusy dojde jen u jediného titulu.
 */
function weightBasisFor(
  positions: Position[],
  prices: Map<string, InstrumentPrice>,
  fxYear: number,
): HorizonWeightBasis {
  if (positions.some((p) => pricePerShareCzk(p.isin, prices, fxYear) !== null)) return 'value';
  const shown = positions.filter((p) => p.lots.some((lot) => lot.exemptionPossible));
  return shown.length > 1 ? 'cost' : 'quantity';
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
      byIsin: Map<string, { quantity: Money; weight: Money; unpriced: boolean }>;
    }
  >();
  for (const position of positions) {
    const priceCzk = basis === 'value' ? pricePerShareCzk(position.isin, prices, fxYear) : null;
    const costRate = basis === 'cost' ? rateToCzk(position.currency, fxYear) : null;
    for (const lot of position.lots) {
      // A2-3-04: horizont ukazuje cestu k osvobození — lot, který na osvobození
      // nárok nemá (obchodní majetek, stablecoin, derivát, období bez krypto
      // osvobození), do něj nepatří ani jako čekající tečka
      if (!lot.exemptionPossible) continue;
      // klíč = přesný den osvobození → loty téhož dne sdílí i stav isExempt
      const key = lot.exemptFrom;
      // koruny za kus: dnešní cena, bez cen nabývací cena; `null` = chybí
      // (pozice bez ceny, nákup za nulu po oddělení společnosti, měna bez kurzu)
      const perShareCzk =
        basis === 'value'
          ? priceCzk
          : costRate && lot.costPerShare.gt(0)
            ? lot.costPerShare.mul(costRate)
            : null;
      const unpriced = basis !== 'quantity' && perShareCzk === null;
      const weight =
        basis === 'quantity' ? lot.remaining : perShareCzk ? lot.remaining.mul(perShareCzk) : ZERO;
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
        item.unpriced = item.unpriced && unpriced;
      } else {
        group.byIsin.set(position.isin, { quantity: lot.remaining, weight, unpriced });
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
          ...(item.unpriced ? { unpriced: true as const } : {}),
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
        if (!item.unpriced) delete existing.unpriced;
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
  /**
   * Čím se podíl váží — stejná tři měřítka jako u teček horizontu
   * (`HorizonWeightBasis`): hodnotou oceněných pozic, bez cen nabývací cenou,
   * počtem kusů jen u jediného titulu.
   */
  basis: HorizonWeightBasis;
  /**
   * Kolik pozic se do podílu nepočítá, protože jim chybí to, čím se váží:
   * cena od brokera (`value`), nebo nabývací cena či kurz její měny (`cost`).
   * Podíl je pak jen z části portfolia a stránka to musí říct
   * (`outlookBasisNote`).
   */
  unpricedCount: number;
}

/**
 * Kumulativní osvobozování portfolia v čase (výhled z exemptFrom lotů).
 *
 * Váha lotu je jeho hodnota v CZK. Pozice bez ceny (nebo bez kurzu měny) se do
 * podílu nepočítá a vrací se jejich počet — podíl je pak z oceněné části.
 *
 * Bez jediné ceny se váží nabývací cenou v CZK, stejně jako tečky horizontu
 * (`weightBasisFor`). Do 11. 10. 2026 se v tom stavu křivka nekreslila vůbec,
 * ačkoli tečky nad ní se nabývací cenou vážily: kdo jen nahrává výpisy, viděl
 * na přehledu tečky bez křivky a na portfoliu sekci „Horizont osvobození“
 * neviděl nikdy. Nabývací cena tu není daňový výdaj — je to váha pro podíl,
 * přepočtená orientačním kurzem běžného roku (`rateToCzk`).
 *
 * Na počet kusů se přechází jen u portfolia o JEDINÉM instrumentu: kusy akcie
 * a kusy krypta se sčítat nedají (R2-10).
 */
export function exemptionOutlook(
  positions: Position[],
  prices: Map<string, InstrumentPrice>,
  today: string,
  fxYear: number,
): ExemptionOutlook | null {
  const held = positions.filter((position) => position.lots.length > 0);
  if (held.length === 0) return null;

  const priced = held.filter((p) => pricePerShareCzk(p.isin, prices, fxYear) !== null);
  const basis: HorizonWeightBasis =
    priced.length > 0 ? 'value' : held.length > 1 ? 'cost' : 'quantity';

  /** Váha lotu; `null` = lot nemá, čím by se vážil. */
  const weightOf = (position: Position, lot: Position['lots'][number]): Money | null => {
    if (basis === 'quantity') return lot.remaining;
    if (basis === 'value') {
      const priceCzk = pricePerShareCzk(position.isin, prices, fxYear);
      return priceCzk ? lot.remaining.mul(priceCzk) : null;
    }
    // nákup za nulu (kusy z oddělení společnosti) ani měna bez kurzu váhu nemají
    const rate = rateToCzk(position.currency, fxYear);
    return rate && lot.costPerShare.gt(0) ? lot.remaining.mul(lot.costPerShare).mul(rate) : null;
  };

  const lots = held.flatMap((position) =>
    position.lots.flatMap((lot) => {
      const weight = weightOf(position, lot);
      return weight ? [{ position, lot, weight }] : [];
    }),
  );
  const counted = new Set(lots.map(({ position }) => position.isin));

  const total = lots.reduce((sum, item) => sum.plus(item.weight), ZERO);
  // nulová (nebo záporná) váha: podíl by dělil nulou
  if (total.lte(0)) return null;

  let exempt = lots
    .filter(({ lot }) => lot.isExempt)
    .reduce((sum, item) => sum.plus(item.weight), ZERO);

  // A2-3-04: lot bez nároku na osvobození nikdy „nedojde" — v křivce by posunul
  // podíl osvobozeného majetku ke 100 % a s datem v minulosti rozbil i osu
  const future = lots
    .filter(({ lot }) => lot.exemptionPossible && !lot.isExempt)
    .sort((a, b) => a.lot.exemptFrom.localeCompare(b.lot.exemptFrom));

  const share = () => Number(exempt.div(total).mul(100).toFixed(1));
  const points: OutlookPoint[] = [{ date: today, exemptShare: share() }];
  for (const item of future) {
    exempt = exempt.plus(item.weight);
    const last = points[points.length - 1]!;
    if (last.date === item.lot.exemptFrom) last.exemptShare = share();
    else points.push({ date: item.lot.exemptFrom, exemptShare: share() });
  }
  return { points, basis, unpricedCount: held.length - counted.size };
}

/** Čím se podíl váží, slovy do věty: „podle hodnoty“, „podle nabývací ceny“. */
export const OUTLOOK_BASIS_LABEL: Record<HorizonWeightBasis, string> = {
  value: 'hodnoty',
  cost: 'nabývací ceny',
  quantity: 'počtu kusů',
};

/**
 * Výhrada ke křivce do vysvětlivky (jedna věta, nebo nic): z čeho se podíl
 * počítá, když to není celé portfolio v dnešních cenách. Jedno znění pro
 * přehled i portfolio — obě stránky kreslí tutéž křivku.
 */
export function outlookBasisNote(outlook: ExemptionOutlook): string | null {
  const missing = outlook.unpricedCount;
  const absent = `${missing} ${plural(missing, 'pozice', 'pozice', 'pozic')}`;
  const verb = plural(missing, 'není', 'nejsou', 'není');
  if (outlook.basis === 'value') {
    return missing > 0
      ? `Počítá se jen z oceněných pozic; ${absent} bez ceny v křivce ${verb}.`
      : null;
  }
  if (outlook.basis === 'cost') {
    return `Počítá se z nabývacích cen — dnešní ceny známe jen od připojeného brokera${
      missing > 0 ? `; ${absent} bez nabývací ceny v křivce ${verb}` : ''
    }.`;
  }
  return null;
}
