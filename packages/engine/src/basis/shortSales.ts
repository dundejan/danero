import { sum, ZERO, type IsoDate, type Money, type Transaction } from '@danero/shared';
import { czDateText } from '../format';
import type { FxConverter } from '../fx/fx';
import { inferSettlementDate } from '../ledger/ledger';
import { WarningCollector } from '../warnings';

/**
 * R-13: prodej cenných papírů NAKRÁTKO (short na spotu) — Interactive Brokers,
 * Lynx, Fio na BCPP, Degiro Active. CFD a vypsané opce sem NEPATŘÍ, ty jsou
 * deriváty podle R-12.
 *
 * Short je podle R-13a týž druh příjmu jako běžný prodej akcií (kód D), takže
 * se s ním počítá dohromady: sdílí pool 100k (R-13e), kompenzuje se s longy
 * uvnitř druhu a jeho ztráta zaniká stejně jako u ostatních prodejů (§ 10/4).
 * Do inventáře lotů ale nepatří — prodej nakrátko žádný lot nespotřebovává,
 * pořizovací cena vzniká až zpětným nákupem.
 *
 * Rozpoznává se VÝHRADNĚ podle `positionEffect` z parseru (SELL+OPEN,
 * BUY+CLOSE). Odvozovat short ze sledu obchodů nejde: „prodej bez pozice“ je
 * v datech nerozeznatelný od neúplné historie (`NEGATIVE_POSITION`) a splést
 * si to lze oběma směry.
 *
 * Hotovostní princip (R-13b/c) má JEDINÝ režim: příjem = tržba z prodeje
 * v roce jeho vypořádání, zpětný nákup je výdaj v roce SVÉHO vypořádání.
 * Short přes přelom roku tak zdaní hrubou tržbu bez výdaje a lednový nákup
 * nemusí mít proti čemu jít (§ 10/4, R-13j) — na to se varuje.
 *
 * Mírnější výklad („příjem až uzavřením pozice“) se do 23. 8. 2026 dal zapnout
 * přepínačem `shortSaleIncomeOnSale`. Byl zrušen: R-13b sám říká, že se
 * objevuje jen v diskusích, které short zaměňují s CFD, „jako oporu ho brát
 * nelze“. Popsaný v docs/02 zůstává, nabízený není.
 */

export interface ShortSaleItem {
  isin: string;
  /** Datum vypořádání události, která plnění vyvolala. */
  date: IsoDate;
  year: number;
  kind: 'SHORT_OPEN' | 'SHORT_COVER';
  quantity: Money;
  /** Část výdaje připadající na tržbu zdaněnou v dřívějším roce (R-13c). */
  priorYearExpenseCzk: Money;
  /** Kladné přijaté plnění v CZK (u pokrytí vždy 0 — příjem plyne prodejem, R-13b). */
  incomeCzk: Money;
  /** Výdaj druhu v CZK (zpětný nákup + poplatky). */
  expenseCzk: Money;
}

export interface OpenShortPosition {
  isin: string;
  quantity: Money;
  currency: string;
  openedAt: IsoDate;
}

export interface ShortSalesResult {
  items: ShortSaleItem[];
  /** Hrubé tržby z prodejů nakrátko vypořádaných v roce — vstup poolu 100k (R-13e). */
  proceedsCzk: Money;
  /** Zdanitelný příjem druhu z shortů (0, když je celý druh osvobozen stovkou). */
  incomeCzk: Money;
  /** Výdaje druhu ze shortů (zpětné nákupy a poplatky). */
  expensesCzk: Money;
  /**
   * Z výdajů ta část, která patří k tržbě zdaněné v NĚKTERÉM DŘÍVĚJŠÍM roce
   * (short otevřený loni, pokrytý letos).
   *
   * Osvobození stovkou se váže na úhrn tržeb ROKU. Když je letošní úhrn pod
   * limitem, letošní tržby se nedaní a jejich výdaje se neuplatní — ale výdaj
   * k tržbě, která se zdanila loni, tím zmizet nesmí: jeho příjem osvobozený
   * nebyl. (Že ho stejně nejspíš srazí § 10/4, je jiná věc — to má vidět
   * uživatel v číslech, ne se to ztratit cestou.)
   */
  priorYearIncomeExpensesCzk: Money;
  /** Shorty otevřené k 31. 12. analyzovaného roku (R-13j). */
  openAtYearEnd: OpenShortPosition[];
}

const EMPTY: ShortSalesResult = {
  items: [],
  proceedsCzk: ZERO,
  incomeCzk: ZERO,
  expensesCzk: ZERO,
  priorYearIncomeExpensesCzk: ZERO,
  openAtYearEnd: [],
};

type Trade = Extract<Transaction, { type: 'BUY' | 'SELL' }>;

/** Obchod, který otevírá nebo uzavírá krátkou pozici (R-13, `positionEffect`). */
export const isShortSaleTrade = (tx: Transaction): tx is Trade =>
  (tx.type === 'SELL' && tx.positionEffect === 'OPEN') ||
  (tx.type === 'BUY' && tx.positionEffect === 'CLOSE');

/** Otevřený prodej nakrátko čekající na pokrytí — fronta FIFO (R-13c). */
interface OpenLot {
  remaining: Money;
  currency: string;
  date: IsoDate;
}

export function computeShortSales(
  transactions: Transaction[],
  year: number,
  fx: FxConverter,
  warnings: WarningCollector,
): ShortSalesResult {
  const trades = transactions.filter(isShortSaleTrade);
  if (trades.length === 0) return EMPTY;

  const yearEnd = `${year}-12-31`;
  // R-13b: rozhodné je datum VYPOŘÁDÁNÍ, stejně jako u ostatních prodejů CP (R-05a)
  const dateOf = (tx: Trade): IsoDate =>
    tx.settlementDate ?? inferSettlementDate(tx.tradeDate, tx.isin, tx.assetClass, tx.settlementStyle);
  // Uvnitř dne musí být OTEVŘENÍ před UZAVŘENÍM — u shortu je otevřením
  // PRODEJ, takže sdílené `eventPriority` (nákup 1, prodej 2) tady platí
  // obráceně a intradenní short by se pokrýval proti prázdné frontě.
  // ID rozhoduje až na posledním místě, kvůli determinismu.
  const priority = (tx: Trade): number => (tx.type === 'SELL' ? 0 : 1);
  const sorted = trades
    .filter((tx) => dateOf(tx) <= yearEnd)
    .sort((a, b) => {
      const da = dateOf(a);
      const db = dateOf(b);
      if (da !== db) return da < db ? -1 : 1;
      const order = priority(a) - priority(b);
      if (order !== 0) return order;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });

  const open = new Map<string, OpenLot[]>();
  const items: ShortSaleItem[] = [];
  const feeCzk = (tx: Trade, date: IsoDate): Money =>
    tx.fee ? fx.toCzk(tx.fee.amount, tx.fee.currency, date) : ZERO;

  for (const tx of sorted) {
    const date = dateOf(tx);
    const txYear = Number(date.slice(0, 4));

    if (tx.type === 'SELL') {
      const proceedsCcy = tx.quantity.mul(tx.pricePerShare);
      const queue = open.get(tx.isin) ?? [];
      queue.push({ remaining: tx.quantity, currency: tx.currency, date });
      open.set(tx.isin, queue);
      if (txYear !== year) continue;
      // Komise při OTEVŘENÍ je výdaj na dosažení příjmu (§ 10/5) a uplatní se
      // v roce prodeje — tedy proti tržbě, kterou tentýž rok zdaňuje.
      items.push({
        isin: tx.isin,
        date,
        year: txYear,
        kind: 'SHORT_OPEN',
        quantity: tx.quantity,
        priorYearExpenseCzk: ZERO,
        incomeCzk: fx.toCzk(proceedsCcy, tx.currency, date),
        expenseCzk: feeCzk(tx, date),
      });
      continue;
    }

    // BUY + CLOSE: pokrytí shortu, FIFO proti otevřeným prodejům
    const queue = open.get(tx.isin) ?? [];
    let toCover = tx.quantity;
    let priorYearQuantity = ZERO;
    while (toCover.gt(0) && queue.length > 0) {
      const lot = queue[0]!;
      const take = lot.remaining.lt(toCover) ? lot.remaining : toCover;
      // tržba z dřívějšího roku se už zdanila — její výdaj nesmí spadnout pod
      // letošní osvobození stovkou (viz priorYearIncomeExpensesCzk)
      if (Number(lot.date.slice(0, 4)) < year) priorYearQuantity = priorYearQuantity.plus(take);
      lot.remaining = lot.remaining.minus(take);
      toCover = toCover.minus(take);
      if (lot.remaining.lte(0)) queue.shift();
    }
    open.set(tx.isin, queue);

    if (toCover.gt(0) && txYear === year) {
      // Pokrytí bez otevřeného shortu = díra v historii, ne obchod navíc.
      // Hlásí se hlasitě: tichý zápis by vyrobil výdaj bez odpovídajícího
      // příjmu. Jen za analyzovaný rok — chyba o transakci, která do letošních
      // čísel nevstupuje, by uživatele honila po historii bez důvodu.
      warnings.add(
        'SHORT_COVER_WITHOUT_OPEN',
        'ERROR',
        `Zpětný nákup ${tx.ticker ?? tx.isin} z ${czDateText(date)}: k ${toCover.toString()} ks nevidíme otevřený prodej nakrátko. Nahraj výpis od otevření pozice — jinak se výdaj uplatní proti příjmu, který v datech není.`,
        { txId: tx.id, isin: tx.isin },
      );
    }
    if (txYear !== year) continue;

    const costCcy = tx.quantity.mul(tx.pricePerShare);
    const costCzk = fx.toCzk(costCcy, tx.currency, date).plus(feeCzk(tx, date));
    // R-13c: výdaj se mezi roky dělí POMĚREM KUSŮ, ne cenou. Kolik kusů
    // tenhle zpětný nákup pokryl z loňských otevření, tolik z jeho ceny patří
    // k tržbě, která se zdanila dřív.
    const priorShare = tx.quantity.gt(0) ? priorYearQuantity.div(tx.quantity) : ZERO;
    items.push({
      isin: tx.isin,
      date,
      year: txYear,
      kind: 'SHORT_COVER',
      quantity: tx.quantity,
      priorYearExpenseCzk: costCzk.mul(priorShare),
      incomeCzk: ZERO,
      expenseCzk: costCzk,
    });
  }

  const openAtYearEnd: OpenShortPosition[] = [];
  for (const [isin, queue] of open) {
    const remaining = sum(queue.map((lot) => lot.remaining));
    if (remaining.lte(0)) continue;
    openAtYearEnd.push({
      isin,
      quantity: remaining,
      currency: queue[0]!.currency,
      openedAt: queue[0]!.date,
    });
  }

  const proceedsCzk = sum(
    items.filter((item) => item.kind === 'SHORT_OPEN').map((item) => item.incomeCzk),
  );
  return {
    items,
    // Do poolu 100k patří HRUBÁ tržba prodeje nakrátko — pool je o „úhrnu
    // příjmů z úplatného převodu“ (R-13e).
    proceedsCzk,
    incomeCzk: sum(items.map((item) => item.incomeCzk)),
    expensesCzk: sum(items.map((item) => item.expenseCzk)),
    priorYearIncomeExpensesCzk: sum(items.map((item) => item.priorYearExpenseCzk)),
    openAtYearEnd,
  };
}

/**
 * R-13j: short otevřený přes konec roku. Tržba se zdanila letos, zpětný nákup
 * bude výdaj až příští rok — a když proti němu příští rok nebude dost příjmů
 * druhu, propadne (§ 10/4). Uživatel to má vědět v prosinci, ne v březnu.
 */
export function warnOpenShorts(
  result: ShortSalesResult,
  year: number,
  warnings: WarningCollector,
): void {
  for (const position of result.openAtYearEnd) {
    warnings.add(
      'SHORT_OPEN_AT_YEAR_END',
      'WARNING',
      `Prodej nakrátko ${position.isin} (${position.quantity.toString()} ks, otevřeno ${czDateText(position.openedAt)}) je k 31. 12. ${year} pořád otevřený. Tržbu z něj daníme už letos, ale zpětný nákup bude výdaj až v roce, kdy ho zaplatíš — a když proti němu tehdy nebudou příjmy z prodeje cenných papírů, propadne (§ 10/4). Zvaž uzavření pozice ještě letos, nebo si to prober s poradcem.`,
      { isin: position.isin },
    );
  }
}

/** Prázdný výsledek pro rok bez jediného shortu (sdílí ho engine i testy). */
export const noShortSales = (): ShortSalesResult => EMPTY;
