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

/** Srážková daň = samostatné záporné řádky — k dividendám se párují druhým průchodem. */
const WITHHOLDING_ACTIONS = new Set([
  'NRA Tax Adj',
  'NRA Withholding',
  'Foreign Tax Paid',
  'IRS Withhold Adj',
]);

const INTEREST_ACTIONS = new Set(['Bank Interest', 'Credit Interest', 'Bond Interest', 'Interest Adj']);

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
  'Stock Plan Activity': OTHER_WARNING,
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
 * datum do ±5 dní).
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
  interface PendingTax {
    line: number;
    symbol: string;
    date: string;
    amount: string;
  }
  const dividends: PendingDividend[] = [];
  const taxes: PendingTax[] = [];

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

    if (action === 'Expired') {
      if (!OPTION_SYMBOL_RE.test(symbol)) {
        result.warnings.push({
          line,
          message: `„Expired“ u ${symbol || 'řádku bez symbolu'} nevypadá jako opce — řádek přeskočen; případně ho doplň přes univerzální šablonu.`,
        });
        continue;
      }
      const quantityRaw = parseSchwabNumber(map.get(row, 'Quantity'));
      const quantity = quantityRaw === null ? null : d(quantityRaw);
      if (!quantity || quantity.eq(0)) {
        result.errors.push({
          line,
          message: `Expired ${symbol}: chybí počet kontraktů (Quantity „${map.get(row, 'Quantity')}“).`,
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
        note: 'Expirace opce (uzavření za 0)',
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
      taxes.push({ line, symbol, date, amount: signed.neg().toString() });
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
      push(line, raw, {
        type: 'INTEREST',
        id: nextId(row),
        amount: amountRaw,
        currency: USD,
        date,
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

  // Nejdřív skutečné srážky, teprve pak vratky — vratka musí mít co snižovat.
  for (const tax of taxes.filter((t) => d(t.amount).gt(0))) {
    const best = nearest(tax, (dividend) => dividend.withholding === undefined);
    if (!best) {
      result.warnings.push({
        line: tax.line,
        message: `Srážková daň ${tax.amount} USD (${tax.symbol || 'bez symbolu'}, ${tax.date}) nemá dohledatelnou dividendu — přiřaď ji přes univerzální šablonu.`,
      });
      continue;
    }
    best.withholding = tax.amount;
  }
  // B-3-11: vratka přeplatku snižuje už zaúčtovanou srážku téhož symbolu.
  for (const tax of taxes.filter((t) => d(t.amount).lt(0))) {
    const refund = d(tax.amount).abs();
    const best = nearest(tax, (dividend) => d(dividend.withholding ?? '0').gt(0));
    if (!best) {
      result.warnings.push({
        line: tax.line,
        message: `Vratka srážkové daně ${refund.toString()} USD (${tax.symbol || 'bez symbolu'}, ${tax.date}) nemá k čemu se přiřadit — u téhle dividendy žádnou sraženou daň neevidujeme. Zkontroluj výpis, jinak bude zápočet nadhodnocený.`,
      });
      continue;
    }
    const zbytek = d(best.withholding ?? '0').minus(refund);
    if (zbytek.isNegative()) {
      result.warnings.push({
        line: tax.line,
        message: `Vratka srážkové daně ${refund.toString()} USD (${tax.symbol}, ${tax.date}) je vyšší než sražená daň ${best.withholding} USD u dividendy z ${best.date} — započítali jsme ji jen do nuly. Zkontroluj výpis.`,
      });
    }
    best.withholding = Decimal.max(zbytek, d('0')).toString();
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
