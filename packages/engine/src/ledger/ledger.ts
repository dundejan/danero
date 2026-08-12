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
  type DividendTransaction,
  type IsoDate,
  type Money,
  type SellTransaction,
  type Transaction,
  type TransferInTransaction,
} from '@danero/shared';
import { calendarForIsin, isExchangeHoliday } from '../config/exchangeHolidays';
import type { EngineOptions, MatchingMethod } from '../config/options';
import { czDateText, moneyText, qtyText } from '../format';
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
  /**
   * R-07h: kolik z vratky kapitálu zůstalo zdanitelné jako dividenda — klíčem
   * je id výplaty, hodnota je v její měně. Záznam vzniká JEN při zapnutém
   * přepínači `returnOfCapitalReducesBasis`; jeho nepřítomnost tedy znamená
   * „daní se celá" a `computeDividends` nemusí přepínač znát podruhé.
   */
  returnOfCapitalTaxable: Map<string, Money>;
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
  // R-12e: opce se vypořádávají T+1 (prémie i výsledek uzavření připisuje
  // clearing následující obchodní den). Bez téhle větve na ně dopadal zbytkový
  // dopočet T+2 podle kalendáře TARGET2, protože brokeři je reportují pod
  // SYNTETICKÝM identifikátorem (`OPT:SPY-…`), ze kterého se burza poznat nedá,
  // a `settlementDate` u opcí plní jedině IBKR. Doloženo přes parser Schwabu:
  // prodej opce 30. 12. 2025 dostal vypořádání 2. 1. 2026, takže ZO 2025
  // vykázalo derivátové příjmy 0 Kč a limit 50k „neprolomeno“, zatímco do
  // ZO 2026 přiteklo 124 800 Kč navíc (A2-3-05, táž vada jako A2-10).
  if (settlementStyle === 'PREMIUM') {
    const calendar = calendarForIsin(isin);
    return addBusinessDays(tradeDate, 1, (day) => isExchangeHoliday(calendar, day));
  }
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
 * Poslední kritérium řazení: ID **ordinálně**, nikdy `localeCompare`.
 *
 * `localeCompare` bere řadicí pravidla z locale procesu (ICU podle `LANG`
 * / `LC_ALL`). Česká abeceda řadí digraf „ch“ až za „h“, takže tentýž vstup
 * vyšel pod `LC_ALL=cs_CZ` jinak než pod `en_US` — a s jiným pořadím lotů
 * vyšel jiný dílčí základ daně (nález A2-3-10; naměřeno `ibkr-ch1` × `ibkr-h9`,
 * základ 3 000 vs. 0 Kč). Daň nesmí záviset na jazykovém nastavení serveru:
 * vlastní instance podle docs/16 běží typicky v českém prostředí.
 *
 * Hlídá to `test/determinismus.test.ts` a strážný test na výskyt `localeCompare`
 * kdekoli v enginu.
 */
export const ordinalById = (a: { id: string }, b: { id: string }): number =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

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
  /** R-07h: zdanitelný zbytek vratky kapitálu per transakce (v její měně). */
  const returnOfCapitalTaxable = new Map<string, Money>();
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
  /**
   * Seřazená zásoba lotů jednoho ISIN pro párování prodejů — a kurzor, kam až
   * je vyčerpaná.
   *
   * `orderLots` se do téhle změny volalo při KAŽDÉM prodeji. U FIFO/LIFO to
   * skoro nic nestojí (pole už v pořadí nabytí je, TimSort ho projde lineárně),
   * ale MAX_PROFIT/MAX_LOSS řadí podle nabývací ceny, tedy v prakticky náhodném
   * pořadí — a to je řazení `Decimal` porovnáními při každém prodeji znovu.
   * Naměřeno na 25 000 transakcích s velkou zásobou otevřených lotů:
   * FIFO 1,3 s · LIFO 1,5 s · **MAX_PROFIT 9,3 s · MAX_LOSS 8,4 s**.
   *
   * Prodej ale pořadí neruší — jen ubírá z čela. Řadí se proto znovu jen tehdy,
   * když se zásoba změní jinak než prodejem (nový lot, korporátní akce,
   * odchozí převod, který spotřebovává ve FIFO pořadí bez ohledu na metodu).
   * Řazení je úplné uspořádání (shody rozhoduje `ordinalById`), takže vybraná
   * podposloupnost je totožná s tím, co by dalo řazení znovu — spárování lotů
   * se nemění, jen se nepočítá pořád dokola.
   */
  interface OrderedLots {
    lots: Lot[];
    /** Index prvního lotu, který ještě má zbytek; nižší jsou vyčerpané. */
    cursor: number;
  }
  const orderedByIsin = new Map<string, OrderedLots>();
  const invalidateOrder = (isin: string): void => {
    orderedByIsin.delete(isin);
  };
  const registerLot = (lot: Lot): void => {
    lots.push(lot);
    const bucket = lotsByIsin.get(lot.isin);
    if (bucket) bucket.push(lot);
    else lotsByIsin.set(lot.isin, [lot]);
    invalidateOrder(lot.isin);
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
   * Kandidáti na spárování prodeje, seřazení podle zvolené metody. Výsledek se
   * drží do nejbližší změny zásoby (viz `orderedByIsin`) — metoda párování je
   * v rámci jednoho běhu enginu neměnná, takže se cache nemusí klíčovat i jí.
   */
  const orderedLotsFor = (isin: string): OrderedLots => {
    const cached = orderedByIsin.get(isin);
    if (cached) return cached;
    const fresh: OrderedLots = { lots: openLots(isin), cursor: 0 };
    orderLots(fresh.lots, options.matchingMethod, fx, costCzkCache);
    orderedByIsin.set(isin, fresh);
    return fresh;
  };
  /**
   * Korporátní akce (ISIN_CHANGE, MERGER) přepisují `lot.isin` — index se tím
   * musí přerejstříkovat, jinak by lot pod novým ISIN nikdo nenašel. Pořadí
   * v cílovém kbelíku zůstává vložením na konec, tedy stejné jako u původního
   * `filter()` přes celé pole.
   */
  const moveLotToIsin = (lot: Lot, newIsin: string): void => {
    // zásoba se mění na OBOU stranách — seřazené pohledy obou ISIN jsou pryč
    invalidateOrder(lot.isin);
    invalidateOrder(newIsin);
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
    const ordered = orderedLotsFor(tx.isin);

    let toFill = tx.quantity;
    const allocations: DisposalAllocation[] = [];
    while (ordered.cursor < ordered.lots.length && toFill.gt(0)) {
      const lot = ordered.lots[ordered.cursor]!;
      // vyčerpaný lot (prodejem i odchozím převodem) už kandidát není
      if (lot.remaining.lte(0)) {
        ordered.cursor += 1;
        continue;
      }
      const take = Decimal.min(lot.remaining, toFill);
      lot.remaining = lot.remaining.sub(take);
      toFill = toFill.sub(take);
      // kurzor se posouvá jen u DOČERPANÉHO lotu — částečně prodaný zůstává
      // prvním kandidátem i pro další prodej
      if (lot.remaining.lte(0)) ordered.cursor += 1;
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

  /**
   * R-07h: vratka kapitálu snižuje nabývací cenu otevřených lotů téhož ISIN
   * poměrně podle zbývajícího množství — stejnou mechanikou, jakou spin-off
   * odkrajuje cenu mateřské pozice (R-04f).
   *
   * Co se nedá vstřebat, zůstává zdanitelné jako dividenda (R-07b) — mantinely
   * jsou v docs/02 u R-07h a všechny míří konzervativním směrem: bez pozice,
   * v cizí měně i nad rámec nabývací ceny se daní.
   *
   * Vratka se nerozpouští „na kus a zpátky": zdanitelný zbytek se skládá
   * z konkrétních nevstřebaných kusů, takže při dělitelném podílu vyjde přesná
   * nula. Kdyby se počítal jako `brutto − vstřebáno`, zbyl by po dělení
   * (1/3 pozice) zlomek haléře a vyrobil falešné varování o přebytku.
   */
  const processReturnOfCapital = (tx: DividendTransaction): void => {
    const zdanitelne = (amount: Money): void => {
      returnOfCapitalTaxable.set(tx.id, amount);
    };
    const nazev = tx.ticker ?? tx.isin ?? 'vratka kapitálu';
    if (tx.withholdingTax.gt(0)) {
      warnings.add(
        'RETURN_OF_CAPITAL_WITHHELD',
        'WARNING',
        `Vratka kapitálu ${nazev} z ${czDateText(tx.date)} má sraženou daň ${moneyText(tx.withholdingTax, tx.currency)} — z vrácení vkladu se daň nesráží, takže řádek daníme jako dividendu (§ 8) i při zapnutém mírnějším výkladu. Zkontroluj ho ve výpisu brokera.`,
        { txId: tx.id },
      );
      return zdanitelne(tx.gross);
    }
    const candidates = tx.isin ? openLots(tx.isin) : [];
    const held = sum(candidates.map((lot) => lot.remaining));
    if (held.lte(0)) {
      warnings.add(
        'RETURN_OF_CAPITAL_NO_POSITION',
        'WARNING',
        `Vratka kapitálu ${nazev} z ${czDateText(tx.date)}: k tomuhle dni už není otevřená pozice, které by šlo snížit nabývací cenu — celá částka ${moneyText(tx.gross, tx.currency)} se daní jako dividenda (§ 8).`,
        { txId: tx.id },
      );
      return zdanitelne(tx.gross);
    }

    const perShare = tx.gross.div(held);
    let reduced = ZERO;
    /** Část připadající na loty v jiné měně — nesnižuje se, daní se (mantinel 3). */
    let otherCurrency = ZERO;
    /** Část, kterou nabývací cena neunesla (mantinel 1) — vlastní varování s částkou. */
    let overBasis = ZERO;
    for (const lot of candidates) {
      if (lot.currency !== tx.currency) {
        otherCurrency = otherCurrency.plus(perShare.mul(lot.remaining));
        continue;
      }
      const reduction = Decimal.min(lot.costPerShare, perShare);
      lot.costPerShare = lot.costPerShare.sub(reduction);
      reduced = reduced.plus(reduction.mul(lot.remaining));
      const excess = perShare.sub(reduction);
      if (excess.gt(0)) overBasis = overBasis.plus(excess.mul(lot.remaining));
    }
    // nabývací ceny se změnily → pořadí kandidátů pro MAX_PROFIT/MAX_LOSS taky
    invalidateOrder(tx.isin!);

    if (otherCurrency.gt(0)) {
      warnings.add(
        'RETURN_OF_CAPITAL_CURRENCY_MISMATCH',
        'WARNING',
        `Vratka kapitálu ${nazev} z ${czDateText(tx.date)} je v ${tx.currency}, ale pozice je vedená v jiné měně — část ${moneyText(otherCurrency, tx.currency)} připadající na tyhle kusy se daní jako dividenda (§ 8). Přepočet vratky a nabývací ceny dvěma různými kurzovými soustavami by pozici rozhodil (R-06a).`,
        { txId: tx.id },
      );
    }
    if (reduced.gt(0)) {
      warnings.add(
        'RETURN_OF_CAPITAL_REDUCED_BASIS',
        'INFO',
        `Vratka kapitálu ${nazev} z ${czDateText(tx.date)} snížila nabývací cenu pozice o ${moneyText(reduced, tx.currency)} (R-07h) — daň z ní přijde až s prodejem.`,
        { txId: tx.id },
      );
    }
    if (overBasis.gt(0)) {
      warnings.add(
        'RETURN_OF_CAPITAL_EXCESS',
        'WARNING',
        `Vratka kapitálu ${nazev} z ${czDateText(tx.date)} přesáhla nabývací cenu pozice o ${moneyText(overBasis, tx.currency)} — přebytek se daní jako dividenda (§ 8).`,
        { txId: tx.id },
      );
    }
    zdanitelne(otherCurrency.plus(overBasis));
  };

  const processTransferOut = (tx: Extract<Transaction, { type: 'TRANSFER_OUT' }>): void => {
    // Odchozí převod spotřebovává loty ve FIFO pořadí bez ohledu na zvolenou
    // metodu (R-04i), takže může vyprázdnit lot uprostřed seřazeného pohledu —
    // ten se proto zahazuje.
    invalidateOrder(tx.isin);
    const candidates = openLots(tx.isin);
    orderLots(candidates, 'FIFO');
    let toFill = tx.quantity;
    for (const lot of candidates) {
      if (toFill.lte(0)) break;
      const take = Decimal.min(lot.remaining, toFill);
      lot.remaining = lot.remaining.sub(take);
      toFill = toFill.sub(take);
    }
    invalidateOrder(tx.isin);
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
    // Split i spin-off přepisují `costPerShare` otevřených lotů, fúze a změna
    // ISIN je stěhují jinam — pořadí pro párování prodejů se po tomhle musí
    // spočítat znovu. Zneplatňuje se PŘED i po (uvnitř se čte `openLots`)
    // a schválně tupě pro všechny dotčené ISIN, ne podle podtypu: levné to je,
    // a výjimka „tenhle podtyp pořadí nemění" je přesně to, co se při další
    // změně zapomene.
    invalidateOrder(tx.isin);
    if (tx.newIsin) invalidateOrder(tx.newIsin);
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
    invalidateOrder(tx.isin);
    if (tx.newIsin) invalidateOrder(tx.newIsin);
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
      case 'DIVIDEND':
        // R-07h: bez zapnutého mírnějšího výkladu se dividendy (ani vratky
        // kapitálu) lotů nedotýkají — celý řádek řeší computeDividends
        if (options.returnOfCapitalReducesBasis && tx.returnOfCapital) {
          processReturnOfCapital(tx);
        }
        break;
      default:
        // DIVIDEND / INTEREST / FEE / FX_CONVERSION / DEPOSIT / WITHDRAWAL loty neovlivňují
        break;
    }
  }

  return { lots, disposals, returnOfCapitalTaxable };
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
    // Ordinálně, NE `localeCompare` — viz `ordinalById` (nález A2-3-10).
    // Tady to rozhoduje, KTERÝ lot se prodeji spáruje, tedy přímo nabývací
    // cenu a dílčí základ daně.
    return ordinalById(a, b);
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
      // Tiše (A1-3-07): řadí se i loty, které se letos neprodají, takže
      // chybějící kurz tu nesmí ani shodit ledger, ani vyrobit varování —
      // výdajová větev roku příjmu si chybu nahlásí sama (FX_*_RATE_MISSING).
      cost = fx.toCzkQuiet(lot.costPerShare, lot.currency, lot.expenseDate) ?? lot.costPerShare;
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
