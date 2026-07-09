import { Decimal, sum, ZERO, type IsoDate, type Money, type Transaction } from '@danero/shared';
import type { EngineOptions } from '../config/options';
import { czDateText, czkText, qtyText } from '../format';
import type { FxConverter } from '../fx/fx';
import { WarningCollector } from '../warnings';

/**
 * R-12: deriváty (opce, futures, CFD) — samostatný druh § 10 bez jakéhokoli
 * osvobození (R-12c). Nejde o prodej z inventáře jako u CP: pozice může být
 * i SHORT (výpis opce). Hotovostní princip (R-12e) ve dvou stylech vypořádání:
 *
 *  - PREMIUM (opce; default): cena obchodu je skutečný cash tok. Uzavření LONG
 *    = příjem v roce prodeje s výdajem otevírací ceny (kurz roku zaplacení,
 *    R-12m); otevření SHORT (výpis) = příjem prémie v roce PŘIJETÍ (R-12j);
 *    zpětný odkup = výdaj v roce zaplacení; bezcenná expirace long výdaj
 *    v defaultu NEuplatňuje (R-12i, přepínač `derivativesExpensesPerDruh`).
 *  - MARGIN (futures, CFD): nominál pozice NENÍ příjem (R-12f) — cash tok je
 *    až rozdíl cen při uzavření, přepočtený kurzem dne uzavření; kladný rozdíl
 *    = příjem druhu, záporný = výdaj druhu.
 *
 * Zpracovávají se jen události do 31. 12. roku — otevřené pozice a varování
 * tak odpovídají stavu ke konci analyzovaného roku, ne konci historie.
 */

export interface DerivativeItem {
  txId: string;
  isin: string;
  date: IsoDate;
  year: number;
  kind: 'LONG_CLOSE' | 'SHORT_OPEN' | 'SHORT_CLOSE' | 'MARGIN_CLOSE';
  /** Kladné přijaté plnění v CZK (0 u expirace, SHORT_CLOSE a ztrátového MARGIN_CLOSE). */
  incomeCzk: Money;
  /** Výdaj druhu v CZK (otevírací cena long / zpětný odkup / záporné vypořádání + poplatky). */
  expenseCzk: Money;
  /** R-12i: výdaj v defaultu neuznaný (bezcenná expirace/uplatnění long opce). */
  deniedExpenseCzk: Money;
}

export interface OpenDerivativePosition {
  isin: string;
  /** Kladná = long, záporná = short (výpis). */
  quantity: Money;
  currency: string;
  openedAt: IsoDate;
}

export interface DerivativesResult {
  /** Úhrn hrubých kladných plnění druhu v roce (R-12e/q) — vstup limitu 50k. */
  taxableIncomeCzk: Money;
  /** Výdaje druhu po zastropování do výše příjmů (§ 10/4, R-12b). */
  expensesCzk: Money;
  /** Skutečný rozdíl (informativně, může být záporný — ztráta druhu zaniká). */
  rawGainLossCzk: Money;
  /** Dílčí základ § 10 druhu: max(0, příjmy − výdaje) — R-12b/l. */
  base10Czk: Money;
  /** R-12i: úhrn výdajů neuznaných v defaultu (expirace) — pro „co kdyby". */
  deniedExpensesCzk: Money;
  items: DerivativeItem[];
  /** Otevřené pozice k 31. 12. roku (R-12g/j: sporný okamžik příjmu). */
  openPositions: OpenDerivativePosition[];
}

interface OpenLot {
  quantity: Money;
  /** Cena za jednotku v původní měně (u MARGIN referenční cena otevření). */
  pricePerShare: Money;
  currency: string;
  feeTotal: Money;
  feeCurrency: string;
  date: IsoDate;
  originalQuantity: Money;
}

type DerivativeTx = Extract<
  Transaction,
  { type: 'BUY' | 'SELL' | 'TRANSFER_IN' | 'TRANSFER_OUT' }
>;
type Trade = Extract<Transaction, { type: 'BUY' | 'SELL' }>;

const yearOf = (date: IsoDate): number => Number(date.slice(0, 4));
const eventDate = (tx: DerivativeTx): IsoDate => (tx.type === 'BUY' || tx.type === 'SELL' ? tx.tradeDate : tx.date);

/** Uzavře množství proti FIFO frontě; vrací spárované loty (pro výdaj i MARGIN rozdíl). */
function closeAgainst(
  queue: OpenLot[],
  quantity: Money,
): { matched: Money; parts: Array<{ lot: OpenLot; take: Money }> } {
  let toFill = quantity;
  const parts: Array<{ lot: OpenLot; take: Money }> = [];
  for (const lot of queue) {
    if (toFill.lte(0)) break;
    const take = Decimal.min(lot.quantity, toFill);
    if (take.lte(0)) continue;
    lot.quantity = lot.quantity.sub(take);
    toFill = toFill.sub(take);
    parts.push({ lot, take });
  }
  return { matched: quantity.sub(toFill), parts };
}

/**
 * Spočítá druh „deriváty" za daný rok z derivátových transakcí (BUY/SELL/
 * převody; expirace i assignment = uzavření s cenou 0 — R-12i/k).
 */
export function computeDerivatives(
  transactions: DerivativeTx[],
  year: number,
  fx: FxConverter,
  options: EngineOptions,
  warnings: WarningCollector,
): DerivativesResult {
  const yearEnd = `${year}-12-31`;
  const sorted = transactions
    .filter((tx) => eventDate(tx) <= yearEnd)
    .sort((a, b) => {
      const da = eventDate(a);
      const db = eventDate(b);
      return da === db ? a.id.localeCompare(b.id) : da < db ? -1 : 1;
    });

  // R-12f/g: styl vypořádání je vlastnost instrumentu (stačí jediný obchod MARGIN)
  const marginIsins = new Set(
    transactions.flatMap((tx) =>
      (tx.type === 'BUY' || tx.type === 'SELL') && tx.settlementStyle === 'MARGIN'
        ? [tx.isin]
        : [],
    ),
  );

  const longs = new Map<string, OpenLot[]>(); // FIFO fronty per instrument
  const shorts = new Map<string, OpenLot[]>();
  const items: DerivativeItem[] = [];

  const feeCzk = (tx: Trade): Money =>
    tx.fee ? fx.toCzk(tx.fee.amount, tx.fee.currency, tx.tradeDate) : ZERO;

  const openLot = (
    map: Map<string, OpenLot[]>,
    isin: string,
    lot: Omit<OpenLot, 'originalQuantity'>,
  ) => {
    if (lot.quantity.lte(0)) return;
    const queue = map.get(isin) ?? [];
    queue.push({ ...lot, originalQuantity: lot.quantity });
    map.set(isin, queue);
  };

  const pushItem = (item: DerivativeItem) => {
    if (item.year === year) items.push(item);
  };

  for (const tx of sorted) {
    if (tx.type === 'TRANSFER_IN') {
      // R-04i analogicky: převod nepřerušuje nic (deriváty test nemají) — jen
      // přenáší otevírací cenu; bez ní počítáme 0 a upozorníme
      if (!tx.acquisition) {
        warnings.add(
          'TRANSFER_WITHOUT_ACQUISITION',
          'ERROR',
          `Převod ${tx.ticker ?? tx.name ?? tx.isin} z ${czDateText(tx.date)} bez údajů o původním otevření — otevírací cena 0. Doplň acquisition_date/price/currency z výpisu původního brokera.`,
          { txId: tx.id, isin: tx.isin },
        );
      }
      openLot(longs, tx.isin, {
        quantity: tx.quantity,
        pricePerShare: tx.acquisition?.costPerShare ?? ZERO,
        currency: tx.acquisition?.currency ?? 'CZK',
        feeTotal: ZERO,
        feeCurrency: 'CZK',
        date: tx.acquisition?.date ?? tx.date,
      });
      continue;
    }
    if (tx.type === 'TRANSFER_OUT') {
      const { matched } = closeAgainst(longs.get(tx.isin) ?? [], tx.quantity);
      if (matched.lt(tx.quantity)) {
        warnings.add(
          'TRANSFER_OUT_EXCEEDS_POSITION',
          'ERROR',
          `Odchozí převod ${tx.isin} z ${czDateText(tx.date)} převyšuje evidovanou derivátovou pozici o ${qtyText(tx.quantity.sub(matched))} kontraktů.`,
          { txId: tx.id, isin: tx.isin },
        );
      }
      continue;
    }

    const txYear = yearOf(tx.tradeDate);
    const fee = feeCzk(tx);
    const feeShare = (part: Money): Money =>
      tx.quantity.gt(0) ? fee.mul(part).div(tx.quantity) : ZERO;
    const isMargin = marginIsins.has(tx.isin);

    if (tx.type === 'SELL') {
      // nejdřív uzavírá long pozice, zbytek otevírá short
      const { matched, parts } = closeAgainst(longs.get(tx.isin) ?? [], tx.quantity);
      if (matched.gt(0)) {
        if (isMargin) {
          // R-12f: cash tok = rozdíl cen při uzavření, kurz dne uzavření
          const openNominal = sum(parts.map(({ lot, take }) => lot.pricePerShare.mul(take)));
          const settlementCzk = fx.toCzk(
            tx.pricePerShare.mul(matched).sub(openNominal),
            tx.currency,
            tx.tradeDate,
          );
          pushItem({
            txId: tx.id,
            isin: tx.isin,
            date: tx.tradeDate,
            year: txYear,
            kind: 'MARGIN_CLOSE',
            incomeCzk: Decimal.max(ZERO, settlementCzk),
            expenseCzk: Decimal.max(ZERO, settlementCzk.neg()).plus(feeShare(matched)),
            deniedExpenseCzk: ZERO,
          });
        } else {
          const incomeCzk = fx.toCzk(tx.pricePerShare.mul(matched), tx.currency, tx.tradeDate);
          // R-12m: výdaj = otevírací cena kurzem data otevření + poměrné poplatky
          const costCzk = parts.reduce(
            (acc, { lot, take }) =>
              acc
                .plus(fx.toCzk(lot.pricePerShare.mul(take), lot.currency, lot.date))
                .plus(
                  lot.originalQuantity.gt(0)
                    ? fx.toCzk(lot.feeTotal.mul(take).div(lot.originalQuantity), lot.feeCurrency, lot.date)
                    : ZERO,
                ),
            ZERO,
          );
          // R-12i: uzavření bez příjmu (expirace/uplatnění za 0) — výdaj dle přepínače
          const isWorthless = incomeCzk.lte(0);
          const expense = costCzk.plus(feeShare(matched));
          pushItem({
            txId: tx.id,
            isin: tx.isin,
            date: tx.tradeDate,
            year: txYear,
            kind: 'LONG_CLOSE',
            incomeCzk,
            expenseCzk: isWorthless && !options.derivativesExpensesPerDruh ? ZERO : expense,
            deniedExpenseCzk:
              isWorthless && !options.derivativesExpensesPerDruh ? expense : ZERO,
          });
        }
      }
      const remainder = tx.quantity.sub(matched);
      if (remainder.gt(0)) {
        if (!isMargin) {
          // R-12j: přijatá prémie výpisu je příjem okamžikem přijetí
          pushItem({
            txId: tx.id,
            isin: tx.isin,
            date: tx.tradeDate,
            year: txYear,
            kind: 'SHORT_OPEN',
            incomeCzk: fx.toCzk(tx.pricePerShare.mul(remainder), tx.currency, tx.tradeDate),
            expenseCzk: feeShare(remainder),
            deniedExpenseCzk: ZERO,
          });
        }
        // MARGIN short: otevření bez cash toku — daní se až rozdíl při uzavření
        openLot(shorts, tx.isin, {
          quantity: remainder,
          pricePerShare: tx.pricePerShare,
          currency: tx.currency,
          feeTotal: isMargin && tx.fee ? tx.fee.amount.mul(remainder).div(tx.quantity) : ZERO,
          feeCurrency: tx.fee?.currency ?? tx.currency,
          date: tx.tradeDate,
        });
      }
    } else {
      // BUY: nejdřív zpětný odkup short pozic, zbytek otevírá long
      const { matched, parts } = closeAgainst(shorts.get(tx.isin) ?? [], tx.quantity);
      if (matched.gt(0)) {
        if (isMargin) {
          // short future/CFD: rozdíl = otevírací cena − uzavírací cena
          const openNominal = sum(parts.map(({ lot, take }) => lot.pricePerShare.mul(take)));
          const settlementCzk = fx.toCzk(
            openNominal.sub(tx.pricePerShare.mul(matched)),
            tx.currency,
            tx.tradeDate,
          );
          pushItem({
            txId: tx.id,
            isin: tx.isin,
            date: tx.tradeDate,
            year: txYear,
            kind: 'MARGIN_CLOSE',
            incomeCzk: Decimal.max(ZERO, settlementCzk),
            expenseCzk: Decimal.max(ZERO, settlementCzk.neg()).plus(feeShare(matched)),
            deniedExpenseCzk: ZERO,
          });
        } else {
          // R-12j: zpětný odkup výpisu = výdaj druhu v roce zaplacení
          pushItem({
            txId: tx.id,
            isin: tx.isin,
            date: tx.tradeDate,
            year: txYear,
            kind: 'SHORT_CLOSE',
            incomeCzk: ZERO,
            expenseCzk: fx
              .toCzk(tx.pricePerShare.mul(matched), tx.currency, tx.tradeDate)
              .plus(feeShare(matched)),
            deniedExpenseCzk: ZERO,
          });
        }
      }
      const remainder = tx.quantity.sub(matched);
      openLot(longs, tx.isin, {
        quantity: remainder,
        pricePerShare: tx.pricePerShare,
        currency: tx.currency,
        feeTotal: tx.fee && tx.quantity.gt(0) ? tx.fee.amount.mul(remainder).div(tx.quantity) : ZERO,
        feeCurrency: tx.fee?.currency ?? tx.currency,
        date: tx.tradeDate,
      });
    }
  }

  const income = sum(items.map((item) => item.incomeCzk));
  const expensesUncapped = sum(items.map((item) => item.expenseCzk));
  const denied = sum(items.map((item) => item.deniedExpenseCzk));
  const raw = income.sub(expensesUncapped);
  // § 10/4 (R-12b): výdaje druhu max. do výše příjmů druhu, ztráta zaniká
  const expenses = Decimal.min(expensesUncapped, income);
  const base10 = Decimal.max(ZERO, raw);

  const openPositions: OpenDerivativePosition[] = [];
  const collectOpen = (map: Map<string, OpenLot[]>, sign: 1 | -1) => {
    for (const [isin, queue] of map) {
      const remaining = sum(queue.map((lot) => lot.quantity));
      if (remaining.gt(0)) {
        openPositions.push({
          isin,
          quantity: sign === 1 ? remaining : remaining.neg(),
          currency: queue[0]!.currency,
          openedAt: queue.find((lot) => lot.quantity.gt(0))!.date,
        });
      }
    }
  };
  collectOpen(longs, 1);
  collectOpen(shorts, -1);

  if (denied.gt(0)) {
    warnings.add(
      'DERIVATIVE_EXPIRED_PREMIUM',
      'INFO',
      `Prémie opcí uzavřených bez příjmu (expirace či uplatnění) za ${czkText(denied)} počítáme podle restriktivního výkladu jako neuznatelný výdaj. Výklad „výdaje per druh“ (§ 10/4, D-59) by je uplatnil proti ostatním derivátovým příjmům roku — přepínač v nastavení; rozdíl základu daně až ${czkText(denied)}. Pozor: u UPLATNĚNÉ opce patří prémie do nabývací ceny podkladu — neuplatňuj ji pak dvakrát.`,
      { deniedCzk: denied.toFixed(2) },
    );
  }
  if (openPositions.length > 0) {
    // lidský tvar podle počtu (1 / 2–4 / 5+) — deterministicky, bez Intl
    const n = openPositions.length;
    const subject =
      n === 1
        ? `1 derivátová pozice je k 31. 12. ${year} stále otevřená`
        : n <= 4
          ? `${n} derivátové pozice jsou k 31. 12. ${year} stále otevřené`
          : `${n} derivátových pozic je k 31. 12. ${year} stále otevřených`;
    warnings.add(
      'DERIVATIVE_OPEN_OVER_YEAR_END',
      'INFO',
      `${subject} — u futures s denním vypořádáním a vypsaných opcí je okamžik zdanitelného příjmu přes přelom roku sporný. Danero počítá realizaci při uzavření pozice; prémie výpisů daní rokem přijetí.`,
      { count: openPositions.length },
    );
  }

  return {
    taxableIncomeCzk: income,
    expensesCzk: expenses,
    rawGainLossCzk: raw,
    base10Czk: base10,
    deniedExpensesCzk: denied,
    items,
    openPositions,
  };
}
