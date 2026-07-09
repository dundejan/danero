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
import type { EngineOptions, MatchingMethod } from '../config/options';
import { czDateText, qtyText } from '../format';
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

/** Přechod US trhů na vypořádání T+1 (SEC, 28. 5. 2024). */
const US_T1_SINCE = '2024-05-28';

/** Dopočet data vypořádání, pokud jej broker neuvádí (aproximace bez svátků). */
export function inferSettlementDate(tradeDate: IsoDate, isin: string): IsoDate {
  const lag = isin.startsWith('US') && tradeDate >= US_T1_SINCE ? 1 : 2;
  return addBusinessDays(tradeDate, lag);
}

const eventDate = (tx: Transaction): IsoDate =>
  tx.type === 'BUY' || tx.type === 'SELL' ? tx.tradeDate : tx.date;

/** Korporátní akce se aplikují před obchody téhož dne (brokeři reportují post-split ceny). */
const eventPriority = (tx: Transaction): number => {
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

export function buildLedger(
  transactions: Transaction[],
  options: EngineOptions,
  warnings: WarningCollector,
): Ledger {
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

  const openLots = (isin: string): Lot[] => lots.filter((l) => l.isin === isin && l.remaining.gt(0));

  const openLotFromBuy = (tx: BuyTransaction): void => {
    const settlement = tx.settlementDate ?? inferSettlementDate(tx.tradeDate, tx.isin);
    lots.push({
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
    }
    const acqDate = tx.acquisition?.date ?? tx.date;
    const currency = tx.acquisition?.currency ?? 'CZK';
    lots.push({
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
    const settlement = tx.settlementDate ?? inferSettlementDate(tx.tradeDate, tx.isin);
    const saleDate = options.timeTestDateBasis === 'settlement' ? settlement : tx.tradeDate;
    const candidates = openLots(tx.isin);
    orderLots(candidates, options.matchingMethod);

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
      lots.push(synthetic);
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
        // R-04e: změna ISIN bez výměny nástroje test nepřerušuje
        const newIsin = requireNewIsin(tx);
        for (const lot of openLots(tx.isin)) lot.isin = newIsin;
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
            `Fúze ${tx.isin} → ${newIsin} (${czDateText(tx.date)}): předpokládám zachování časového testu (R-04b). Ověř podmínky § 23b/§ 23c a zachování celkové jmenovité hodnoty (NSS 7 Afs 229/2022 — R-04c).`,
            { txId: tx.id },
          );
        }
        for (const lot of openLots(tx.isin)) {
          lot.isin = newIsin;
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
        lots.push({
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
          `Spin-off ${tx.isin} z ${czDateText(tx.date)}: nabývací cena nových kusů dle volby "${options.spinoffCostBasisAllocation}" (R-04f — zákon alokaci výslovně neřeší).`,
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

function orderLots(candidates: Lot[], method: MatchingMethod): void {
  const byAcquisition = (a: Lot, b: Lot): number => {
    if (a.acquisitionDate !== b.acquisitionDate) {
      return a.acquisitionDate < b.acquisitionDate ? -1 : 1;
    }
    return a.id.localeCompare(b.id);
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
      candidates.sort((a, b) => a.costPerShare.cmp(b.costPerShare) || byAcquisition(a, b));
      break;
    case 'MAX_LOSS':
      candidates.sort((a, b) => b.costPerShare.cmp(a.costPerShare) || byAcquisition(a, b));
      break;
  }
}
