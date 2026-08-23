import { XMLParser } from 'fast-xml-parser';
import { d, TransactionSchema, ZERO } from '@danero/shared';
import { cleanNumber, isValidIsoDate } from '../csv';
import { fnv1a64 } from '../dedupe';
import type { ImportResult } from '../types';

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
  for (const match of text.matchAll(/\b(\d{1,2})\/(\d{1,2})\/\d{4}\b/g)) {
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
  if (/^\d{8}$/.test(compact)) {
    return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
  }

  // MM/dd/yyyy (US) i dd/MM/yyyy — pořadí rozhoduje CELÝ dokument, ne jednotlivá
  // hodnota: „05/06/2025“ je samo o sobě nerozhodnutelné a hádat řádek po řádku
  // znamená, že v jednom souboru vyjde jednou květen a jindy červen
  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(datePart);
  if (slash) {
    const [, first, second, year] = slash;
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
      message: `Obchod ${trade.symbol ?? ''} z ${trade.tradeDate ?? ''} zároveň zavírá jednu pozici a otevírá opačnou (openCloseIndicator „${trade.openCloseIndicator}“) — kolik kusů patří na kterou stranu, výpis neuvádí. Zpracovali jsme ho jako běžný obchod; jestli šlo o prodej nakrátko, doplň ho ručně přes univerzální šablonu.`,
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
    const match = /^(\d{4})/.exec(String(value ?? ''));
    return match ? Number(match[1]) : null;
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

  const statementsWrap = response.FlexStatements as Record<string, unknown> | undefined;
  const statements = asArray(statementsWrap?.FlexStatement) as unknown as Array<
    Record<string, unknown>
  >;
  if (statements.length === 0) {
    result.errors.push({ line: 1, message: 'Flex XML neobsahuje žádný FlexStatement.' });
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

/* ── Trades ──────────────────────────────────────────────────────────────── */

function processTrades(
  statement: Record<string, unknown>,
  accountId: string,
  result: IbkrParseOutcome,
  nextLine: () => number,
  push: PushFn,
): void {
  const trades = asArray((statement.Trades as Record<string, unknown> | undefined)?.Trade);
  let filteredLevels = 0;
  let processed = 0;
  const cancellations: Array<{ line: number; attrs: Attrs }> = [];

  for (const trade of trades) {
    const line = nextLine();
    if (!isExecutionRow(trade)) {
      filteredLevels += 1;
      continue;
    }
    processed += 1;

    const assetCategory = (trade.assetCategory ?? 'STK').toUpperCase();
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
      const commission = trade.ibCommission ? d(cleanNumber(trade.ibCommission)).abs() : ZERO;
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

      push(line, trade, {
        type: buySell,
        id: id
          ? `ibkr-${id}`
          : contentId('trade', [buySell, tradeDate, key, quantity.toString(), String(price)]),
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
        ...(commission.gt(0)
          ? { fee: { amount: commission.toString(), currency: trade.ibCommissionCurrency || trade.currency } }
          : {}),
        tradeDate,
        ...(toIsoDate(trade.settleDateTarget) ? { settlementDate: toIsoDate(trade.settleDateTarget) } : {}),
        ...(noteCodes.has('Ep') ? { note: 'Expirace opce (uzavření za 0)' } : {}),
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

    // dluhopisy IBKR kotuje v procentech nominálu — jediná spolehlivá cena je
    // z proceeds (skutečné plnění); bez něj radši viditelná chyba než 100× výdaj
    let pricePerShare = cleanNumber(price);
    if (assetCategory === 'BOND') {
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

    const commission = trade.ibCommission ? d(cleanNumber(trade.ibCommission)).abs() : ZERO;
    const settlement = toIsoDate(trade.settleDateTarget);
    const id = trade.tradeID || trade.transactionID;
    // R-13 se týká jen spotových obchodů — u derivátů (výše) se značka
    // nepoužívá, takže se tady ani nepočítá a varování o „C;O“ nepadá na
    // rolování opce, se kterým short nemá nic společného
    const positionEffect = shortPositionEffect(trade, buySell, line, result);

    push(line, trade, {
      type: buySell,
      ...(positionEffect ? { positionEffect } : {}),
      id: id
        ? `ibkr-${id}`
        : contentId('trade', [buySell, tradeDate, isin, quantity.toString(), pricePerShare]),
      account: accountId || undefined,
      isin,
      ticker: trade.symbol || undefined,
      name: trade.description || undefined,
      assetClass: assetCategory === 'BOND' ? 'BOND' : assetCategory === 'FUND' ? 'ETF' : 'STOCK',
      quantity: quantity.abs().toString(),
      pricePerShare,
      currency: trade.currency,
      ...(commission.gt(0)
        ? { fee: { amount: commission.toString(), currency: trade.ibCommissionCurrency || trade.currency } }
        : {}),
      tradeDate,
      ...(settlement ? { settlementDate: settlement } : {}),
    });
  }

  // storna: odstranit i původní exekuci (jinak by v DB zůstal zrušený obchod)
  for (const cancellation of cancellations) {
    const attrs = cancellation.attrs;
    const originalId = attrs.origTradeID ? `ibkr-${attrs.origTradeID}` : null;
    const index = originalId
      ? result.transactions.findIndex((tx) => tx.id === originalId)
      : -1;
    if (index >= 0) {
      result.transactions.splice(index, 1);
      result.warnings.push({
        line: cancellation.line,
        message: `Stornovaný obchod ${attrs.symbol ?? ''} (${attrs.origTradeID}) — originál i storno vynechány, opravný obchod je ve výpisu samostatně.`,
      });
    } else {
      result.errors.push({
        line: cancellation.line,
        message: `Storno obchodu ${attrs.symbol ?? ''} se nepodařilo spárovat s originálem${attrs.origTradeID ? ` (tradeID ${attrs.origTradeID})` : ''} — zkontroluj, že výpis pokrývá i původní obchod, jinak oprav ručně.`,
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
        push(line, row, {
          type: 'INTEREST',
          id,
          account: accountId || undefined,
          amount: amount.toString(),
          currency: row.currency,
          date,
          note: row.description || undefined,
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
      if (netGross.lte(0)) {
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

  // IC/TC chodí v párech (staré isin záporně, nové kladně) — grupujeme přes
  // actionID, případně popis+datum
  const pairGroups = new Map<string, Array<{ line: number; attrs: Attrs }>>();

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
        const isin = row.isin?.trim();
        const ratio = parseForRatio(description);
        if (!isin || !ratio) {
          result.errors.push({
            line,
            message: `Split ${row.symbol ?? ''} se nepodařilo přečíst (chybí ISIN nebo poměr „X FOR Y“ v popisu).`,
            raw: JSON.stringify(row),
          });
          break;
        }
        push(line, row, {
          type: 'CORPORATE_ACTION',
          id,
          account: accountId || undefined,
          subtype: 'SPLIT',
          isin,
          date,
          ratio,
          note: description || undefined,
        });
        break;
      }
      case 'IC':
      case 'TC': {
        const key = row.actionID ? `${type}-${row.actionID}` : `${type}-${description}-${date}`;
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

  // párové akce: IC → ISIN_CHANGE, TC → MERGER (stock-for-stock) / SELL (cash)
  for (const [key, group] of pairGroups) {
    const type = key.startsWith('IC') ? 'IC' : 'TC';
    const oldLeg = group.find((g) => d(cleanNumber(g.attrs.quantity || '0')).lt(0));
    const newLeg = group.find((g) => d(cleanNumber(g.attrs.quantity || '0')).gt(0));
    const first = group[0]!;
    const date = toIsoDate(first.attrs.dateTime ?? first.attrs.reportDate)!;
    const description = String(first.attrs.actionDescription ?? first.attrs.description ?? '');
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
      if (!isin || qty.lte(0) || !proceeds) {
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

    const assetCategory = (row.assetCategory ?? 'STK').toUpperCase();
    if (assetCategory === 'CASH') {
      const date = toIsoDate(row.date ?? row.dateTime);
      const amount = row.cashTransfer ? d(cleanNumber(row.cashTransfer)) : null;
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
