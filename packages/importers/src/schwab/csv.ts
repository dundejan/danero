import { d, Decimal, TransactionSchema } from '@danero/shared';
import { cleanNumber, HeaderMap, parseCsv, parseUsDate } from '../csv';
import { fnv1a64 } from '../dedupe';
import { emptyResult, type ImportResult, type IsinInstrumentMap } from '../types';

// re-export: testy i tastytrade parser čtou parseUsDate odsud
export { parseUsDate } from '../csv';

export const SCHWAB_BROKER = 'schwab';

/** Sloupec měny v exportu neexistuje — brokerage výpisy Schwabu jsou vždy v USD. */
const USD = 'USD';

/**
 * Výpis Charles Schwab neobsahuje ISIN (jen Symbol) — dodává ho mapování
 * symbolů (vzor XTB/Revolut). BUY/SELL akcií bez mapování se neimportuje
 * a symbol skončí v `unmappedSymbols`; dividendy mapování nepotřebují
 * (ISIN je u nich optional) a opce mají vlastní stabilní identifikátor
 * `OPT:…` — mapování se na ně nevztahuje.
 */
export type SchwabInstrumentMap = IsinInstrumentMap;


/**
 * Peněžní/číselná hodnota Schwabu: „$261.50“, „-$3,320.05“ (minus PŘED
 * dolarem), tisícové čárky, holá čísla („45“, „0.0249“). Prázdno a „--“
 * = hodnota chybí (null).
 */
function parseSchwabNumber(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === '' || trimmed === '--') return null;
  const digits = trimmed.replace(/[$,]/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(digits)) return null;
  return digits;
}

/** Opční symbol Schwabu: „SPY 03/31/2020 284.00 P“ (podklad, expirace, strike, C/P). */
const OPTION_SYMBOL_RE = /^\S+ \d{2}\/\d{2}\/\d{4} [\d.]+ [CP]$/;

/** Stabilní identifikátor opce: mezery → pomlčky („OPT:SPY-03/31/2020-284.00-P“). */
const optionIsin = (symbol: string): string => `OPT:${symbol.replace(/\s+/g, '-')}`;

/* ── Slovník Action (case-sensitive, hodnoty doslova z reálných exportů) ─── */

const BUY_ACTIONS = new Set(['Buy', 'Buy to Open', 'Buy to Close', 'Reinvest Shares']);
const SELL_ACTIONS = new Set(['Sell', 'Sell to Open', 'Sell to Close']);

/**
 * Prodej nakrátko na spotu. NEIMPORTUJEME ho jako běžný obchod, i když by to
 * bylo snadné: prodej bez předchozího nákupu engine ocení nulou (ERROR
 * NEGATIVE_POSITION v ledger.ts) a zdanil by se CELÝ výnos shortu, zpětný
 * nákup by pak zůstal jako lot, který se nikdy neprodá.
 *
 * ⚠️ Důvod skipu NENÍ chybějící pravidlo — R-13 v docs/02 existuje a engine ho
 * počítá (do 31. 8. 2026 tu i v hlášce uživateli stálo opačně). Skutečný důvod
 * je, že short se podle R-13 pozná VÝHRADNĚ podle značky `positionEffect`
 * z parseru, a Schwab ji ve svém exportu nemá: v reálných datech uzavírá short
 * obyčejným `Buy`, který od běžného nákupu nerozeznáme. Označit jen otevírací
 * nohu („Sell Short“) by tedy shortu nechalo v enginu navždy otevřenou pozici,
 * což je horší než řádek přeskočit a říct to nahlas.
 */
const SHORT_ACTIONS = new Map<string, string>([
  ['Sell Short', 'prodej nakrátko'],
  ['Buy to Cover', 'zpětný nákup k pokrytí shortu'],
]);

/**
 * Zánik opce bez ceny (uzavření za 0). „Expired“ tu bylo od začátku, assignment
 * a exercise končily „neznámým typem“ — akciová noha se přitom naimportovala,
 * takže short opce zůstala v enginu otevřená napořád (Tastytrade parser tytéž
 * události řeší, viz REMOVAL_SUBTYPES).
 */
const OPTION_REMOVAL_ACTIONS = new Map<string, string>([
  ['Expired', 'Expirace opce (uzavření za 0)'],
  ['Assigned', 'Assignment — zánik opce uplatněním (uzavření za 0)'],
  ['Exercised', 'Exercise — zánik opce uplatněním (uzavření za 0)'],
]);

const DIVIDEND_ACTIONS = new Set([
  'Qualified Dividend',
  'Non-Qualified Div',
  'Cash Dividend',
  'Special Dividend',
  'Special Qual Div',
  'Special Non Qual Div',
  'Qual Div Reinvest',
  'Reinvest Dividend',
  'Pr Yr Special Div',
  'Pr Yr Cash Div',
  'Pr Yr Div Reinvest',
  'Pr Yr Non Qual Div',
  'Pr Yr Non-Qual Div',
  'Div Adjustment',
]);

/**
 * Srážková daň = samostatné záporné řádky — k dividendám (a k úrokům, viz
 * `INTEREST_TAX_MARK`) se párují druhým průchodem.
 *
 * „NRA Withhold“ je novější zápis téže události jako „NRA Withholding“
 * (L2b-01): bez něj řádek skončil „neznámým typem“ a dividenda se uložila se
 * srážkou 0, takže zápočet podle R-07c chyběl celý.
 */
const WITHHOLDING_ACTIONS = new Set([
  'NRA Tax Adj',
  'NRA Withhold',
  'NRA Withholding',
  'Foreign Tax Paid',
  'IRS Withhold Adj',
]);

const INTEREST_ACTIONS = new Set(['Bank Interest', 'Credit Interest', 'Bond Interest', 'Interest Adj']);

/**
 * L2b-07: daň sražená z ÚROKU chodí pod stejnými akcemi jako srážka
 * z dividendy, jen bez symbolu a s popisem úroku z hotovosti („SCHWAB1 INT
 * 05/16-06/15“). Patří k úroku téhož dne (R-07f), ne k dividendě.
 */
const INTEREST_TAX_MARK = 'SCHWAB1 INT';

/**
 * L2b-02: připsání akcií ze zaměstnaneckého plánu (RSU/ESPP) na brokerage
 * účet. S kusy je to nabytí, které výpočtu chybí — viz větev v parseru.
 */
const STOCK_PLAN_ACTION = 'Stock Plan Activity';

const FEE_ACTIONS = new Set(['Advisor Fee', 'Service Fee', 'ADR Mgmt Fee']);

const SPLIT_WARNING = 'výpis neuvádí poměr splitu — doplň korporátní akci přes univerzální šablonu';
const CORPORATE_WARNING =
  'korporátní akce bez strojově čitelných detailů — doplň ji přes univerzální šablonu, jinak nemusí sedět držené kusy';
const CAPGAIN_WARNING =
  'kapitálová distribuce fondu — zatím ji nezařazujeme; pokud je daňově relevantní, doplň ji přes univerzální šablonu';
const OTHER_WARNING =
  'řádek zatím neumíme automaticky zařadit — pokud je daňově relevantní, doplň ho přes univerzální šablonu';

/** Akce vědomě přeskočené S varováním — uživatel o nich musí vědět. */
const WARN_SKIP_ACTIONS: Record<string, string> = {
  'Stock Split': SPLIT_WARNING,
  'Reverse Split': SPLIT_WARNING,
  'Stock Div Dist': SPLIT_WARNING,
  'Name Change': CORPORATE_WARNING,
  Conversion: CORPORATE_WARNING,
  'Stock Merger': CORPORATE_WARNING,
  'Cash Merger': CORPORATE_WARNING,
  'Cash Merger Adj': CORPORATE_WARNING,
  'Cash In Lieu': CORPORATE_WARNING,
  'Long Term Cap Gain': CAPGAIN_WARNING,
  'Short Term Cap Gain': CAPGAIN_WARNING,
  'Long Term Cap Gain Reinvest': CAPGAIN_WARNING,
  'Short Term Cap Gain Reinvest': CAPGAIN_WARNING,
  'Promotional Award': OTHER_WARNING,
  [STOCK_PLAN_ACTION]: OTHER_WARNING,
  Adjustment: OTHER_WARNING,
  'Misc Cash Entry': OTHER_WARNING,
  'Full Redemption': OTHER_WARNING,
  'Full Redemption Adj': OTHER_WARNING,
  'Cancel Buy': OTHER_WARNING,
  'Reinvestment Adj': OTHER_WARNING,
  'Misc Credits': OTHER_WARNING,
};

/**
 * Peněžní převody — pro daňový výpočet nejsou potřeba, skip bez varování.
 *
 * POZOR: část těchhle akcí umí přesouvat i KUSY, ne jen peníze („Journaled
 * Shares" je běžný řádek migrace TDA → Schwab, „Security Transfer" převod mezi
 * účty). Rozhoduje se proto podle obsahu řádku, ne podle názvu akce — viz
 * `movesShares` níž (nález B-3-9).
 */
const SILENT_SKIP_ACTIONS = new Set([
  'Journal',
  'Journaled Shares',
  'MoneyLink Transfer',
  'MoneyLink Deposit',
  'MoneyLink Adj',
  'Wire Sent',
  'Wire Funds',
  'Wire Funds Received',
  'Wire Received',
  'Wire Funds Adj',
  'Funds Received',
  'Funds Paid',
  'Internal Transfer',
  'Security Transfer',
  'Bank Transfer',
  'Visa Purchase',
  'Returned Check',
  'Auto S1 Debit/Credit',
]);

/** Párování srážky k dividendě: stejný symbol, nejbližší datum do ±5 dní. */
const TAX_MATCH_MAX_DAYS = 5;

const dayDistance = (a: string, b: string): number =>
  Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;

/**
 * Autodetekce Schwab exportu: v prvních třech řádcích je řádek obsahující
 * „Action“ i „Fees & Comm“ (starší exporty mají před hlavičkou titulní řádek).
 * Bankovní (šekový) export Schwabu má místo toho „Type“/„Check #“ → false.
 */
export function sniffSchwabCsv(text: string): boolean {
  if (text.trim() === '') return false;
  const lines = text.split(/\r?\n/).slice(0, 3);
  return lines.some((line) => line.includes('Action') && line.includes('Fees & Comm'));
}

/**
 * Parser exportu transakcí Charles Schwab (brokerage účet; CSV s čárkou,
 * pole v uvozovkách, výhradně USD). Pořadí sloupců se mezi exporty LIŠÍ →
 * mapování výhradně podle názvů. Starší exporty mají titulní řádek před
 * hlavičkou, koncovou čárku (prázdný 9. sloupec) a footer „Transactions
 * Total“ — vše se toleruje/přeskakuje. Srážková daň z dividend jsou
 * samostatné záporné řádky → párují se druhým průchodem (symbol + nejbližší
 * datum do ±5 dní); srážka z úroku se páruje na úrok téhož dne.
 */
export function parseSchwabCsv(
  text: string,
  instrumentMap: SchwabInstrumentMap = {},
): ImportResult & { unmappedSymbols: string[] } {
  const result = { ...emptyResult(SCHWAB_BROKER), unmappedSymbols: [] as string[] };
  // prázdný soubor = prázdné období, ne chyba formátu (konzistentně s T212)
  if (text.trim() === '') return result;

  // titulní řádek starších exportů je PŘED hlavičkou → hlavičku hledáme obsahem
  const table = parseCsv(text);
  const allRows = [table.headers, ...table.rows];
  let headerIndex = -1;
  for (let i = 0; i < Math.min(3, allRows.length); i += 1) {
    const cells = allRows[i]!.map((cell) => cell.trim());
    if (cells.includes('Action') && cells.includes('Fees & Comm')) {
      headerIndex = i;
      break;
    }
  }
  if (headerIndex === -1) {
    const looksLikeBank = allRows
      .slice(0, 3)
      .some((row) => row.map((cell) => cell.trim()).includes('Check #'));
    result.errors.push({
      line: 1,
      message: looksLikeBank
        ? 'Tohle je výpis z bankovního (šekového) účtu Schwab — pro daně nahraj export transakcí z investičního (brokerage) účtu (Accounts → History → Export).'
        : 'Soubor nevypadá jako Schwab export transakcí — v prvních řádcích chybí hlavička se sloupci „Action“ a „Fees & Comm“.',
    });
    return result;
  }

  const map = new HeaderMap(allRows[headerIndex]!.map((cell) => cell.trim()));
  const missing = ['Date', 'Symbol', 'Quantity', 'Price', 'Amount'].filter(
    (name) => !map.has(name),
  );
  if (missing.length > 0) {
    result.errors.push({
      line: headerIndex + 1,
      message: `V hlavičce exportu chybí sloupce: ${missing.join(', ')} — bez nich export nejde zpracovat.`,
    });
    return result;
  }

  // stabilní obsahová id; identické legitimní řádky rozliší suffix -2, -3…
  const idOccurrences = new Map<string, number>();
  const nextId = (row: string[]): string => {
    const base = `schwab-${fnv1a64(row.join('|'))}`;
    const count = (idOccurrences.get(base) ?? 0) + 1;
    idOccurrences.set(base, count);
    return count === 1 ? base : `${base}-${count}`;
  };

  const push = (line: number, raw: string, candidate: Record<string, unknown>): void => {
    try {
      result.transactions.push(TransactionSchema.parse(candidate));
    } catch (err) {
      result.errors.push({
        line,
        message: `Řádek se nepodařilo zpracovat: ${err instanceof Error ? err.message : String(err)}`,
        raw,
      });
    }
  };

  const unmapped = new Set<string>();
  /** ISIN z mapování pro BUY/SELL akcií; bez něj obchod neemitujeme — JEDEN error per symbol. */
  const requireIsin = (symbol: string, line: number): string | null => {
    const instrument = instrumentMap[symbol];
    if (instrument) return instrument.isin;
    if (!unmapped.has(symbol)) {
      unmapped.add(symbol);
      result.errors.push({
        line,
        message: `Symbol ${symbol}: doplň ISIN instrumentu (Schwab ho neexportuje).`,
      });
    }
    return null;
  };

  const feeOf = (row: string[]): { amount: string; currency: string } | undefined => {
    const feeRaw = parseSchwabNumber(map.get(row, 'Fees & Comm'));
    if (feeRaw === null) return undefined;
    const fee = d(feeRaw).abs();
    return fee.gt(0) ? { amount: fee.toString(), currency: USD } : undefined;
  };

  // dividenda a její srážková daň jsou samostatné řádky → párování druhým průchodem
  interface PendingDividend {
    line: number;
    raw: string;
    id: string;
    symbol: string;
    date: string;
    gross: string;
    isin?: string;
    withholding?: string;
  }
  /** Úrok čeká na konec souboru ze stejného důvodu: jeho srážka je jiný řádek (L2b-07). */
  interface PendingInterest {
    line: number;
    raw: string;
    id: string;
    date: string;
    amount: string;
    description: string;
    note: string;
    withholding?: string;
  }
  interface PendingTax {
    line: number;
    symbol: string;
    date: string;
    description: string;
    /** Kladná = sražená daň, záporná = vratka (B-3-11). */
    amount: string;
  }
  const dividends: PendingDividend[] = [];
  const interests: PendingInterest[] = [];
  const taxes: PendingTax[] = [];
  const interestTaxes: PendingTax[] = [];

  for (let i = headerIndex + 1; i < allRows.length; i += 1) {
    const row = allRows[i]!;
    const line = i + 1; // pole allRows kopíruje řádky souboru od 1
    if (row.every((cell) => cell.trim() === '')) continue;
    // footer starších exportů — strukturní řádek, ne transakce
    if (row.some((cell) => cell.trim().startsWith('Transactions Total'))) continue;

    const raw = row.join(',');
    const action = map.get(row, 'Action');
    if (action === '') {
      result.errors.push({ line, message: 'Řádek nemá vyplněný sloupec Action — nejde zpracovat.', raw });
      continue;
    }

    if (SILENT_SKIP_ACTIONS.has(action)) {
      const symbol = map.get(row, 'Symbol');
      const quantity = cleanNumber(map.get(row, 'Quantity'));
      // B-3-9: převod KUSŮ se nesmí ztratit mezi peněžními převody. Bez něj
      // narazí pozdější prodej na „prodáno víc, než je evidováno“ → nabývací
      // cena 0 Kč a bez časového testu, tedy maximálně nadhodnocený zisk.
      // A protože UI u `skipped` ukazuje jen počet (texty ne), musí to být
      // varování — jinak se to uživatel nedozví vůbec.
      if (quantity !== '' && Number(quantity) !== 0) {
        result.warnings.push({
          line,
          message:
            `„${action}“${symbol ? ` (${symbol})` : ''}: přesun ${quantity} ks mezi účty — výpis neuvádí, odkud a za kolik. ` +
            'Doplň ho jako TRANSFER_IN (s původním datem a cenou nákupu) nebo TRANSFER_OUT přes univerzální šablonu, ' +
            'jinak se prodej těchto kusů spočítá s nulovou nabývací cenou a bez časového testu.',
        });
        continue;
      }
      result.skipped.push({ line, message: `„${action}“: peněžní převod — pro daňový výpočet není potřeba.` });
      continue;
    }
    const warnSkip = WARN_SKIP_ACTIONS[action];
    if (warnSkip !== undefined) {
      const symbol = map.get(row, 'Symbol');
      // L2b-02: s kusy je to nabytí akcií, ne řádek „možná daňově relevantní“.
      // Bez něj narazí pozdější prodej na nulovou nabývací cenu stejně jako
      // u převodu kusů výš (B-3-9). Text ZÁMĚRNĚ neříká, jakou cenu zadat:
      // pravidlo pro akcie ze zaměstnaneckého plánu v docs/02 není.
      const granted =
        action === STOCK_PLAN_ACTION ? parseSchwabNumber(map.get(row, 'Quantity')) : null;
      if (granted !== null && d(granted).gt(0)) {
        result.warnings.push({
          line,
          message:
            `„${action}“${symbol ? ` (${symbol})` : ''}: připsání ${granted} ks ze zaměstnaneckého akciového plánu jsme do evidence nezařadili. ` +
            'Doplň jejich nabytí přes univerzální šablonu, jinak se prodej těchto kusů spočítá s nulovou nabývací cenou a bez časového testu.',
        });
        continue;
      }
      result.warnings.push({
        line,
        message: `„${action}“${symbol ? ` (${symbol})` : ''}: ${warnSkip}. Řádek přeskočen.`,
      });
      continue;
    }

    const date = parseUsDate(map.get(row, 'Date'));
    if (!date) {
      result.errors.push({
        line,
        message: `Neplatné datum „${map.get(row, 'Date')}“ (očekáván US formát MM/DD/YYYY).`,
        raw,
      });
      continue;
    }

    const symbol = map.get(row, 'Symbol');
    const description = map.get(row, 'Description');

    const shortAction = SHORT_ACTIONS.get(action);
    if (shortAction !== undefined) {
      result.warnings.push({
        line,
        message: `${symbol || 'Řádek'}: ${shortAction} („${action}“) jsme přeskočili. Prodej nakrátko počítat umíme, ale potřebujeme u obou nohou vědět, která short otevírá a která zavírá — a Schwab to ve výpisu neuvádí: zpětný nákup posílá jako obyčejný „Buy“, který od běžného nákupu nerozeznáme. Zapiš celý obchod (prodej i zpětný nákup) přes univerzální šablonu se sloupcem position_effect, nebo nám napiš; přeskočený řádek nic nezdvojí.`,
      });
      continue;
    }

    if (BUY_ACTIONS.has(action) || SELL_ACTIONS.has(action)) {
      const type = BUY_ACTIONS.has(action) ? 'BUY' : 'SELL';
      if (symbol === '') {
        result.errors.push({ line, message: `${action}: chybí symbol instrumentu.`, raw });
        continue;
      }
      const quantityRaw = parseSchwabNumber(map.get(row, 'Quantity'));
      const quantity = quantityRaw === null ? null : d(quantityRaw).abs();
      if (!quantity || quantity.lte(0)) {
        result.errors.push({
          line,
          message: `${action} ${symbol}: chybí kladný počet kusů (Quantity „${map.get(row, 'Quantity')}“).`,
          raw,
        });
        continue;
      }
      const priceRaw = parseSchwabNumber(map.get(row, 'Price'));
      if (priceRaw === null || d(priceRaw).lt(0)) {
        result.errors.push({
          line,
          message: `${action} ${symbol}: chybí cena (Price „${map.get(row, 'Price')}“).`,
          raw,
        });
        continue;
      }
      if (OPTION_SYMBOL_RE.test(symbol)) {
        // R-12: opce = derivát s prémiovým vypořádáním; cena za KONTRAKT = Price × 100
        push(line, raw, {
          type,
          id: nextId(row),
          isin: optionIsin(symbol),
          ticker: symbol.split(' ')[0],
          name: description || undefined,
          assetClass: 'DERIVATIVE',
          settlementStyle: 'PREMIUM',
          quantity: quantity.toString(),
          pricePerShare: d(priceRaw).mul(100).toString(),
          currency: USD,
          fee: feeOf(row),
          tradeDate: date,
        });
        continue;
      }
      const isin = requireIsin(symbol, line);
      if (isin === null) continue; // error per symbol už je nahlášený
      push(line, raw, {
        type,
        id: nextId(row),
        isin,
        ticker: symbol,
        name: description || undefined,
        quantity: quantity.toString(),
        pricePerShare: priceRaw,
        currency: USD,
        fee: feeOf(row),
        tradeDate: date,
        ...(action === 'Reinvest Shares' ? { note: 'reinvestice dividendy (Reinvest Shares)' } : {}),
      });
      continue;
    }

    const removalNote = OPTION_REMOVAL_ACTIONS.get(action);
    if (removalNote !== undefined) {
      if (!OPTION_SYMBOL_RE.test(symbol)) {
        result.warnings.push({
          line,
          message: `„${action}“ u ${symbol || 'řádku bez symbolu'} nevypadá jako opce — řádek přeskočen; případně ho doplň přes univerzální šablonu.`,
        });
        continue;
      }
      const quantityRaw = parseSchwabNumber(map.get(row, 'Quantity'));
      const quantity = quantityRaw === null ? null : d(quantityRaw);
      if (!quantity || quantity.eq(0)) {
        result.errors.push({
          line,
          message: `${action} ${symbol}: chybí počet kontraktů (Quantity „${map.get(row, 'Quantity')}“).`,
          raw,
        });
        continue;
      }
      // R-12i: expirace = uzavření opce za 0; záporný počet = odpis long pozice
      // (SELL), kladný počet = pokrytí short pozice (BUY)
      push(line, raw, {
        type: quantity.lt(0) ? 'SELL' : 'BUY',
        id: nextId(row),
        isin: optionIsin(symbol),
        ticker: symbol.split(' ')[0],
        name: description || undefined,
        assetClass: 'DERIVATIVE',
        settlementStyle: 'PREMIUM',
        quantity: quantity.abs().toString(),
        pricePerShare: '0',
        currency: USD,
        fee: feeOf(row),
        tradeDate: date,
        note: removalNote,
      });
      continue;
    }

    if (DIVIDEND_ACTIONS.has(action)) {
      const amountRaw = parseSchwabNumber(map.get(row, 'Amount'));
      if (amountRaw === null) {
        result.errors.push({
          line,
          message: `Dividenda ${symbol || 'bez symbolu'}: chybí částka (Amount „${map.get(row, 'Amount')}“).`,
          raw,
        });
        continue;
      }
      const amount = d(amountRaw);
      if (amount.lte(0)) {
        result.warnings.push({
          line,
          message: `Záporná/nulová dividenda ${amountRaw} USD („${action}“ ${symbol}) — vypadá jako korekce, nezaúčtováno; zkontroluj výpis.`,
        });
        continue;
      }
      dividends.push({
        line,
        raw,
        id: nextId(row),
        symbol,
        date,
        gross: amount.toString(),
        isin: instrumentMap[symbol]?.isin,
      });
      continue;
    }

    if (WITHHOLDING_ACTIONS.has(action)) {
      const amountRaw = parseSchwabNumber(map.get(row, 'Amount'));
      if (amountRaw === null) {
        result.errors.push({
          line,
          message: `Srážková daň („${action}“ ${symbol}): chybí částka (Amount).`,
          raw,
        });
        continue;
      }
      // B-3-11: znaménko rozhoduje. Srážka přichází jako ZÁPORNÁ částka
      // (peníze odešly), kladný `NRA Tax Adj` je naopak VRATKA přeplatku.
      // `.abs()` z ní dělalo další srážku, takže se zápočet nadhodnotil
      // a česká daň vyšla nižší — nejhorší možný směr chyby.
      const signed = d(amountRaw);
      if (signed.isZero()) {
        result.warnings.push({
          line,
          message: `Srážková daň („${action}“ ${symbol}) má nulovou částku — nezaúčtováno.`,
        });
        continue;
      }
      const ofInterest = symbol === '' && description.includes(INTEREST_TAX_MARK);
      (ofInterest ? interestTaxes : taxes).push({
        line,
        symbol,
        date,
        description,
        amount: signed.neg().toString(),
      });
      continue;
    }

    if (action === 'Margin Interest') {
      result.skipped.push({
        line,
        message: '„Margin Interest“: úrok z marginu je náklad — do daňového výpočtu ho nezařazujeme.',
      });
      continue;
    }

    if (INTEREST_ACTIONS.has(action)) {
      const amountRaw = parseSchwabNumber(map.get(row, 'Amount'));
      if (amountRaw === null) {
        result.errors.push({ line, message: `${action}: chybí částka úroku (Amount).`, raw });
        continue;
      }
      if (d(amountRaw).lte(0)) {
        result.warnings.push({
          line,
          message: `Záporný/nulový úrok ${amountRaw} USD („${action}“) — vypadá jako korekce, nezaúčtováno; zkontroluj výpis.`,
        });
        continue;
      }
      interests.push({
        line,
        raw,
        id: nextId(row),
        date,
        amount: amountRaw,
        description,
        note: description || action,
      });
      continue;
    }

    if (FEE_ACTIONS.has(action)) {
      const amountRaw = parseSchwabNumber(map.get(row, 'Amount'));
      if (amountRaw === null) {
        result.errors.push({ line, message: `${action}: chybí částka poplatku (Amount).`, raw });
        continue;
      }
      push(line, raw, {
        type: 'FEE',
        id: nextId(row),
        amount: d(amountRaw).abs().toString(),
        currency: USD,
        date,
        note: description || action,
      });
      continue;
    }

    if (action === 'Spin-off') {
      if (symbol === '') {
        result.errors.push({ line, message: 'Spin-off: chybí symbol nového instrumentu.', raw });
        continue;
      }
      const quantityRaw = parseSchwabNumber(map.get(row, 'Quantity'));
      const quantity = quantityRaw === null ? null : d(quantityRaw).abs();
      if (!quantity || quantity.lte(0)) {
        result.errors.push({
          line,
          message: `Spin-off ${symbol}: chybí počet připsaných kusů (Quantity).`,
          raw,
        });
        continue;
      }
      const isin = requireIsin(symbol, line);
      if (isin === null) continue;
      push(line, raw, {
        type: 'BUY',
        id: nextId(row),
        isin,
        ticker: symbol,
        name: description || undefined,
        quantity: quantity.toString(),
        pricePerShare: '0',
        currency: USD,
        tradeDate: date,
        note: 'spin-off — příjem kusů s cenou 0',
      });
      continue;
    }

    result.errors.push({
      line,
      message: `Neznámý typ řádku „${action}“ — nahlaš nám ho, doplníme podporu.`,
      raw,
    });
  }

  // párování srážek: stejný symbol, nejbližší datum (±5 dní), dividenda bez srážky
  const nearest = (tax: PendingTax, accept: (dividend: PendingDividend) => boolean) => {
    let best: PendingDividend | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const dividend of dividends) {
      if (dividend.symbol !== tax.symbol || !accept(dividend)) continue;
      const distance = dayDistance(dividend.date, tax.date);
      if (distance < bestDistance) {
        best = dividend;
        bestDistance = distance;
      }
    }
    return bestDistance > TAX_MATCH_MAX_DAYS ? null : best;
  };

  // L2b-07: srážka z úroku patří k úroku téhož dne; při víc úrocích v jednom
  // dni rozhodne shodný popis (období, za které se úrok připsal). Mezi stejně
  // dobrými má přednost úrok, který srážku ještě nemá — dva shodné úroky se
  // dvěma srážkami tak dostanou každý svou (A03-R1-01).
  const interestOfDay = (tax: PendingTax, accept: (interest: PendingInterest) => boolean) => {
    const sameDay = interests.filter((interest) => interest.date === tax.date && accept(interest));
    const sameText = sameDay.filter((interest) => interest.description === tax.description);
    const candidates = sameText.length > 0 ? sameText : sameDay;
    return candidates.find((interest) => interest.withholding === undefined) ?? candidates[0] ?? null;
  };

  /**
   * Přiřazení srážek k příjmům, společné pro dividendy i úroky. Nejdřív
   * skutečné srážky, teprve pak vratky — vratka musí mít co snižovat (B-3-11:
   * vratka přeplatku snižuje už zaúčtovanou srážku, nezakládá novou).
   *
   * `stacking` říká, jestli smí jeden příjem nést víc srážkových řádků
   * (A03-R1-01). U úroku ano: cíl je jednoznačný dnem a popisem, takže se
   * srážka a její doúčtování sečtou. U dividendy ne — cíl se hledá v okně
   * několika dní a druhý řádek může patřit jiné výplatě téhož titulu.
   */
  const settleTaxes = <T extends { withholding?: string }>(
    pending: PendingTax[],
    target: (tax: PendingTax, accept: (item: T) => boolean) => T | null,
    stacking: boolean,
    texts: {
      orphanTax: (tax: PendingTax) => string;
      orphanRefund: (tax: PendingTax, refund: string) => string;
      excessRefund: (tax: PendingTax, refund: string, item: T) => string;
    },
  ): void => {
    for (const tax of pending.filter((t) => d(t.amount).gt(0))) {
      const best = target(tax, (item) => stacking || item.withholding === undefined);
      if (!best) {
        result.warnings.push({ line: tax.line, message: texts.orphanTax(tax) });
        continue;
      }
      best.withholding = d(best.withholding ?? '0').plus(tax.amount).toString();
    }
    for (const tax of pending.filter((t) => d(t.amount).lt(0))) {
      const refund = d(tax.amount).abs();
      const best = target(tax, (item) => d(item.withholding ?? '0').gt(0));
      if (!best) {
        result.warnings.push({ line: tax.line, message: texts.orphanRefund(tax, refund.toString()) });
        continue;
      }
      const remaining = d(best.withholding ?? '0').minus(refund);
      if (remaining.isNegative()) {
        result.warnings.push({
          line: tax.line,
          message: texts.excessRefund(tax, refund.toString(), best),
        });
      }
      best.withholding = Decimal.max(remaining, d('0')).toString();
    }
  };

  settleTaxes(taxes, nearest, false, {
    orphanTax: (tax) =>
      `Srážková daň ${tax.amount} USD (${tax.symbol || 'bez symbolu'}, ${tax.date}) nemá dohledatelnou dividendu — přiřaď ji přes univerzální šablonu.`,
    orphanRefund: (tax, refund) =>
      `Vratka srážkové daně ${refund} USD (${tax.symbol || 'bez symbolu'}, ${tax.date}) nemá k čemu se přiřadit — u téhle dividendy žádnou sraženou daň neevidujeme. Zkontroluj výpis, jinak bude zápočet nadhodnocený.`,
    excessRefund: (tax, refund, dividend) =>
      `Vratka srážkové daně ${refund} USD (${tax.symbol}, ${tax.date}) je vyšší než sražená daň ${dividend.withholding} USD u dividendy z ${dividend.date} — započítali jsme ji jen do nuly. Zkontroluj výpis.`,
  });
  // Rada „doplň šablonou“ tu záměrně není: úrok doplněný ručně by se s týmž
  // úrokem z pozdějšího výpisu Schwabu nespojil (klíč nese brokera) a uložil
  // by se dvakrát.
  settleTaxes(interestTaxes, interestOfDay, true, {
    orphanTax: (tax) =>
      `Srážková daň z úroku ${tax.amount} USD (${tax.date}) nemá ve výpisu úrok ze stejného dne, ke kterému by patřila — nezaúčtováno. Zkontroluj, jestli výpis pokrývá období toho úroku.`,
    orphanRefund: (tax, refund) =>
      `Vratka srážkové daně z úroku ${refund} USD (${tax.date}) nemá k čemu se přiřadit — u úroku ze stejného dne žádnou sraženou daň neevidujeme. Zkontroluj výpis.`,
    excessRefund: (tax, refund, interest) =>
      `Vratka srážkové daně z úroku ${refund} USD (${tax.date}) je vyšší než sražená daň ${interest.withholding} USD u úroku ze stejného dne — započítali jsme ji jen do nuly. Zkontroluj výpis.`,
  });

  for (const interest of interests) {
    push(interest.line, interest.raw, {
      type: 'INTEREST',
      id: interest.id,
      amount: interest.amount,
      currency: USD,
      // R-07f: částka je hrubý úrok, srážka jde zvlášť (strop podle čl. 11 smlouvy)
      withholdingTax: interest.withholding ?? '0',
      date: interest.date,
      note: interest.note,
    });
  }
  for (const dividend of dividends) {
    push(dividend.line, dividend.raw, {
      type: 'DIVIDEND',
      id: dividend.id,
      isin: dividend.isin,
      ticker: dividend.symbol || undefined,
      gross: dividend.gross,
      currency: USD,
      withholdingTax: dividend.withholding ?? '0',
      date: dividend.date,
    });
  }

  result.unmappedSymbols = [...unmapped];
  return result;
}
