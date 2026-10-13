import { XMLParser } from 'fast-xml-parser';
import { d, TransactionSchema, ZERO } from '@danero/shared';
import { cleanNumber, isValidIsoDate } from '../csv';
import { fnv1a64 } from '../dedupe';
import type { ImportResult, RetractedEvent } from '../types';

export const IBKR_BROKER = 'ibkr';

/**
 * Parser IBKR Flex Query XML (docs/03, docs/09 G2; referenční sémantika
 * csingley/ibflex). Zpracovává sekce Trades, CashTransactions (dividendy
 * + srážková daň jako samostatné řádky!), CorporateActions (FS/RS/IC/SO/TC/DW),
 * Transfers a OpenPositions (rekonciliace). Čísla se drží jako stringy →
 * Decimal, žádný float.
 *
 * Zásady shodné s T212 parserem: chybějící data = viditelný error (žádné tiché
 * přeskočení), vědomě nepodporované = skipped, výkladové nejasnosti = warning.
 */

/** Pozice z FlexStatement OpenPositions — vstup rekonciliace (+ cena pro portfolio). */
export interface IbkrOpenPosition {
  isin: string;
  quantity: string;
  /** Ocenění z výpisu (markPrice), v měně instrumentu — je-li ve Flex Query zapnuté. */
  markPrice?: string;
  currency?: string;
}

export interface IbkrParseOutcome extends ImportResult {
  /** Otevřené pozice z výpisu (je-li sekce v query zapnutá). */
  openPositions: IbkrOpenPosition[];
  /** accountId z FlexStatement (pro multi-účet UI). */
  accountIds: string[];
  /**
   * Roky, které výpis pokrývá (fromDate–toDate z FlexStatement). Rok bez jediné
   * transakce uvnitř tohoto rozsahu je OVĚŘENĚ prázdný — mimo něj je to díra
   * v historii a kontrola pozic to musí říct (B-6).
   */
  coveredYears: number[];
  /** Události, které výpis ruší — viz `ImportResult.retracted`. */
  retracted: RetractedEvent[];
}

type Attrs = Record<string, string>;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  // čísla nechat jako stringy — Decimal, žádná ztráta přesnosti
  parseAttributeValue: false,
  parseTagValue: false,
});

/** fast-xml-parser vrací jeden element jako objekt, víc jako pole. */
function asArray(value: unknown): Attrs[] {
  if (value === undefined || value === null) return [];
  return (Array.isArray(value) ? value : [value]) as Attrs[];
}

/**
 * Pořadí dne a měsíce v lomítkovém datu. Platí pro CELÝ dokument a nastaví se
 * jednou na začátku parsování (parser je synchronní, takže si běhy nelezou do
 * zelí). Výchozí je americký tvar, který IBKR nabízí jako první.
 */
type SlashOrder = 'MM/dd' | 'dd/MM';
let slashOrder: SlashOrder = 'MM/dd';

/**
 * Rozhodne pořadí z celého dokumentu: stačí jediné datum, kde je první číslo
 * větší než 12 (pak je to den), nebo druhé (pak je to den na druhém místě).
 * Vrací i to, jestli soubor rozhodl — když ne a lomítková data v něm jsou,
 * volající o tom uživatele zpraví.
 */
function detectSlashOrder(text: string): { order: SlashOrder; decided: boolean; present: boolean } {
  let dayFirst = 0;
  let monthFirst = 0;
  let present = false;
  for (const match of text.matchAll(/="(\d{1,2})\/(\d{1,2})\/(?:\d{4}|\d{2})(?=[";,\s])/g)) {
    present = true;
    if (Number(match[1]) > 12) dayFirst += 1;
    else if (Number(match[2]) > 12) monthFirst += 1;
  }
  if (dayFirst > monthFirst) return { order: 'dd/MM', decided: true, present };
  if (monthFirst > dayFirst) return { order: 'MM/dd', decided: true, present };
  return { order: 'MM/dd', decided: false, present };
}

/** Zkratky měsíců v IBKR datumech typu „10-Jun-25“. */
const MONTH_ABBR: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

/**
 * IBKR datumy. Formát data si uživatel VOLÍ ve Flex Query (Delivery
 * Configuration), takže krom výchozího `yyyyMMdd` chodí i `yyyy-MM-dd`,
 * `MM/dd/yyyy`, `dd-MMM-yy` a ISO s `T`. Do 12. 8. 2026 uměl parser jen první
 * dva: ostatní varianty vracely 0 transakcí a hlášku „obchodu chybí datum“ —
 * přestože datum v souboru bylo, jen jinak zapsané.
 */
function toIsoDate(value: string | undefined): string | null {
  const iso = toIsoDateCandidate(value);
  // neexistující kalendářní den (překlep i špatně uhodnutý formát) musí skončit
  // chybou řádku, ne tichým posunem data
  return iso !== null && isValidIsoDate(iso) ? iso : null;
}

function toIsoDateCandidate(value: string | undefined): string | null {
  if (!value) return null;
  // čas se odděluje `;`, čárkou, mezerou nebo ISO `T` — `T` ale jen když za ním
  // opravdu jde čas, jinak by se `10-OCT-25` uříznulo na `10-OC` a říjnové
  // řádky by se jako jediné neimportovaly
  const datePart = value.trim().split(/[;,\s]|T(?=\d)/)[0]!;

  const compact = datePart.replaceAll('-', '');
  // osm číslic je datum, čtrnáct datum a čas bez oddělovače (volba „No separator“)
  if (/^\d{8}(\d{6})?$/.test(compact)) {
    return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
  }

  // MM/dd/yyyy (US) i dd/MM/yyyy — pořadí rozhoduje CELÝ dokument, ne jednotlivá
  // hodnota: „05/06/2025“ je samo o sobě nerozhodnutelné a hádat řádek po řádku
  // znamená, že v jednom souboru vyjde jednou květen a jindy červen
  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})$/.exec(datePart);
  if (slash) {
    const [, first, second, yearRaw] = slash;
    const year = yearRaw!.length === 2 ? `20${yearRaw}` : yearRaw!;
    const [month, day] = slashOrder === 'dd/MM' ? [second!, first!] : [first!, second!];
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  // dd-MMM-yy i dd-MMM-yyyy („10-Jun-25“)
  const named = /^(\d{1,2})-([A-Za-z]{3})-(\d{2}|\d{4})$/.exec(datePart);
  if (named) {
    const month = MONTH_ABBR[named[2]!.toLowerCase()];
    if (month === undefined) return null;
    const year = named[3]!.length === 2 ? `20${named[3]}` : named[3]!;
    return `${year}-${month}-${named[1]!.padStart(2, '0')}`;
  }
  return null;
}

const ISIN_RE = /\b([A-Z]{2}[A-Z0-9]{9}\d)\b/g;

/**
 * R-13: prodej nakrátko z Flex Query. Pozná se až KOMBINACÍ dvou údajů —
 * `openCloseIndicator` sám o sobě říká jen otevření/uzavření pozice, směr nese
 * `buySell` (a shodně s ním znaménko `quantity`, které je u prodeje vždy
 * záporné). Short je tedy `O` u prodeje a `C` u nákupu; obyčejný nákup je
 * `O` u nákupu.
 *
 * Hodnota `C;O` je jediný fill, který zavírá jednu pozici a otevírá opačnou.
 * Rozdělit ho na dvě transakce z dat nejde (Flex neuvádí, kolik kusů připadá
 * na kterou stranu), takže se raději neoznačí vůbec — spočítá se jako dosud
 * a uživatel dostane varování. Tiše ho označit za short by bylo horší.
 *
 * ⚠️ Varování ale nesmí vyznít jako pobídka „doplň si tu short část přes
 * univerzální šablonu“ (tak znělo do 31. 8. 2026). Řádek je totiž už
 * naimportovaný a šablona je jiný jmenný prostor dedupe, takže se ruční
 * dopisek nenahradí — přičte se. Naměřeno: 40 dopsaných kusů ke stokusovému
 * fillu dalo v ledgeru 140 prodaných kusů ze skutečných 100, cross-broker
 * hlášení duplicitu nenašlo (`cross: []`) a uživatel nedostal ani varování.
 * Jediná cesta k přesnému rozdělení je vrátit import a zapsat obě nohy ručně.
 */
function shortPositionEffect(
  trade: Attrs,
  buySell: string,
  line: number,
  result: ImportResult,
): 'OPEN' | 'CLOSE' | undefined {
  const indicator = String(trade.openCloseIndicator ?? '').toUpperCase().trim();
  if (indicator === '' || indicator === '-') return undefined;
  if (indicator.includes(';')) {
    result.warnings.push({
      line,
      message: `Obchod ${trade.symbol ?? ''} z ${trade.tradeDate ?? ''} zároveň zavírá jednu pozici a otevírá opačnou (openCloseIndicator „${trade.openCloseIndicator}“) — kolik kusů patří na kterou stranu, výpis neuvádí. Zpracovali jsme ho jako jeden běžný obchod, takže počet kusů i částka sedí; rozdělené na prodej nakrátko a běžnou pozici není. Nedoplňuj ho proto přes univerzální šablonu — obchod už naimportovaný je a druhý záznam by kusy přičetl podruhé. Jestli na tom rozdělení záleží, vrať celý tenhle import zpět (tlačítko „Vrátit import zpět“ v historii importů) a zapiš obě nohy ručně přes univerzální šablonu se sloupcem position_effect.`,
    });
    return undefined;
  }
  if (indicator !== 'O' && indicator !== 'C') return undefined;
  const isShortSide = buySell === 'SELL' ? indicator === 'O' : indicator === 'C';
  if (!isShortSide) return undefined;
  return indicator === 'O' ? 'OPEN' : 'CLOSE';
}

/** „4 FOR 1“ v actionDescription → { to: 4, from: 1 } (nové za staré). */
function parseForRatio(description: string): { from: string; to: string } | null {
  const match = /([\d.]+)\s+FOR\s+([\d.]+)/i.exec(description);
  if (!match) return null;
  return { to: match[1]!, from: match[2]! };
}

function isDetailRow(attrs: Attrs): boolean {
  // Flex umí SUMMARY i DETAIL řádky zároveň — bez filtru by se vše zdvojilo
  const level = attrs.levelOfDetail;
  return !level || level.toUpperCase() === 'DETAIL';
}

function isExecutionRow(attrs: Attrs): boolean {
  // obchody mají levelOfDetail="EXECUTION"; ORDER/souhrny by exekuce zdvojily
  const level = attrs.levelOfDetail;
  return !level || level.toUpperCase() === 'EXECUTION';
}

/**
 * Stabilní fallback id z obsahu záznamu — NIKDY z pořadí v souboru (pořadové
 * číslo se mezi překrývajícími se exporty posune a rozbije deduplikaci).
 * Legitimně identické záznamy (dva stejné převody v týž den) dostanou pořadový
 * suffix -2, -3… — v rámci obsahu stejné množiny záznamů zůstává stabilní.
 * Parser je synchronní, module-level počítadlo s resetem na začátku parse je bezpečné.
 */
const idOccurrences = new Map<string, number>();

function resetContentIds(): void {
  idOccurrences.clear();
}

function contentId(prefix: string, parts: Array<string | undefined>): string {
  const base = `ibkr-${prefix}-${fnv1a64(parts.map((p) => p ?? '').join('|'))}`;
  const seen = (idOccurrences.get(base) ?? 0) + 1;
  idOccurrences.set(base, seen);
  return seen === 1 ? base : `${base}-${seen}`;
}

/** Roky pokryté výpisem: fromDate–toDate (YYYYMMDD) z FlexStatement. */
function statementYears(statement: Record<string, unknown>): number[] {
  const yearOf = (value: unknown): number | null => {
    const iso = toIsoDate(value === undefined || value === null ? undefined : String(value));
    return iso ? Number(iso.slice(0, 4)) : null;
  };
  const from = yearOf(statement.fromDate ?? statement.periodStart);
  const to = yearOf(statement.toDate ?? statement.periodEnd);
  if (from === null || to === null || to < from || to - from > 50) return [];
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

export function parseIbkrFlexXml(text: string): IbkrParseOutcome {
  const result: IbkrParseOutcome = {
    broker: IBKR_BROKER,
    transactions: [],
    errors: [],
    skipped: [],
    warnings: [],
    openPositions: [],
    accountIds: [],
    coveredYears: [],
    retracted: [],
  };

  resetContentIds();
  const slash = detectSlashOrder(text);
  slashOrder = slash.order;
  if (slash.present && !slash.decided) {
    result.warnings.push({
      line: 1,
      message:
        'Datumy ve výpisu jsou ve tvaru „05/06/2025“ a soubor nikde neprozrazuje, jestli je vpředu měsíc, ' +
        'nebo den — čteme je americky (měsíc/den). Ve Flex Query si radši přepni Date Format na yyyyMMdd ' +
        'a export stáhni znovu; jinak si zkontroluj datumy obchodů.',
    });
  }
  let root: Record<string, unknown>;
  try {
    root = parser.parse(text) as Record<string, unknown>;
  } catch (error) {
    result.errors.push({
      line: 1,
      message: `Soubor se nepodařilo přečíst jako XML: ${error instanceof Error ? error.message : String(error)}`,
    });
    return result;
  }

  const response = root.FlexQueryResponse as Record<string, unknown> | undefined;
  if (!response) {
    result.errors.push({
      line: 1,
      message:
        'Tohle nevypadá jako IBKR Flex Query XML (chybí FlexQueryResponse). Zkontroluj, že stahuješ formát XML, ne CSV.',
    });
    return result;
  }

  // Flex Web Service vydává i „Trade Confirmation Flex Query“ (type="TCF",
  // obchody v <TradeConfirms>). Je to jiný výpis: jen potvrzení obchodů, bez
  // dividend, úroků a korporátních akcí. Dřív z něj vyšel prázdný výsledek bez
  // chyby a synchronizace skončila jako úspěšná.
  const statementsWrap = response.FlexStatements as Record<string, unknown> | undefined;
  const statements = asArray(statementsWrap?.FlexStatement) as unknown as Array<
    Record<string, unknown>
  >;
  if (statements.length === 0) {
    result.errors.push({ line: 1, message: 'Flex XML neobsahuje žádný FlexStatement.' });
    return result;
  }
  if (
    String(response.type ?? '').toUpperCase() === 'TCF' ||
    statements.some((item) => item.TradeConfirms !== undefined && item.Trades === undefined)
  ) {
    result.errors.push({ line: 1, message: TRADE_CONFIRMATION_MESSAGE });
    return result;
  }

  let line = 1; // pořadí záznamu v souboru (XML nemá smysluplné řádky)
  const seenIds = new Set<string>();

  const push = (line_: number, raw: Attrs, candidate: Record<string, unknown>): void => {
    try {
      const tx = TransactionSchema.parse(candidate);
      if (seenIds.has(tx.id)) {
        result.warnings.push({
          line: line_,
          message: `Duplicitní ID transakce ${tx.id} — deduplikace záznamy sloučí. Zkontroluj, že se nepřekrývají exporty.`,
          raw: JSON.stringify(raw),
        });
      }
      seenIds.add(tx.id);
      result.transactions.push(tx);
    } catch (error) {
      result.errors.push({
        line: line_,
        message: `Záznam se nepodařilo zpracovat: ${error instanceof Error ? error.message : String(error)}`,
        raw: JSON.stringify(raw),
      });
    }
  };

  for (const statement of statements) {
    const accountId = String(statement.accountId ?? '');
    if (accountId && !result.accountIds.includes(accountId)) result.accountIds.push(accountId);
    for (const year of statementYears(statement)) {
      if (!result.coveredYears.includes(year)) result.coveredYears.push(year);
    }

    processTrades(statement, accountId, result, () => (line += 1), push);
    processCashTransactions(statement, accountId, result, () => (line += 1), push);
    processCorporateActions(statement, accountId, result, () => (line += 1), push);
    processTransfers(statement, accountId, result, () => (line += 1), push);
    collectOpenPositions(statement, result);
  }

  return result;
}

type PushFn = (line: number, raw: Attrs, candidate: Record<string, unknown>) => void;

const TRADE_CONFIRMATION_MESSAGE =
  'Tohle je Trade Confirmation Flex Query — nese jen potvrzení obchodů, bez dividend, úroků a korporátních akcí, takže z ní daně nespočítáme. V IBKR si vytvoř Activity Flex Query (Performance & Reports → Flex Queries → „+“ u Activity Flex Query) a použij její Query ID.';

const UNSUPPORTED_ASSET_MESSAGE =(symbol: string, assetCategory: string): string =>
  `Obchod ${symbol} (${assetCategory === 'CRYPTO' ? 'kryptoměna' : 'komodita'}) z výpisu IBKR sami nezaúčtujeme — nemá ISIN, podle kterého pozice vedeme. Doplň ho přes univerzální šablonu.`;

/**
 * Náklady obchodu: komise brokera a daň z transakce (atribut `taxes` — kolkovné,
 * daň z finančních transakcí, GST). IBKR počítá do nabývací ceny obojí: „Cost
 * Basis … is the inverse of proceeds plus commission and tax amount“
 * (reference Flex Query, sekce Trades). Dokud se četla jen komise, daň
 * z transakce z výdajů potichu zmizela.
 *
 * Obojí je u nákladu ZÁPORNÉ. Kladná komise je rabat a kladná daň vratka —
 * výdajem nejsou, takže se nepřičtou (dřív je `.abs()` obrátilo v náklad)
 * a řekneme o nich. Model nese u obchodu jednu měnu poplatku: daň je v měně
 * obchodu, komise v `ibCommissionCurrency`, a když se liší, započte se komise
 * a o dani se řekne.
 */
function tradeFee(
  trade: Attrs,
  line: number,
  result: ImportResult,
): { amount: string; currency: string } | undefined {
  const cost = (raw: string | undefined, label: string, currency: string): ReturnType<typeof d> => {
    if (!raw) return ZERO;
    const value = d(cleanNumber(raw));
    if (value.gt(0)) {
      result.warnings.push({
        line,
        message: `Obchod ${trade.symbol ?? ''} z ${trade.tradeDate ?? ''}: ${label} je kladná (${value.toString()} ${currency}) — broker ti ji vrátil. Od nabývací ceny ji neodečítáme; jde-li o podstatnou částku, uprav obchod přes univerzální šablonu.`,
      });
      return ZERO;
    }
    return value.abs();
  };
  const tradeCurrency = trade.currency ?? '';
  const commissionCurrency = trade.ibCommissionCurrency || tradeCurrency;
  const commission = cost(trade.ibCommission, 'komise', commissionCurrency);
  const taxes = cost(trade.taxes, 'daň z transakce', tradeCurrency);

  if (taxes.gt(0) && commission.gt(0) && commissionCurrency !== tradeCurrency) {
    result.warnings.push({
      line,
      message: `Obchod ${trade.symbol ?? ''} z ${trade.tradeDate ?? ''}: daň z transakce ${taxes.toString()} ${tradeCurrency} je v jiné měně než komise (${commissionCurrency}) — do výdajů jsme započetli jen komisi, daň doplň ručně.`,
    });
    return { amount: commission.toString(), currency: commissionCurrency };
  }
  if (commission.gt(0)) {
    return { amount: commission.plus(taxes).toString(), currency: commissionCurrency };
  }
  return taxes.gt(0) ? { amount: taxes.toString(), currency: tradeCurrency } : undefined;
}

/* ── Trades ──────────────────────────────────────────────────────────────── */

function processTrades(
  statement: Record<string, unknown>,
  accountId: string,
  result: IbkrParseOutcome,
  nextLine: () => number,
  push: PushFn,
): void {
  const section = statement.Trades as Record<string, unknown> | undefined;
  const trades = asArray(section?.Trade);
  // Úroveň „Orders“ a souhrny nejsou `<Trade levelOfDetail="ORDER">`, ale
  // vlastní elementy `<Order>`, `<SymbolSummary>` a `<AssetSummary>`. Dokud se
  // četl jen `<Trade>`, dal výpis s objednávkami bez exekucí 0 obchodů
  // a 0 chyb. (`<Lot>` sem nepatří: uzavřené loty chodí vedle exekucí.)
  let filteredLevels =
    asArray(section?.Order).length +
    asArray(section?.SymbolSummary).length +
    asArray(section?.AssetSummary).length;
  let processed = 0;
  const cancellations: Array<{ line: number; attrs: Attrs }> = [];
  // exekuce tohohle výpisu (akcie i deriváty) — podle nich se dohledává originál storna
  const executed: Array<{ id: string; attrs: Attrs }> = [];

  for (const trade of trades) {
    const line = nextLine();
    if (!isExecutionRow(trade)) {
      filteredLevels += 1;
      continue;
    }
    processed += 1;

    const assetCategory = (trade.assetCategory || 'STK').toUpperCase();
    if (assetCategory === 'CASH') {
      // FX konverze — pro výpočet daně z CP nepodstatné (kurzy řeší engine dle R-06)
      result.skipped.push({
        line,
        message: `Měnová konverze ${trade.symbol ?? ''} — pro daň z prodeje CP není potřeba.`,
      });
      continue;
    }
    // R-12: opce/futures/CFD/warranty = samostatný druh § 10 (assetClass DERIVATIVE)
    const isDerivative =
      assetCategory === 'OPT' ||
      assetCategory === 'FOP' ||
      assetCategory === 'FUT' ||
      assetCategory === 'CFD' ||
      assetCategory === 'WAR';

    const buySell = String(trade.buySell ?? '').toUpperCase();
    if (buySell.includes('(CA.)')) {
      // storno se páruje s originálem až po průchodu všemi obchody
      cancellations.push({ line, attrs: trade });
      continue;
    }
    if (buySell !== 'BUY' && buySell !== 'SELL') {
      result.errors.push({
        line,
        message: `Neznámý směr obchodu „${trade.buySell ?? ''}“ — nahlaš nám ho, doplníme podporu.`,
        raw: JSON.stringify(trade),
      });
      continue;
    }

    const isin = trade.isin?.trim();
    const tradeDate = toIsoDate(trade.tradeDate);
    const quantity = trade.quantity ? d(cleanNumber(trade.quantity)) : null;
    const price = trade.tradePrice ?? '';


    if (isDerivative) {
      // klíč instrumentu = symbol (deriváty ISIN nemají), cash tok = cena × multiplikátor
      const symbol = (trade.symbol ?? '').trim();
      const key = symbol || (trade.conid ? `IBKR:${trade.conid}` : '');
      if (!key || !tradeDate || !quantity || price === '') {
        result.errors.push({
          line,
          message: `Derivátu ${trade.symbol ?? trade.description ?? ''} chybí symbol, datum, množství nebo cena.`,
          raw: JSON.stringify(trade),
        });
        continue;
      }
      const multiplierRaw = trade.multiplier ? d(cleanNumber(trade.multiplier)) : ZERO;
      const multiplier = multiplierRaw.gt(0) ? multiplierRaw : d(1);
      const fee = tradeFee(trade, line, result);
      const id = trade.tradeID || trade.transactionID;
      const notes = String(trade.notes ?? '');
      const noteCodes = new Set(notes.split(';').map((code) => code.trim()));

      if (noteCodes.has('A') || noteCodes.has('Ex')) {
        // R-12k: uplatnění/assignment — prémie by u long měla vstoupit do ceny
        // podkladu; počítáme konzervativně (výdaj nepropadá do podkladu automaticky)
        result.warnings.push({
          line,
          message: `Opce ${symbol}: ${noteCodes.has('A') ? 'assignment' : 'uplatnění (exercise)'} — zaplacená prémie nakoupené opce by správně vstoupila do nabývací ceny podkladu. Danero ji konzervativně neuplatňuje automaticky; podklad případně uprav univerzální šablonou.`,
        });
      }
      if (assetCategory === 'WAR') {
        result.warnings.push({
          line,
          message: `Warrant ${symbol} počítáme jako derivát bez osvobození (bezpečný default, R-12d). Je-li vydaný jako cenný papír (má ISIN), zadej ho univerzální šablonou jako CP.`,
        });
      }

      const derivativeId = id
        ? `ibkr-${id}`
        : contentId('trade', [buySell, tradeDate, key, quantity.toString(), String(price)]);
      executed.push({ id: derivativeId, attrs: trade });
      push(line, trade, {
        type: buySell,
        id: derivativeId,
        account: accountId || undefined,
        isin: key,
        ticker: symbol || undefined,
        name: trade.description || undefined,
        assetClass: 'DERIVATIVE',
        // R-12f/g: futures a CFD se vypořádávají rozdílem (nominál není příjem)
        ...(assetCategory === 'FUT' || assetCategory === 'FOP' || assetCategory === 'CFD'
          ? { settlementStyle: 'MARGIN' }
          : {}),
        quantity: quantity.abs().toString(),
        pricePerShare: d(cleanNumber(String(price))).mul(multiplier).toString(),
        currency: trade.currency,
        ...(fee ? { fee } : {}),
        tradeDate,
        ...(toIsoDate(trade.settleDateTarget) ? { settlementDate: toIsoDate(trade.settleDateTarget) } : {}),
        ...(noteCodes.has('Ep') ? { note: 'Expirace opce (uzavření za 0)' } : {}),
      });
      continue;
    }

    if (!isin && (assetCategory === 'CRYPTO' || assetCategory === 'CMDTY')) {
      // krypto a komodity ISIN nemají — rada „přidej pole ISIN“ by nikam nevedla
      result.errors.push({
        line,
        message: UNSUPPORTED_ASSET_MESSAGE(trade.symbol ?? '', assetCategory),
        raw: JSON.stringify(trade),
        knownUnsupported: true,
      });
      continue;
    }
    if (!isin) {
      result.errors.push({
        line,
        message: `Obchod ${trade.symbol ?? ''} nemá ISIN — přidej do Flex Query pole ISIN (Trades → Options).`,
        raw: JSON.stringify(trade),
      });
      continue;
    }
    if (!tradeDate || !quantity || price === '') {
      result.errors.push({
        line,
        message: `Obchodu ${trade.symbol ?? ''} chybí datum, množství nebo cena.`,
        raw: JSON.stringify(trade),
      });
      continue;
    }

    // Pokladniční poukázka (BILL) se kotuje stejně jako dluhopis: quantity je
    // nominál a tradePrice procento nominálu. Mezi akciemi by vyšla stokrát dráž.
    const isDebt = assetCategory === 'BOND' || assetCategory === 'BILL';
    // dluhopisy IBKR kotuje v procentech nominálu — jediná spolehlivá cena je
    // z proceeds (skutečné plnění); bez něj radši viditelná chyba než 100× výdaj
    let pricePerShare = cleanNumber(price);
    if (isDebt) {
      const proceeds = trade.proceeds ? d(cleanNumber(trade.proceeds)).abs() : null;
      if (!proceeds || quantity.abs().lte(0)) {
        result.errors.push({
          line,
          message: `Dluhopis ${trade.symbol ?? ''}: ve Flex Query chybí pole Proceeds — bez něj neumíme určit skutečnou cenu (kotace v % nominálu). Přidej pole do query, nebo obchod zadej univerzální šablonou.`,
          raw: JSON.stringify(trade),
        });
        continue;
      }
      pricePerShare = proceeds.div(quantity.abs()).toDecimalPlaces(10).toString();
    }

    const fee = tradeFee(trade, line, result);
    const settlement = toIsoDate(trade.settleDateTarget);
    const id = trade.tradeID || trade.transactionID;
    // R-13 se týká jen spotových obchodů — u derivátů (výše) se značka
    // nepoužívá, takže se tady ani nepočítá a varování o „C;O“ nepadá na
    // rolování opce, se kterým short nemá nic společného
    const positionEffect = shortPositionEffect(trade, buySell, line, result);

    const txId = id
      ? `ibkr-${id}`
      : contentId('trade', [buySell, tradeDate, isin, quantity.toString(), pricePerShare]);
    executed.push({ id: txId, attrs: trade });
    push(line, trade, {
      type: buySell,
      ...(positionEffect ? { positionEffect } : {}),
      id: txId,
      account: accountId || undefined,
      isin,
      ticker: trade.symbol || undefined,
      name: trade.description || undefined,
      assetClass: isDebt ? 'BOND' : assetCategory === 'FUND' ? 'ETF' : 'STOCK',
      quantity: quantity.abs().toString(),
      pricePerShare,
      currency: trade.currency,
      ...(fee ? { fee } : {}),
      tradeDate,
      ...(settlement ? { settlementDate: settlement } : {}),
    });
  }

  // Storna: odstranit i původní exekuci (jinak by v DB zůstal zrušený obchod).
  // Originál se hledá podle `origTradeID`; kdo si to pole ve Flex Query
  // nezaškrtl, má storno bez odkazu — pak rozhoduje obsah (titul, čas, kusy,
  // cena, směr). Shodný je i opravný obchod, proto se bere PRVNÍ nevyřazená
  // shoda a každé storno vyřadí právě jednu exekuci.
  const removed = new Set<string>();
  const sameExecution = (original: Attrs, cancellation: Attrs): boolean => {
    const direction = String(cancellation.buySell ?? '').toUpperCase().replace(/\s*\(CA\.\)/, '');
    const quantityOf = (attrs: Attrs): string =>
      attrs.quantity ? d(cleanNumber(attrs.quantity)).abs().toString() : '';
    const priceOf = (attrs: Attrs): string =>
      attrs.tradePrice ? d(cleanNumber(attrs.tradePrice)).toString() : '';
    return (
      String(original.buySell ?? '').toUpperCase() === direction &&
      (original.isin ?? '') === (cancellation.isin ?? '') &&
      (original.tradeDate ?? '') === (cancellation.tradeDate ?? '') &&
      (original.dateTime ?? '') === (cancellation.dateTime ?? '') &&
      (original.currency ?? '') === (cancellation.currency ?? '') &&
      quantityOf(original) !== '' &&
      quantityOf(original) === quantityOf(cancellation) &&
      priceOf(original) === priceOf(cancellation)
    );
  };
  for (const cancellation of cancellations) {
    const attrs = cancellation.attrs;
    const originalId = attrs.origTradeID ? `ibkr-${attrs.origTradeID}` : null;
    // Storno říká brokerovo id původního obchodu. I když originál v tomhle
    // výpisu není (nebo je a vyřadí se), z DŘÍVĚJŠÍ synchronizace už uložený
    // být může — import ho podle `retracted` odstraní.
    if (originalId) result.retracted.push({ id: originalId, types: ['BUY', 'SELL'] });
    const matched = originalId
      ? executed.find((item) => item.id === originalId && !removed.has(item.id))
      : executed.find((item) => !removed.has(item.id) && sameExecution(item.attrs, attrs));
    const index = matched ? result.transactions.findIndex((tx) => tx.id === matched.id) : -1;
    if (matched && index >= 0) {
      removed.add(matched.id);
      result.transactions.splice(index, 1);
      result.warnings.push({
        line: cancellation.line,
        message: `Stornovaný obchod ${attrs.symbol ?? ''}${attrs.origTradeID ? ` (${attrs.origTradeID})` : ''} — originál i storno vynechány, opravný obchod je ve výpisu samostatně.`,
      });
    } else if (originalId) {
      // originál je mimo období výpisu: storno samo se neúčtuje a uložený
      // originál (pokud nějaký je) odstraní import
      result.warnings.push({
        line: cancellation.line,
        message: `Storno obchodu ${attrs.symbol ?? ''} (tradeID ${attrs.origTradeID}) míří na obchod, který v tomhle výpisu není. Jestli ho máš uložený z dřívějška, odstraníme ho; samotné storno se neúčtuje. Kdybys výpis s původním obchodem nahrál až po tomhle, nahraj pak tenhle ještě jednou.`,
      });
    } else {
      result.errors.push({
        line: cancellation.line,
        message: `Storno obchodu ${attrs.symbol ?? ''} se nepodařilo spárovat s originálem — ve Flex Query si u Trades zapni pole „Orig Trade ID“, podle kterého se storno k obchodu přiřazuje, a zkontroluj, že výpis pokrývá i původní obchod.`,
        raw: JSON.stringify(attrs),
      });
    }
  }

  if (processed === 0 && filteredLevels > 0) {
    result.errors.push({
      line: 1,
      message: `Sekce Trades obsahuje jen souhrny/objednávky (${filteredLevels} záznamů) — ve Flex Query zapni u Trades úroveň „Executions“, jinak se obchody nenaimportují.`,
    });
  }
}

/* ── CashTransactions (dividendy + srážky, úroky, poplatky, vklady) ─────── */

function processCashTransactions(
  statement: Record<string, unknown>,
  accountId: string,
  result: IbkrParseOutcome,
  nextLine: () => number,
  push: PushFn,
): void {
  const rows = asArray(
    (statement.CashTransactions as Record<string, unknown> | undefined)?.CashTransaction,
  );

  // IBKR hlásí srážkovou daň jako SAMOSTATNÝ záznam — páruje se s dividendou
  // přes (isin|symbol, datum, měna)
  interface DividendGroup {
    dividends: Array<{ line: number; attrs: Attrs; amount: ReturnType<typeof d> }>;
    withholding: ReturnType<typeof d>;
    withholdingLines: number[];
  }
  const dividendGroups = new Map<string, DividendGroup>();

  const groupKey = (attrs: Attrs, date: string): string =>
    `${attrs.isin || attrs.symbol || '?'}|${date}|${attrs.currency ?? '?'}`;

  // IBKR Ireland sráží z kreditního úroku 20 % a posílá to jako „Withholding
  // Tax“ BEZ titulu („WITHHOLDING @ 20% ON CREDIT INT FOR …“). K dividendě
  // nepatří — páruje se s úrokem téhož dne a měny, proto se úroky účtují až
  // po průchodu všemi řádky.
  const interestRows: Array<{ line: number; attrs: Attrs; key: string; candidate: Record<string, unknown> }> = [];
  const interestWithholding = new Map<string, { total: ReturnType<typeof d>; line: number }>();

  let filteredLevels = 0;
  let processed = 0;

  for (const row of rows) {
    const line = nextLine();
    if (!isDetailRow(row)) {
      filteredLevels += 1;
      continue;
    }
    processed += 1;

    const type = String(row.type ?? '');
    const date = toIsoDate(row.dateTime ?? row.reportDate);
    const amountRaw = row.amount ?? '';
    if (!date || amountRaw === '') {
      result.errors.push({
        line,
        message: `Hotovostní pohyb (${type || 'bez typu'}) nemá datum nebo částku.`,
        raw: JSON.stringify(row),
      });
      continue;
    }
    const amount = d(cleanNumber(amountRaw));
    const id = row.transactionID
      ? `ibkr-${row.transactionID}`
      : contentId('cash', [type, date, row.isin ?? row.symbol, amount.toString(), row.currency]);

    switch (type) {
      case 'Dividends':
      case 'Payment In Lieu Of Dividends': {
        const key = groupKey(row, date);
        const group = dividendGroups.get(key) ?? {
          dividends: [],
          withholding: ZERO,
          withholdingLines: [],
        };
        group.dividends.push({ line, attrs: row, amount });
        dividendGroups.set(key, group);
        if (type === 'Payment In Lieu Of Dividends') {
          result.warnings.push({
            line,
            message:
              'Náhradní platba za dividendu (payment in lieu) — daňově ji řadíme jako dividendu (§ 8), u zapůjčených akcií může být posouzení sporné.',
          });
        }
        break;
      }
      case 'Withholding Tax': {
        if (!row.isin?.trim() && !row.symbol?.trim()) {
          const cashKey = `${date}|${row.currency ?? '?'}`;
          const entry = interestWithholding.get(cashKey) ?? { total: ZERO, line };
          entry.total = entry.total.plus(amount.neg());
          interestWithholding.set(cashKey, entry);
          break;
        }
        const key = groupKey(row, date);
        const group = dividendGroups.get(key) ?? {
          dividends: [],
          withholding: ZERO,
          withholdingLines: [],
        };
        // srážka je záporná; kladná hodnota = oprava/refund → odečte se
        group.withholding = group.withholding.plus(amount.neg());
        group.withholdingLines.push(line);
        dividendGroups.set(key, group);
        break;
      }
      /**
       * R-07h: vratka kapitálu. Schválně MIMO skupinu dividend — je to jiný
       * druh výplaty a spárovat ji se srážkovou daní téhož dne by z ní udělalo
       * dividendu se zápočtem. Případná osamocená srážka se ohlásí sama
       * („Srážková daň bez párové dividendy"), takže se nic neztratí potichu.
       */
      case 'Return of Capital': {
        if (amount.lte(0)) {
          result.warnings.push({
            line,
            message: `Vratka kapitálu ${row.symbol ?? row.isin ?? ''} s částkou ${amount.toString()} ${row.currency} — nezáporná se čekala, řádek přeskočen. Zkontroluj ho ve výpisu.`,
          });
          break;
        }
        push(line, row, {
          type: 'DIVIDEND',
          id,
          account: accountId || undefined,
          isin: row.isin || undefined,
          ticker: row.symbol || undefined,
          gross: amount.toString(),
          currency: row.currency,
          withholdingTax: '0',
          returnOfCapital: true,
          date,
          note: row.description || undefined,
        });
        result.warnings.push({
          line,
          message: `Return of Capital ${row.symbol ?? row.isin ?? ''}: vratka kapitálu není podíl na zisku — věcně snižuje nabývací cenu držených kusů (daň až při prodeji). Ve výchozím nastavení ji daníme jako dividendu (§ 8) a čerpá limit 50 000 Kč; přepnout to jde v Nastavení u „Vratka kapitálu" (R-07h).`,
        });
        break;
      }
      case 'Broker Interest Received':
      case 'Bond Interest Received':
      case 'Credit Interest': {
        interestRows.push({
          line,
          attrs: row,
          // kupón z dluhopisu srážku bez titulu nebere — ta patří k úroku od brokera
          key: type === 'Bond Interest Received' ? '' : `${date}|${row.currency ?? '?'}`,
          candidate: {
            type: 'INTEREST',
            id,
            account: accountId || undefined,
            amount: amount.toString(),
            currency: row.currency,
            date,
            note: row.description || undefined,
          },
        });
        break;
      }
      case 'Broker Interest Paid':
      case 'Bond Interest Paid':
      case 'Debit Interest': {
        push(line, row, {
          type: 'FEE',
          id,
          account: accountId || undefined,
          amount: amount.abs().toString(),
          currency: row.currency,
          date,
          note: `Zaplacený úrok brokerovi${row.description ? ` — ${row.description}` : ''}`,
        });
        break;
      }
      case 'Other Fees':
      case 'Advisor Fees':
      case 'Commission Adjustments': {
        if (amount.gte(0)) {
          result.warnings.push({
            line,
            message: `Vratka poplatku ${amount.toString()} ${row.currency ?? ''} — evidujeme jen informativně, do výpočtu nevstupuje.`,
            raw: JSON.stringify(row),
          });
          break;
        }
        push(line, row, {
          type: 'FEE',
          id,
          account: accountId || undefined,
          amount: amount.abs().toString(),
          currency: row.currency,
          date,
          note: row.description || undefined,
        });
        break;
      }
      case 'Deposits/Withdrawals':
      case 'Deposits & Withdrawals': {
        push(line, row, {
          type: amount.gte(0) ? 'DEPOSIT' : 'WITHDRAWAL',
          id,
          account: accountId || undefined,
          amount: amount.abs().toString(),
          currency: row.currency,
          date,
          note: row.description || undefined,
        });
        break;
      }
      default: {
        result.errors.push({
          line,
          message: `Neznámý typ hotovostního pohybu „${type}“ — nahlaš nám ho, doplníme podporu.`,
          raw: JSON.stringify(row),
        });
      }
    }
  }

  // úroky: srážka bez titulu z téhož dne a měny připadne prvnímu úroku (R-07f)
  for (const item of interestRows) {
    const withheld = item.key === '' ? undefined : interestWithholding.get(item.key);
    if (!withheld) {
      push(item.line, item.attrs, item.candidate);
      continue;
    }
    interestWithholding.delete(item.key);
    if (withheld.total.lt(0)) {
      result.warnings.push({
        line: withheld.line,
        message:
          'U úroku převažuje vrácená srážková daň nad sraženou — srážku počítáme jako 0, zkontroluj opravy ve výpisu.',
      });
    }
    push(item.line, item.attrs, {
      ...item.candidate,
      withholdingTax: (withheld.total.lt(0) ? ZERO : withheld.total).toString(),
    });
  }
  for (const withheld of interestWithholding.values()) {
    result.warnings.push({
      line: withheld.line,
      message: `Srážková daň ${withheld.total.toString()} bez titulu a bez úroku ze stejného dne — nezaúčtováno. Bývá to srážka z úroku, který je v jiném výpisu (oprava přes hranici období); zkontroluj export za celé období.`,
    });
  }

  // dividendové skupiny → DIVIDEND transakce (srážka rozpočtená dle brutta)
  for (const group of dividendGroups.values()) {
    if (group.dividends.length === 0) {
      result.warnings.push({
        line: group.withholdingLines[0] ?? 1,
        message:
          'Srážková daň bez párové dividendy ve výpisu (nejspíš oprava přes hranici období) — nezaúčtováno, zkontroluj export za celé období.',
      });
      continue;
    }

    const totalWht = group.withholding.lt(0) ? ZERO : group.withholding;
    if (group.withholding.lt(0)) {
      result.warnings.push({
        line: group.dividends[0]!.line,
        message:
          'Kladná srážková daň (refund) převažuje — srážku počítáme jako 0, zkontroluj opravy dividend.',
      });
    }

    const dividendMeta = (item: (typeof group.dividends)[number], gross: string) => {
      const attrs = item.attrs;
      const date = toIsoDate(attrs.dateTime ?? attrs.reportDate)!;
      return {
        attrs,
        date,
        id: attrs.transactionID
          ? `ibkr-${attrs.transactionID}`
          : contentId('div', [date, attrs.isin ?? attrs.symbol, gross, attrs.currency]),
      };
    };

    const hasNegative = group.dividends.some((item) => item.amount.lt(0));
    if (hasNegative) {
      // reversal/korekce v téže skupině: poctivé netto jednou transakcí
      const netGross = group.dividends.reduce((sum, item) => sum.plus(item.amount), ZERO);
      const firstPositive = group.dividends.find((item) => item.amount.gt(0)) ?? group.dividends[0]!;
      // Skupina se účtuje jednou transakcí pod id první kladné položky.
      // Ostatní kladné položky se mohly uložit samostatně, dokud korekce ve
      // výpisu nebyla (napojený účet) — import je podle `retracted` odstraní,
      // jinak by se k netto přičetly.
      for (const item of group.dividends) {
        if (item !== firstPositive && item.amount.gt(0) && item.attrs.transactionID) {
          result.retracted.push({
            id: `ibkr-${item.attrs.transactionID}`,
            types: ['DIVIDEND'],
            onlyFromNewerStatement: true,
          });
        }
      }
      if (netGross.lte(0)) {
        if (firstPositive.attrs.transactionID) {
          result.retracted.push({
            id: `ibkr-${firstPositive.attrs.transactionID}`,
            types: ['DIVIDEND'],
            onlyFromNewerStatement: true,
          });
        }
        result.warnings.push({
          line: firstPositive.line,
          message:
            'Dividenda s korekcí vychází netto ≤ 0 — skupinu vynecháváme, zkontroluj opravy ve výpisu.',
        });
        continue;
      }
      result.warnings.push({
        line: firstPositive.line,
        message:
          'Dividenda obsahuje korekční (zápornou) položku — účtujeme netto jednou transakcí.',
      });
      const { attrs, date, id } = dividendMeta(firstPositive, netGross.toString());
      push(firstPositive.line, attrs, {
        type: 'DIVIDEND',
        id,
        account: accountId || undefined,
        isin: attrs.isin || undefined,
        ticker: attrs.symbol || undefined,
        gross: netGross.toString(),
        currency: attrs.currency,
        withholdingTax: totalWht.toDecimalPlaces(6).toString(),
        date,
        note: attrs.description || undefined,
      });
      continue;
    }

    // pro-rata podle brutta: podíl VŽDY z celkové srážky, poslední bere zbytek
    const totalGross = group.dividends.reduce((sum, item) => sum.plus(item.amount), ZERO);
    let allocated = ZERO;
    group.dividends.forEach((item, index) => {
      const isLast = index === group.dividends.length - 1;
      const share = isLast
        ? totalWht.minus(allocated)
        : totalGross.gt(0)
          ? totalWht.mul(item.amount).div(totalGross).toDecimalPlaces(6)
          : ZERO;
      allocated = allocated.plus(share);
      const { attrs, date, id } = dividendMeta(item, item.amount.toString());
      push(item.line, attrs, {
        type: 'DIVIDEND',
        id,
        account: accountId || undefined,
        isin: attrs.isin || undefined,
        ticker: attrs.symbol || undefined,
        gross: item.amount.toString(),
        currency: attrs.currency,
        withholdingTax: share.toDecimalPlaces(6).toString(),
        date,
        note: attrs.description || undefined,
      });
    });
  }

  if (processed === 0 && filteredLevels > 0) {
    result.errors.push({
      line: 1,
      message: `Sekce CashTransactions obsahuje jen souhrny (${filteredLevels} záznamů) — ve Flex Query zapni úroveň „Detail“, jinak se dividendy a úroky nenaimportují.`,
    });
  }
}

/* ── CorporateActions (FS/RS/IC/SO/TC/DW) ────────────────────────────────── */

/**
 * Popis akce bez poslední závorky. Dvě nohy téže akce mají popis shodný až na
 * ni — závorka jmenuje titul té které nohy:
 *
 *   „ABC(US…1016) SPLIT 1 FOR 20 (ABCD, ALFA CORP, US…2006)“      nový titul
 *   „ABC(US…1016) SPLIT 1 FOR 20 (ABCD.OLD, ALFA CORP, US…1016)“  starý titul
 *
 * Závorky se počítají odzadu, protože název titulu může obsahovat vlastní.
 */
function actionStem(description: string): string {
  const text = description.trim();
  if (!text.endsWith(')')) return text;
  let depth = 0;
  for (let i = text.length - 1; i >= 0; i -= 1) {
    if (text[i] === ')') depth += 1;
    else if (text[i] === '(') {
      depth -= 1;
      if (depth === 0) return text.slice(0, i).trim();
    }
  }
  return text;
}

/**
 * Klíč, pod kterým se sejdou nohy jedné korporátní akce. `actionID` je
 * spolehlivé, jenže ve skutečných výpisech bývá prázdné (všechny veřejně
 * dostupné vzorky do roku 2023); pak rozhoduje popis bez poslední závorky
 * a den. Dokud se bral popis celý, nesešly se nohy nikdy: změna ISIN končila
 * chybou „nemá kompletní pár“ a výměna akcií jako prodej za nulu.
 */
function legGroupKey(type: string, row: Attrs, description: string, date: string): string {
  return row.actionID ? `${type}|${row.actionID}` : `${type}|${actionStem(description)}|${date}`;
}

function processCorporateActions(
  statement: Record<string, unknown>,
  accountId: string,
  result: IbkrParseOutcome,
  nextLine: () => number,
  push: PushFn,
): void {
  const rows = asArray(
    (statement.CorporateActions as Record<string, unknown> | undefined)?.CorporateAction,
  );

  // IC/TC chodí v párech (staré isin záporně, nové kladně) — viz `legGroupKey`
  const pairGroups = new Map<string, Array<{ line: number; attrs: Attrs }>>();
  // FS/RS: jeden řádek, nebo dvojice starý/nový titul, když se splitem mění ISIN
  const splitGroups = new Map<
    string,
    Array<{ line: number; attrs: Attrs; id: string; date: string; description: string }>
  >();

  let filteredLevels = 0;
  let processed = 0;

  for (const row of rows) {
    const line = nextLine();
    if (!isDetailRow(row)) {
      filteredLevels += 1;
      continue;
    }
    processed += 1;

    const type = String(row.type ?? '').toUpperCase();
    const date = toIsoDate(row.dateTime ?? row.reportDate);
    const description = String(row.actionDescription ?? row.description ?? '');
    if (!date) {
      result.errors.push({
        line,
        message: `Korporátní akce (${type}) nemá datum.`,
        raw: JSON.stringify(row),
      });
      continue;
    }

    const id = row.actionID
      ? `ibkr-ca-${row.actionID}-${row.transactionID ?? ''}`
      : contentId('ca', [type, date, row.isin ?? row.symbol, description]);

    switch (type) {
      case 'FS':
      case 'RS': {
        const key = legGroupKey(type, row, description, date);
        const group = splitGroups.get(key) ?? [];
        group.push({ line, attrs: row, id, date, description });
        splitGroups.set(key, group);
        break;
      }
      case 'IC':
      case 'TC': {
        const key = legGroupKey(type, row, description, date);
        const group = pairGroups.get(key) ?? [];
        group.push({ line, attrs: row });
        pairGroups.set(key, group);
        break;
      }
      case 'SO': {
        const childIsin = row.isin?.trim();
        const descIsins = [...description.matchAll(ISIN_RE)].map((m) => m[1]!);
        const parentIsin = descIsins.find((candidate) => candidate !== childIsin);
        const ratio = parseForRatio(description);
        if (!childIsin || !parentIsin) {
          result.errors.push({
            line,
            message: `Spin-off ${row.symbol ?? ''}: nepodařilo se určit mateřský a nový ISIN z popisu — doplň akci ručně přes univerzální šablonu.`,
            raw: JSON.stringify(row),
          });
          break;
        }
        push(line, row, {
          type: 'CORPORATE_ACTION',
          id,
          account: accountId || undefined,
          subtype: 'SPINOFF',
          isin: parentIsin,
          newIsin: childIsin,
          date,
          ...(ratio ? { ratio } : {}),
          note: description || undefined,
        });
        break;
      }
      case 'DW': {
        const isin = row.isin?.trim();
        if (!isin) {
          result.errors.push({
            line,
            message: `Delisting ${row.symbol ?? ''} nemá ISIN.`,
            raw: JSON.stringify(row),
          });
          break;
        }
        push(line, row, {
          type: 'CORPORATE_ACTION',
          id,
          account: accountId || undefined,
          subtype: 'DELISTING',
          isin,
          date,
          note: description || undefined,
        });
        break;
      }
      default: {
        result.errors.push({
          line,
          message: `Nepodporovaný typ korporátní akce „${type}“ (${row.symbol ?? ''}) — nahlaš nám ho; zatím akci doplň ručně přes univerzální šablonu.`,
          raw: JSON.stringify(row),
        });
      }
    }
  }

  // Splity. Když se splitem mění ISIN (u reverse splitu v USA pravidlo — nový
  // CUSIP), posílá IBKR DVA řádky téhož typu: starý titul se zápornými kusy
  // a nový s kladnými. Dva samostatné splity by nechaly kusy pod starým ISIN
  // a nový by neměl žádný lot; je to jedna akce se starým i novým ISIN.
  const legQuantity = (attrs: Attrs): ReturnType<typeof d> => d(cleanNumber(attrs.quantity || '0'));
  for (const group of splitGroups.values()) {
    const oldLeg = group.find((leg) => legQuantity(leg.attrs).lt(0));
    const newLeg = group.find((leg) => legQuantity(leg.attrs).gt(0));
    const oldIsin = oldLeg?.attrs.isin?.trim();
    const newIsin = newLeg?.attrs.isin?.trim();
    if (group.length === 2 && oldLeg && newLeg && oldIsin && newIsin && oldIsin !== newIsin) {
      // poměr z popisu je přesný; počty kusů ho zkreslí zaokrouhlením zlomků
      const ratio = parseForRatio(oldLeg.description) ?? {
        from: legQuantity(oldLeg.attrs).abs().toString(),
        to: legQuantity(newLeg.attrs).toString(),
      };
      // Do 13. 10. 2026 se z každé nohy uložil vlastní SPLIT. Starou nohu
      // nahradí tahle akce (stejné id), split nového titulu je potřeba zrušit
      // — jinak by se poměr u už synchronizovaného účtu uplatnil dvakrát.
      result.retracted.push({ id: newLeg.id, types: ['CORPORATE_ACTION'] });
      push(oldLeg.line, oldLeg.attrs, {
        type: 'CORPORATE_ACTION',
        id: oldLeg.id,
        account: accountId || undefined,
        subtype: 'SPLIT',
        isin: oldIsin,
        newIsin,
        date: oldLeg.date,
        ratio,
        note: actionStem(oldLeg.description) || undefined,
      });
      continue;
    }
    for (const leg of group) {
      const isin = leg.attrs.isin?.trim();
      const ratio = parseForRatio(leg.description);
      if (!isin || !ratio) {
        result.errors.push({
          line: leg.line,
          message: `Split ${leg.attrs.symbol ?? ''} se nepodařilo přečíst (chybí ISIN nebo poměr „X FOR Y“ v popisu).`,
          raw: JSON.stringify(leg.attrs),
        });
        continue;
      }
      push(leg.line, leg.attrs, {
        type: 'CORPORATE_ACTION',
        id: leg.id,
        account: accountId || undefined,
        subtype: 'SPLIT',
        isin,
        date: leg.date,
        ratio,
        note: leg.description || undefined,
      });
    }
  }

  // párové akce: IC → ISIN_CHANGE, TC → MERGER (stock-for-stock) / SELL (cash)
  for (const [key, group] of pairGroups) {
    const type = key.startsWith('IC') ? 'IC' : 'TC';
    const oldLeg = group.find((g) => d(cleanNumber(g.attrs.quantity || '0')).lt(0));
    const newLeg = group.find((g) => d(cleanNumber(g.attrs.quantity || '0')).gt(0));
    const first = group[0]!;
    const date = toIsoDate(first.attrs.dateTime ?? first.attrs.reportDate)!;
    const description = actionStem(
      String(first.attrs.actionDescription ?? first.attrs.description ?? ''),
    );
    const id = first.attrs.actionID
      ? `ibkr-ca-${first.attrs.actionID}`
      : contentId('ca', [type, date, description]);

    if (type === 'IC') {
      const oldIsin = oldLeg?.attrs.isin?.trim();
      const newIsin = newLeg?.attrs.isin?.trim();
      if (!oldIsin || !newIsin) {
        result.errors.push({
          line: first.line,
          message: `Změna ISIN (${first.attrs.symbol ?? ''}) nemá kompletní pár starý/nový ISIN — doplň ručně přes univerzální šablonu.`,
          raw: JSON.stringify(first.attrs),
        });
        continue;
      }
      push(first.line, first.attrs, {
        type: 'CORPORATE_ACTION',
        id,
        account: accountId || undefined,
        subtype: 'ISIN_CHANGE',
        isin: oldIsin,
        newIsin,
        date,
        note: description || undefined,
      });
      continue;
    }

    // TC — fúze/akvizice
    if (oldLeg && newLeg) {
      const oldIsin = oldLeg.attrs.isin?.trim();
      const newIsin = newLeg.attrs.isin?.trim();
      const oldQty = d(cleanNumber(oldLeg.attrs.quantity!)).abs();
      const newQty = d(cleanNumber(newLeg.attrs.quantity!));
      if (!oldIsin || !newIsin || oldQty.lte(0) || newQty.lte(0)) {
        result.errors.push({
          line: first.line,
          message: `Fúzi (${first.attrs.symbol ?? ''}) se nepodařilo přečíst — doplň ručně přes univerzální šablonu.`,
          raw: JSON.stringify(first.attrs),
        });
        continue;
      }
      // Do 13. 10. 2026 se nohy bez actionID nespárovaly a stará se uložila
      // jako PRODEJ ZA NULU (id z celého popisu nohy). U synchronizovaného
      // účtu by vedle fúze zůstal — tohle je jeho tehdejší id.
      if (!oldLeg.attrs.actionID) {
        const legacyDescription = String(
          oldLeg.attrs.actionDescription ?? oldLeg.attrs.description ?? '',
        );
        result.retracted.push({
          id: `ibkr-ca-${fnv1a64(['TC', date, legacyDescription].join('|'))}`,
          types: ['SELL'],
        });
      }
      // smíšené plnění (akcie + hotovost): hotovostní část nesmí tiše zmizet
      const cashPart = oldLeg.attrs.proceeds ? d(cleanNumber(oldLeg.attrs.proceeds)).abs() : ZERO;
      if (cashPart.gt(0)) {
        result.warnings.push({
          line: oldLeg.line,
          message: `Fúze ${first.attrs.symbol ?? oldIsin} má vedle akcií i hotovostní plnění ${cashPart.toString()} ${oldLeg.attrs.currency ?? ''} — to je zdanitelný úplatný převod, který automaticky neúčtujeme. Zadej ho jako prodej přes univerzální šablonu.`,
        });
      }
      push(first.line, first.attrs, {
        type: 'CORPORATE_ACTION',
        id,
        account: accountId || undefined,
        subtype: 'MERGER',
        isin: oldIsin,
        newIsin,
        date,
        ratio: { from: oldQty.toString(), to: newQty.toString() },
        note: description || undefined,
        // preservesAcquisitionDate necháváme na enginu (R-04b/c interpretivní warning)
      });
      continue;
    }

    if (oldLeg && !newLeg) {
      // fúze za hotovost = úplatný převod (prodej) — proceeds/value nese cenu
      const attrs = oldLeg.attrs;
      const isin = attrs.isin?.trim();
      const qty = d(cleanNumber(attrs.quantity!)).abs();
      const proceeds = attrs.proceeds ? d(cleanNumber(attrs.proceeds)).abs() : null;
      if (!isin || qty.lte(0) || !proceeds || proceeds.isZero()) {
        result.errors.push({
          line: oldLeg.line,
          message: `Fúze za hotovost (${attrs.symbol ?? ''}) nemá cenu vypořádání — zadej prodej ručně přes univerzální šablonu.`,
          raw: JSON.stringify(attrs),
        });
        continue;
      }
      result.warnings.push({
        line: oldLeg.line,
        message: `Fúze za hotovost ${attrs.symbol ?? isin}: účtujeme jako prodej za ${proceeds.toString()} ${attrs.currency ?? ''} (úplatný převod, § 10).`,
      });
      push(oldLeg.line, attrs, {
        type: 'SELL',
        id,
        account: accountId || undefined,
        isin,
        ticker: attrs.symbol || undefined,
        quantity: qty.toString(),
        pricePerShare: proceeds.div(qty).toDecimalPlaces(10).toString(),
        currency: attrs.currency,
        tradeDate: date,
        settlementDate: date,
        note: `Fúze za hotovost (TC): ${description}`,
      });
      continue;
    }

    result.errors.push({
      line: first.line,
      message: `Fúzi/akvizici (${first.attrs.symbol ?? ''}) se nepodařilo spárovat — doplň ručně přes univerzální šablonu.`,
      raw: JSON.stringify(first.attrs),
    });
  }

  if (processed === 0 && filteredLevels > 0) {
    result.errors.push({
      line: 1,
      message: `Sekce CorporateActions obsahuje jen souhrny (${filteredLevels} záznamů) — ve Flex Query zapni úroveň „Detail“, jinak se korporátní akce nenaimportují.`,
    });
  }
}

/* ── Transfers ───────────────────────────────────────────────────────────── */

function processTransfers(
  statement: Record<string, unknown>,
  accountId: string,
  result: IbkrParseOutcome,
  nextLine: () => number,
  push: PushFn,
): void {
  const rows = asArray((statement.Transfers as Record<string, unknown> | undefined)?.Transfer);
  let filteredLevels = 0;
  let processed = 0;

  for (const row of rows) {
    const line = nextLine();
    if (!isDetailRow(row)) {
      filteredLevels += 1;
      continue;
    }
    processed += 1;

    const assetCategory = (row.assetCategory || 'STK').toUpperCase();
    const cashAmount = row.cashTransfer ? d(cleanNumber(row.cashTransfer)) : null;
    // čistě hotovostní převod nemusí nést assetCategory="CASH" — pozná se
    // i podle toho, že nemá titul a má částku
    const isCashOnly = !row.isin?.trim() && !row.symbol?.trim() && cashAmount !== null && !cashAmount.eq(0);
    if (assetCategory === 'CASH' || isCashOnly) {
      const date = toIsoDate(row.date ?? row.dateTime);
      const amount = cashAmount;
      if (!date || !amount || amount.eq(0)) {
        result.skipped.push({ line, message: 'Hotovostní převod bez částky — přeskočeno.' });
        continue;
      }
      push(line, row, {
        type: amount.gt(0) ? 'DEPOSIT' : 'WITHDRAWAL',
        id: row.transactionID
          ? `ibkr-${row.transactionID}`
          : contentId('tr', ['CASH', date, amount.toString(), row.currency]),
        account: accountId || undefined,
        amount: amount.abs().toString(),
        currency: row.currency,
        date,
        note: 'Převod hotovosti mezi brokery/účty',
      });
      continue;
    }

    const isin = row.isin?.trim();
    const date = toIsoDate(row.date ?? row.dateTime);
    const quantity = row.quantity ? d(cleanNumber(row.quantity)) : null;
    const direction = String(row.direction ?? '').toUpperCase();
    if (!isin || !date || !quantity || quantity.eq(0)) {
      result.errors.push({
        line,
        message: `Převodu cenných papírů (${row.symbol ?? ''}) chybí ISIN, datum nebo množství.`,
        raw: JSON.stringify(row),
      });
      continue;
    }

    const isIncoming = direction ? direction === 'IN' : quantity.gt(0);
    const id = row.transactionID
      ? `ibkr-${row.transactionID}`
      : contentId('tr', [direction || (isIncoming ? 'IN' : 'OUT'), date, isin, quantity.toString()]);
    if (isIncoming) {
      result.warnings.push({
        line,
        message: `Příchozí převod ${row.symbol ?? isin}: IBKR nezná původní datum a cenu nabytí — doplň je v univerzální šabloně (TRANSFER_IN s acquisition), jinak počítáme cenu 0 a časový test od převodu.`,
      });
      push(line, row, {
        type: 'TRANSFER_IN',
        id,
        account: accountId || undefined,
        isin,
        quantity: quantity.abs().toString(),
        date,
        note: row.description || undefined,
      });
    } else {
      push(line, row, {
        type: 'TRANSFER_OUT',
        id,
        account: accountId || undefined,
        isin,
        quantity: quantity.abs().toString(),
        date,
        note: row.description || undefined,
      });
    }
  }

  if (processed === 0 && filteredLevels > 0) {
    result.errors.push({
      line: 1,
      message: `Sekce Transfers obsahuje jen souhrny (${filteredLevels} záznamů) — ve Flex Query zapni úroveň „Detail“, jinak se převody nenaimportují.`,
    });
  }
}

/* ── OpenPositions (rekonciliace) ────────────────────────────────────────── */

function collectOpenPositions(
  statement: Record<string, unknown>,
  result: IbkrParseOutcome,
): void {
  const rows = asArray(
    (statement.OpenPositions as Record<string, unknown> | undefined)?.OpenPosition,
  );
  for (const row of rows) {
    // SUMMARY level u pozic je žádoucí (per instrument); LOT level by zdvojil
    const level = (row.levelOfDetail ?? 'SUMMARY').toUpperCase();
    if (level === 'LOT') continue;
    // stejný klíč jako u obchodů: deriváty (opce, futures) ISIN nemají —
    // bez fallbacku na symbol by každá otevřená opce věčně hlásila nesoulad
    const key = row.isin?.trim() || row.symbol?.trim() || (row.conid ? `IBKR:${row.conid}` : '');
    // pozice bez identifikátoru či počtu kusů se nedá porovnat — tiché vynechání
    // by ale znamenalo zelené „pozice sedí“ nad neúplným srovnáním
    if (!key || !row.position) {
      result.warnings.push({
        line: 1,
        message: `Otevřená pozice „${row.description?.trim() || row.symbol?.trim() || 'bez popisu'}“ nemá ${!key ? 'ISIN, symbol ani conid' : 'počet kusů'} — do kontroly pozic proti výpisu ji nezapočítáváme. Ve Flex Query zapni u sekce Open Positions pole ISIN, Symbol, Conid a Position.`,
      });
      continue;
    }
    result.openPositions.push({
      isin: key,
      quantity: cleanNumber(row.position),
      ...(row.markPrice ? { markPrice: cleanNumber(row.markPrice) } : {}),
      ...(row.currency ? { currency: row.currency } : {}),
    });
  }
}
