import {
  addBusinessDays,
  d,
  Decimal,
  sum,
  yearOf,
  ZERO,
  type AssetClass,
  type BuyTransaction,
  type CorporateActionTransaction,
  type IsoDate,
  type Money,
  type SellTransaction,
  type Transaction,
  type TransferInTransaction,
} from '@danero/shared';
import { calendarForIsin, isExchangeHoliday } from '../config/exchangeHolidays';
import type { EngineOptions, MatchingMethod } from '../config/options';
import { czDateText, qtyText } from '../format';
import type { FxConverter } from '../fx/fx';
import { EngineError, WarningCollector } from '../warnings';

export interface Lot {
  id: string;
  isin: string;
  assetClass: AssetClass;
  currency: string;
  /** Nabyté množství (po transformacích korporátními akcemi). */
  quantity: Money;
  remaining: Money;
  costPerShare: Money;
  feeTotal: Money;
  feeCurrency: string;
  tradeDate: IsoDate;
  settlementDate: IsoDate;
  /** Datum nabytí pro časový test dle options.timeTestDateBasis (R-01a). */
  acquisitionDate: IsoDate;
  /** Datum vynaložení výdaje (vypořádání nákupu) — určuje rok kurzu výdaje (R-06a). */
  expenseDate: IsoDate;
  origin: 'BUY' | 'TRANSFER_IN' | 'SPINOFF' | 'MERGER' | 'SYNTHETIC';
  /** Vznikl operací s výkladovou nejistotou (R-04) — propsat do reportu. */
  interpretive: boolean;
}

export interface DisposalAllocation {
  lotId: string;
  quantity: Money;
  costPerShare: Money;
  lotCurrency: string;
  buyFeeShare: Money;
  buyFeeCurrency: string;
  acquisitionDate: IsoDate;
  expenseDate: IsoDate;
  origin: Lot['origin'];
  interpretive: boolean;
  /** Vyplňuje classifyTimeTest (R-01). */
  timeTestExempt: boolean;
  exemptFrom: IsoDate;
}

export interface Disposal {
  sellTxId: string;
  isin: string;
  assetClass: AssetClass;
  quantity: Money;
  pricePerShare: Money;
  currency: string;
  sellFee: Money;
  sellFeeCurrency: string;
  tradeDate: IsoDate;
  settlementDate: IsoDate;
  /** Datum prodeje pro časový test dle options (R-01b). */
  saleDate: IsoDate;
  /** Rok příjmu — aproximace cash principu (R-05a) datem vypořádání. */
  incomeYear: number;
  /** Hrubý příjem (tržba) v měně instrumentu = quantity × pricePerShare. */
  grossProceeds: Money;
  allocations: DisposalAllocation[];
}

export interface Ledger {
  lots: Lot[];
  disposals: Disposal[];
}

/** Přechod US trhů na vypořádání T+1 (SEC rule 15c6-1(a), účinnost 28. 5. 2024). */
const US_T1_SINCE = '2024-05-28';
/** Kanada přešla na T+1 o den dřív než US — 27. 5. 2024 (CIRO/Canadian Capital
 * Markets Association; v US byl 27. 5. svátek Memorial Day). Před tím T+2. */
const CA_T1_SINCE = '2024-05-27';

/** Dopočet data vypořádání, pokud jej broker neuvádí. Lhůta T+1/T+2 běží
 * v obchodních dnech burzy — přeskakují se víkendy I burzovní svátky (R-01a,
 * kalendáře v config/exchangeHolidays.ts). Burzovní lhůty platí jen pro
 * zaknihované CP — krypto se vypořádává okamžitě (T+0), jinak by se posunul
 * rok příjmu (R-05a) i hranice účinnosti osvobození 15. 2. 2025 (R-10b). */
export function inferSettlementDate(
  tradeDate: IsoDate,
  isin: string,
  assetClass: AssetClass,
  settlementStyle?: 'PREMIUM' | 'MARGIN',
): IsoDate {
  if (assetClass === 'CRYPTO') return tradeDate;
  // R-12e: CFD a futures (MARGIN) se nepřevádějí na majetkový účet, takže na ně
  // burzovní lhůta T+1/T+2 nedopadá — plnění je realizované uzavřením pozice
  // (R-12f, R-12r). Dopočtené T+2 posouvalo rok příjmu: MT4 obchod uzavřený
  // 30. 12. 2025 dostal vypořádání 2. 1. 2026, zisk 60 000 Kč spadl do ZO 2026
  // a limit 50k za 2025 hlásil „neprolomeno“, přestože prolomený byl (A2-10).
  if (settlementStyle === 'MARGIN') return tradeDate;
  const t1 =
    (isin.startsWith('US') && tradeDate >= US_T1_SINCE) ||
    (isin.startsWith('CA') && tradeDate >= CA_T1_SINCE);
  const calendar = calendarForIsin(isin);
  return addBusinessDays(tradeDate, t1 ? 1 : 2, (day) => isExchangeHoliday(calendar, day));
}

const eventDate = (tx: Transaction): IsoDate =>
  tx.type === 'BUY' || tx.type === 'SELL' ? tx.tradeDate : tx.date;

/**
 * Pořadí událostí téhož dne — deterministické, nezávislé na ID transakcí:
 * korporátní akce (brokeři reportují post-split ceny) → otevření pozice →
 * uzavření pozice. Sdílí ho i výpočet derivátů (R-12e), aby 0DTE opce nebo
 * převod a prodej týž den nevycházely podle abecedy ID.
 */
export const eventPriority = (tx: Transaction): number => {
  switch (tx.type) {
    case 'CORPORATE_ACTION':
      return 0;
    case 'BUY':
    case 'TRANSFER_IN':
      return 1;
    case 'SELL':
    case 'TRANSFER_OUT':
      return 2;
    default:
      return 3;
  }
};

/**
 * Sestaví loty a prodeje z kompletní historie. `fx` je potřeba jen pro metody
 * MAX_PROFIT/MAX_LOSS (R-05c) — nabývací ceny lotů se porovnávají v CZK kurzem
 * roku nákupu (konvence výdajů R-06a), jinak by se míchaly měny; bez něj se
 * porovnává nominál v měně lotu (dostačuje FIFO/LIFO a jednoměnovým portfoliím).
 */
export function buildLedger(
  transactions: Transaction[],
  options: EngineOptions,
  warnings: WarningCollector,
  fx?: FxConverter,
): Ledger {
  // sdílená cache CZK nabývacích cen pro MAX_PROFIT/MAX_LOSS — bez ní se
  // každý prodej přepočítával přes všechny otevřené loty znovu; klíč obsahuje
  // costPerShare, takže split/spin-off (mění cenu lotu) cache neotráví
  const costCzkCache = new Map<string, Money>();
  const lots: Lot[] = [];
  const disposals: Disposal[] = [];
  let syntheticCounter = 0;

  const events = transactions
    .map((tx, seq) => ({ tx, seq, date: eventDate(tx), priority: eventPriority(tx) }))
    .sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      if (a.priority !== b.priority) return a.priority - b.priority;
      return a.seq - b.seq;
    });

  /**
   * Index lotů podle ISIN. Bez něj byl `openLots()` lineární průchod VŠEMI loty
   * při KAŽDÉM prodeji, takže sestavení ledgeru bylo O(n²): u 50 000 transakcí
   * ~472 milionů porovnání a 28 s CPU jen za jeden rok (nález G-P1). Mapa drží
   * loty v pořadí vložení, takže výběr lotů (FIFO/LIFO/MAX_*) zůstává shodný —
   * `orderLots` si je stejně řadí sám.
   */
  const lotsByIsin = new Map<string, Lot[]>();
  const registerLot = (lot: Lot): void => {
    lots.push(lot);
    const bucket = lotsByIsin.get(lot.isin);
    if (bucket) bucket.push(lot);
    else lotsByIsin.set(lot.isin, [lot]);
  };
  /**
   * Otevřené loty jednoho ISIN. Vyčerpané loty z indexu **natrvalo vyřazuje** —
   * bez toho by kbelík rostl s počtem obchodů a průchod by zůstal kvadratický
   * i s indexem (day-trader má všechno pod jedním ISIN). Lot se z `remaining`
   * 0 nikdy nevrátí zpět: prodej i převod jen ubírají a korporátní akce nulu
   * jen přenásobí. Plný seznam lotů pro výstup drží `lots`, tenhle index je
   * jen pracovní.
   */
  const openLots = (isin: string): Lot[] => {
    const bucket = lotsByIsin.get(isin);
    if (!bucket) return [];
    let zapis = 0;
    for (let cteni = 0; cteni < bucket.length; cteni += 1) {
      const lot = bucket[cteni]!;
      if (lot.remaining.gt(0)) bucket[zapis++] = lot;
    }
    bucket.length = zapis;
    return bucket.slice();
  };
  /**
   * Korporátní akce (ISIN_CHANGE, MERGER) přepisují `lot.isin` — index se tím
   * musí přerejstříkovat, jinak by lot pod novým ISIN nikdo nenašel. Pořadí
   * v cílovém kbelíku zůstává vložením na konec, tedy stejné jako u původního
   * `filter()` přes celé pole.
   */
  const moveLotToIsin = (lot: Lot, newIsin: string): void => {
    const from = lotsByIsin.get(lot.isin);
    if (from) {
      const at = from.indexOf(lot);
      if (at >= 0) from.splice(at, 1);
    }
    lot.isin = newIsin;
    const to = lotsByIsin.get(newIsin);
    if (to) to.push(lot);
    else lotsByIsin.set(newIsin, [lot]);
  };

  const openLotFromBuy = (tx: BuyTransaction): void => {
    const settlement =
      tx.settlementDate ?? inferSettlementDate(tx.tradeDate, tx.isin, tx.assetClass);
    registerLot({
      id: `lot-${tx.id}`,
      isin: tx.isin,
      assetClass: tx.assetClass,
      currency: tx.currency,
      quantity: tx.quantity,
      remaining: tx.quantity,
      costPerShare: tx.pricePerShare,
      feeTotal: tx.fee?.amount ?? ZERO,
      feeCurrency: tx.fee?.currency ?? tx.currency,
      tradeDate: tx.tradeDate,
      settlementDate: settlement,
      acquisitionDate: options.timeTestDateBasis === 'settlement' ? settlement : tx.tradeDate,
      expenseDate: settlement,
      origin: 'BUY',
      interpretive: false,
    });
  };

  const openLotFromTransfer = (tx: TransferInTransaction): void => {
    if (!tx.acquisition) {
      warnings.add(
        'TRANSFER_WITHOUT_ACQUISITION',
        'ERROR',
        `Převod ${tx.ticker ?? tx.name ?? tx.isin} z ${czDateText(tx.date)} bez údajů o původním nabytí — nabývací cena 0 a časový test běží až od převodu. Doplň datum a cenu původního nákupu.`,
        { txId: tx.id, isin: tx.isin },
      );
    } else if (tx.acquisition.costPerShare === undefined) {
      // částečné nabytí: datum je, cena chybí — časový test běží správně,
      // ale výdaj je tiše 0 (vyšší daň); jen upozornit, výpočet neměnit
      warnings.add(
        'TRANSFER_WITHOUT_COST',
        'WARNING',
        `Převod ${tx.ticker ?? tx.name ?? tx.isin} z ${czDateText(tx.date)} má datum původního nabytí (${czDateText(tx.acquisition.date)}), ale chybí cena — počítáme nabývací cenu 0, daň může vyjít vyšší. Časový test běží od data nabytí správně; doplň cenu (a měnu) původního nákupu z výpisu brokera.`,
        { txId: tx.id, isin: tx.isin },
      );
    }
    const acqDate = tx.acquisition?.date ?? tx.date;
    const currency = tx.acquisition?.currency ?? 'CZK';
    if (tx.acquisition?.costPerShare && !tx.acquisition.currency) {
      // Cena bez měny se ocení jako CZK. U zahraničního titulu je to tichá
      // chyba v neprospěch poplatníka: cena „50“ myšlená v USD se počítá jako
      // 50 Kč, takže výdaj klesne ~20× a daň o tolik vyroste. Univerzální
      // šablona přitom `acquisition_currency` pustí prázdné, takže tahle cesta
      // je reálná — hlásit, ne mlčet (výpočet neměníme, jen upozorňujeme).
      warnings.add(
        'TRANSFER_COST_WITHOUT_CURRENCY',
        'WARNING',
        `Převod ${tx.ticker ?? tx.name ?? tx.isin} z ${czDateText(tx.date)} má vyplněnou nabývací cenu (${tx.acquisition.costPerShare.toString()}), ale ne její měnu — počítáme ji v korunách. Je-li cena v cizí měně, vyjde výdaj mnohonásobně nižší a daň vyšší; doplň měnu původního nákupu.`,
        { txId: tx.id, isin: tx.isin },
      );
    }
    registerLot({
      id: `lot-${tx.id}`,
      isin: tx.isin,
      assetClass: tx.assetClass,
      currency,
      quantity: tx.quantity,
      remaining: tx.quantity,
      costPerShare: tx.acquisition?.costPerShare ?? ZERO,
      feeTotal: ZERO,
      feeCurrency: currency,
      tradeDate: acqDate,
      settlementDate: acqDate,
      acquisitionDate: acqDate, // R-04i: převod mezi brokery test nepřerušuje
      expenseDate: acqDate,
      origin: 'TRANSFER_IN',
      interpretive: !tx.acquisition,
    });
  };

  const processSell = (tx: SellTransaction): void => {
    const settlement =
      tx.settlementDate ?? inferSettlementDate(tx.tradeDate, tx.isin, tx.assetClass);
    const saleDate = options.timeTestDateBasis === 'settlement' ? settlement : tx.tradeDate;
    const candidates = openLots(tx.isin);
    orderLots(candidates, options.matchingMethod, fx, costCzkCache);

    let toFill = tx.quantity;
    const allocations: DisposalAllocation[] = [];
    for (const lot of candidates) {
      if (toFill.lte(0)) break;
      const take = Decimal.min(lot.remaining, toFill);
      lot.remaining = lot.remaining.sub(take);
      toFill = toFill.sub(take);
      allocations.push({
        lotId: lot.id,
        quantity: take,
        costPerShare: lot.costPerShare,
        lotCurrency: lot.currency,
        buyFeeShare: lot.quantity.gt(0) ? lot.feeTotal.mul(take).div(lot.quantity) : ZERO,
        buyFeeCurrency: lot.feeCurrency,
        acquisitionDate: lot.acquisitionDate,
        expenseDate: lot.expenseDate,
        origin: lot.origin,
        interpretive: lot.interpretive,
        timeTestExempt: false,
        exemptFrom: saleDate,
      });
    }

    if (toFill.gt(0)) {
      warnings.add(
        'NEGATIVE_POSITION',
        'ERROR',
        `Prodej ${tx.ticker ?? tx.name ?? tx.isin} z ${czDateText(tx.tradeDate)}: prodáno o ${qtyText(toFill)} ks více, než je evidováno. Historie je nejspíš neúplná — chybějící kusy oceněny 0 Kč a bez nároku na časový test. Nahraj kompletní historii od prvního nákupu.`,
        { txId: tx.id, isin: tx.isin, missing: toFill.toString() },
      );
      syntheticCounter += 1;
      const synthetic: Lot = {
        id: `lot-synthetic-${syntheticCounter}`,
        isin: tx.isin,
        assetClass: tx.assetClass,
        currency: tx.currency,
        quantity: toFill,
        remaining: ZERO,
        costPerShare: ZERO,
        feeTotal: ZERO,
        feeCurrency: tx.currency,
        tradeDate: saleDate,
        settlementDate: saleDate,
        acquisitionDate: saleDate,
        expenseDate: saleDate,
        origin: 'SYNTHETIC',
        interpretive: true,
      };
      registerLot(synthetic);
      allocations.push({
        lotId: synthetic.id,
        quantity: toFill,
        costPerShare: ZERO,
        lotCurrency: tx.currency,
        buyFeeShare: ZERO,
        buyFeeCurrency: tx.currency,
        acquisitionDate: saleDate,
        expenseDate: saleDate,
        origin: 'SYNTHETIC',
        interpretive: true,
        timeTestExempt: false,
        exemptFrom: saleDate,
      });
    }

    disposals.push({
      sellTxId: tx.id,
      isin: tx.isin,
      assetClass: tx.assetClass,
      quantity: tx.quantity,
      pricePerShare: tx.pricePerShare,
      currency: tx.currency,
      sellFee: tx.fee?.amount ?? ZERO,
      sellFeeCurrency: tx.fee?.currency ?? tx.currency,
      tradeDate: tx.tradeDate,
      settlementDate: settlement,
      saleDate,
      incomeYear: yearOf(settlement),
      grossProceeds: tx.quantity.mul(tx.pricePerShare),
      allocations,
    });
  };

  const processTransferOut = (tx: Extract<Transaction, { type: 'TRANSFER_OUT' }>): void => {
    const candidates = openLots(tx.isin);
    orderLots(candidates, 'FIFO');
    let toFill = tx.quantity;
    for (const lot of candidates) {
      if (toFill.lte(0)) break;
      const take = Decimal.min(lot.remaining, toFill);
      lot.remaining = lot.remaining.sub(take);
      toFill = toFill.sub(take);
    }
    if (toFill.gt(0)) {
      warnings.add(
        'TRANSFER_OUT_EXCEEDS_POSITION',
        'ERROR',
        `Odchozí převod ${tx.isin} z ${czDateText(tx.date)} převyšuje evidovanou pozici o ${qtyText(toFill)} ks.`,
        { txId: tx.id, isin: tx.isin },
      );
    }
  };

  const requireRatio = (tx: CorporateActionTransaction): { from: Money; to: Money } => {
    if (!tx.ratio) {
      throw new EngineError(
        'CORPORATE_ACTION_INVALID',
        `Korporátní akce ${tx.id} (${tx.subtype}) vyžaduje poměr výměny (ratio).`,
      );
    }
    return tx.ratio;
  };

  const requireNewIsin = (tx: CorporateActionTransaction): string => {
    if (!tx.newIsin) {
      throw new EngineError(
        'CORPORATE_ACTION_INVALID',
        `Korporátní akce ${tx.id} (${tx.subtype}) vyžaduje nový ISIN (newIsin).`,
      );
    }
    return tx.newIsin;
  };

  const processCorporateAction = (tx: CorporateActionTransaction): void => {
    switch (tx.subtype) {
      case 'SPLIT': {
        // R-04a: výměna při zachování celkové jmenovité hodnoty test nepřerušuje
        const ratio = requireRatio(tx);
        const factor = ratio.to.div(ratio.from);
        for (const lot of openLots(tx.isin)) {
          lot.quantity = lot.quantity.mul(factor);
          lot.remaining = lot.remaining.mul(factor);
          lot.costPerShare = lot.costPerShare.div(factor);
        }
        break;
      }
      case 'ISIN_CHANGE': {
        // R-04e: změna ISIN bez výměny nástroje test nepřerušuje — lot pokračuje.
        // R-11: z dat ale nejde odlišit prostou změnu ISIN od změny třídy fondu
        // (dist→acc), u které je přenos testu nevyjasněný → výkladová vlajka
        // a varování, ať se přenesený test neschová.
        const newIsin = requireNewIsin(tx);
        const affected = openLots(tx.isin);
        for (const lot of affected) {
          moveLotToIsin(lot, newIsin);
          lot.interpretive = true;
        }
        if (affected.length > 0) {
          warnings.add(
            'ISIN_CHANGE_INTERPRETIVE',
            'WARNING',
            `Změna ISIN ${tx.isin} → ${newIsin} (${czDateText(tx.date)}): počítáme, že časový test běží dál od původního nákupu (R-04e). Jde-li ale o změnu třídy fondu (distribuční → akumulační), je zachování testu nevyjasněné — ověř podmínky výměny.`,
            { txId: tx.id, isin: tx.isin, newIsin },
          );
        }
        break;
      }
      case 'MERGER': {
        const newIsin = requireNewIsin(tx);
        const ratio = tx.ratio ?? { from: d(1), to: d(1) };
        const factor = ratio.to.div(ratio.from);
        const preserves = tx.preservesAcquisitionDate ?? true;
        if (tx.preservesAcquisitionDate === undefined) {
          warnings.add(
            'MERGER_INTERPRETIVE',
            'WARNING',
            `Fúze ${tx.isin} → ${newIsin} (${czDateText(tx.date)}): předpokládám zachování časového testu. Ověř podmínky § 23b/§ 23c a zachování celkové jmenovité hodnoty (NSS 7 Afs 229/2022).`,
            { txId: tx.id },
          );
        }
        for (const lot of openLots(tx.isin)) {
          moveLotToIsin(lot, newIsin);
          lot.quantity = lot.quantity.mul(factor);
          lot.remaining = lot.remaining.mul(factor);
          lot.costPerShare = lot.costPerShare.div(factor);
          lot.interpretive = true;
          if (!preserves) {
            lot.acquisitionDate = tx.date; // R-04c: test přerušen
            lot.origin = 'MERGER';
          }
        }
        break;
      }
      case 'SPINOFF': {
        const newIsin = requireNewIsin(tx);
        const ratio = tx.ratio ?? { from: d(1), to: d(1) };
        const parents = openLots(tx.isin);
        if (parents.length === 0) {
          warnings.add(
            'SPINOFF_NO_POSITION',
            'WARNING',
            `Spin-off ${tx.isin} z ${czDateText(tx.date)}: žádná otevřená pozice k tomuto datu.`,
            { txId: tx.id },
          );
          break;
        }
        const childQty = sum(parents.map((p) => p.remaining))
          .mul(ratio.to)
          .div(ratio.from);
        let childCostTotal = ZERO;
        const fraction =
          options.spinoffCostBasisAllocation === 'proportional' ? (tx.costFraction ?? ZERO) : ZERO;
        if (fraction.gt(0)) {
          for (const parent of parents) {
            childCostTotal = childCostTotal.plus(
              parent.costPerShare.mul(parent.remaining).mul(fraction),
            );
            parent.costPerShare = parent.costPerShare.mul(d(1).sub(fraction));
          }
        }
        const first = parents[0]!;
        registerLot({
          id: `lot-${tx.id}`,
          isin: newIsin,
          assetClass: first.assetClass,
          currency: first.currency,
          quantity: childQty,
          remaining: childQty,
          costPerShare: childQty.gt(0) ? childCostTotal.div(childQty) : ZERO,
          feeTotal: ZERO,
          feeCurrency: first.currency,
          tradeDate: tx.date,
          settlementDate: tx.date,
          acquisitionDate: tx.date, // R-04f: novým kusům běží nová lhůta
          expenseDate: tx.date,
          origin: 'SPINOFF',
          interpretive: true,
        });
        warnings.add(
          'SPINOFF_COST_BASIS',
          'INFO',
          `Spin-off ${tx.isin} z ${czDateText(tx.date)}: nabývací cena nových kusů dle volby "${options.spinoffCostBasisAllocation}" — zákon alokaci výslovně neřeší.`,
          { txId: tx.id },
        );
        break;
      }
      case 'DELISTING': {
        warnings.add(
          'DELISTING_MANUAL',
          'WARNING',
          `Delisting ${tx.isin} (${czDateText(tx.date)}) vyžaduje ruční posouzení — engine pozici nemění.`,
          { txId: tx.id },
        );
        break;
      }
    }
  };

  for (const { tx } of events) {
    switch (tx.type) {
      case 'BUY':
        openLotFromBuy(tx);
        break;
      case 'TRANSFER_IN':
        openLotFromTransfer(tx);
        break;
      case 'SELL':
        processSell(tx);
        break;
      case 'TRANSFER_OUT':
        processTransferOut(tx);
        break;
      case 'CORPORATE_ACTION':
        processCorporateAction(tx);
        break;
      default:
        // DIVIDEND / INTEREST / FEE / FX_CONVERSION / DEPOSIT / WITHDRAWAL loty neovlivňují
        break;
    }
  }

  return { lots, disposals };
}

function orderLots(
  candidates: Lot[],
  method: MatchingMethod,
  fx?: FxConverter,
  cache?: Map<string, Money>,
): void {
  const byAcquisition = (a: Lot, b: Lot): number => {
    if (a.acquisitionDate !== b.acquisitionDate) {
      return a.acquisitionDate < b.acquisitionDate ? -1 : 1;
    }
    return a.id.localeCompare(b.id);
  };
  // MAX_PROFIT/MAX_LOSS: loty téhož ISIN mohou být v různých měnách (duální
  // listing, GBX/GBP) — porovnávat nominály napříč měnami nedává smysl. S fx
  // se porovnává nabývací cena v CZK kurzem roku nákupu (expenseDate, R-06a) —
  // stejná hodnota, jaká pak vstoupí do výdajů.
  const costCzk = cache ?? new Map<string, Money>();
  const comparable = (lot: Lot): Money => {
    if (!fx) return lot.costPerShare;
    const key = `${lot.id}:${lot.costPerShare.toString()}`;
    let cost = costCzk.get(key);
    if (!cost) {
      try {
        cost = fx.toCzk(lot.costPerShare, lot.currency, lot.expenseDate);
      } catch {
        // chybějící kurz nesmí shodit stavbu ledgeru pro VŠECHNY roky (řadí se
        // tu jen kandidáti prodeje) — nouzově nominál; výdajová větev roku
        // příjmu chybu nahlásí/ošetří sama (FX_*_RATE_MISSING)
        cost = lot.costPerShare;
      }
      costCzk.set(key, cost);
    }
    return cost;
  };
  switch (method) {
    case 'FIFO':
      candidates.sort(byAcquisition);
      break;
    case 'LIFO':
      candidates.sort((a, b) => -byAcquisition(a, b));
      break;
    case 'MAX_PROFIT':
      // Nejnižší nabývací cena první → maximalizace realizovaného zisku
      candidates.sort((a, b) => comparable(a).cmp(comparable(b)) || byAcquisition(a, b));
      break;
    case 'MAX_LOSS':
      candidates.sort((a, b) => comparable(b).cmp(comparable(a)) || byAcquisition(a, b));
      break;
  }
}
