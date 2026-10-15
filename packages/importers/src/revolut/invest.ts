import { d, TransactionSchema } from '@danero/shared';
import { HeaderMap, isValidIsoDate, parseCsv } from '../csv';
import {
  REENTER_VIA_TEMPLATE,
  emptyResult,
  noteSymbolCurrency,
  type ImportResult,
  type IsinInstrumentMap,
  type SymbolCurrencies,
} from '../types';
import { YearBoundaryWatch } from '../year-boundary';
import {
  detectRevolutDecimal,
  isIsoCurrency,
  parseRevolutMoney,
  REVOLUT_BROKER,
  revolutAmbiguityNote,
  revolutIdFactory,
} from './common';

/**
 * Parser akciového „Account statement“ CSV z Revolutu. Výpis neobsahuje ISIN
 * (jen ticker) — dodává ho mapování symbolů; BUY/SELL bez mapování se
 * neimportuje a ticker skončí v `unmappedSymbols` (vzor XTB). Dividenda se
 * uloží i bez mapování, ale ticker se k doplnění nabídne taky — bez ISIN
 * u ní nejde určit stát zdroje (L23-03). Měna obchodu
 * je ve sloupci Currency, sloupec FX Rate ignorujeme — kurzy počítá engine
 * z kurzů ČNB.
 */
export type RevolutInstrumentMap = IsinInstrumentMap;

export type RevolutInvestResult = ImportResult & {
  unmappedSymbols: string[];
  /** Měny, ve kterých se který ticker ve výpisu obchodoval (vestavěný číselník ISIN). */
  symbolCurrencies: SymbolCurrencies;
};

/** Hlavička výpisu je stabilně anglická — mapujeme podle přesných názvů sloupců. */
const REQUIRED_HEADERS = [
  'Date',
  'Ticker',
  'Type',
  'Quantity',
  'Price per share',
  'Total Amount',
  'Currency',
] as const;

/**
 * Sloupce, podle kterých akciový výpis poznáme — kombinace je revolut-specifická.
 * Musí to být PODMNOŽINA toho, co parser vyžaduje: sniffer přísnější než parser
 * znamená, že soubor, který umíme přečíst, propadne na univerzální šablonu
 * a uživatel čte hlášku o „neznámém typu BUY - MARKET“. Proto tu není `FX Rate`
 * (parser ho ignoruje, kurzy počítá engine z ČNB).
 */
export const REVOLUT_INVEST_SNIFF_COLUMNS = ['Date', 'Ticker', 'Type', 'Quantity', 'Price per share'] as const;

export function sniffRevolutInvestCsv(text: string): boolean {
  if (text.trim() === '') return false;
  const newline = text.indexOf('\n');
  const firstLine = newline === -1 ? text : text.slice(0, newline);
  const { headers } = parseCsv(firstLine);
  return REVOLUT_INVEST_SNIFF_COLUMNS.every((name) => headers.includes(name));
}

type InvestKind =
  | { kind: 'BUY' | 'SELL' }
  | { kind: 'DIVIDEND' }
  | { kind: 'DIVIDEND_TAX_CORRECTION' }
  | { kind: 'FEE' }
  | { kind: 'SPLIT' }
  | { kind: 'SKIP'; reason: string }
  | { kind: 'UNKNOWN' };

/** Klasifikace řádku podle sloupce Type (hodnoty jsou ve výpisu uppercase). */
function classifyInvestType(type: string): InvestKind {
  // směr nese první slovo; typ příkazu (MARKET/LIMIT/STOP/STOP LIMIT/…) je pro
  // daň lhostejný a Revolut si ho rozšiřuje, ať kvůli tomu obchod nezmizí
  if (/^BUY - \S/.test(type)) return { kind: 'BUY' };
  if (/^SELL - \S/.test(type)) return { kind: 'SELL' };
  if (type === 'DIVIDEND') return { kind: 'DIVIDEND' };
  if (type === 'DIVIDEND TAX (CORRECTION)') return { kind: 'DIVIDEND_TAX_CORRECTION' };
  if (type === 'CASH TOP-UP')
    return { kind: 'SKIP', reason: 'vklad hotovosti — pohyb peněz mimo daňový výpočet CP' };
  if (type === 'CASH WITHDRAWAL')
    return { kind: 'SKIP', reason: 'výběr hotovosti — pohyb peněz mimo daňový výpočet CP' };
  if (type === 'CUSTODY FEE REVERSAL')
    return { kind: 'SKIP', reason: 'vratka poplatku za úschovu — do výpočtu nevstupuje' };
  if (type === 'CUSTODY FEE' || type === 'CUSTODY_FEE') return { kind: 'FEE' };
  if (type === 'STOCK SPLIT') return { kind: 'SPLIT' };
  // migrace mezi entitami Revolutu (Trading Ltd → Securities Europe UAB) — není obchod
  if (/^TRANSFER FROM .+ TO .+/.test(type))
    return { kind: 'SKIP', reason: 'převod mezi entitami Revolutu — není obchod, držení pokračuje' };
  return { kind: 'UNKNOWN' };
}

export function parseRevolutInvestCsv(
  text: string,
  instrumentMap: RevolutInstrumentMap = {},
): RevolutInvestResult {
  // prázdný soubor = prázdné období, ne chyba formátu (konzistentně s T212)
  if (text.trim() === '') {
    return {
      ...emptyResult(REVOLUT_BROKER),
      unmappedSymbols: [] as string[],
      symbolCurrencies: new Map() as SymbolCurrencies,
    };
  }
  const { headers, rows } = parseCsv(text);
  return parseRevolutInvestTable(headers, rows, instrumentMap);
}

/**
 * Jádro parseru nad už rozparsovanou tabulkou — sdílí ho CSV i XLSX větev.
 * Revolut nabízí „Account statement“ ve formátu Excel a podle účtu z něj
 * chodí jednou CSV a jindy XLSX; číst umíme obojí, tabulka je stejná.
 */
export function parseRevolutInvestTable(
  headers: string[],
  rows: string[][],
  instrumentMap: RevolutInstrumentMap = {},
): RevolutInvestResult {
  const result = {
    ...emptyResult(REVOLUT_BROKER),
    unmappedSymbols: [] as string[],
    symbolCurrencies: new Map() as SymbolCurrencies,
  };
  // lokalizace čísel se pozná z celého souboru, ne z jedné buňky (B-3-12)
  const decimal = detectRevolutDecimal(rows);
  const money = (value: string): ReturnType<typeof parseRevolutMoney> =>
    parseRevolutMoney(value, decimal);
  const map = new HeaderMap(headers);
  // desetinný oddělovač sloupce Quantity zvlášť (viz čtení počtu kusů níž)
  const quantityDecimal = detectRevolutDecimal(rows.map((row) => [map.get(row, 'Quantity')]));
  const taxCorrections = new Map<
    string,
    { line: number; ticker: string; date: string; currency: string; net: ReturnType<typeof d> }
  >();
  const missing = REQUIRED_HEADERS.filter((name) => !map.has(name));
  if (missing.length > 0) {
    result.errors.push({
      line: 1,
      message: `Soubor nevypadá jako akciový výpis Revolutu — chybí sloupce: ${missing.join(', ')}. Nalezené sloupce: ${headers.filter((h) => h !== '').join(', ')}`,
    });
    return result;
  }

  const nextId = revolutIdFactory();
  // dvě evidence (vzor Fio): `unmapped` hlídá, ať se ticker dostane do seznamu
  // k doplnění jen jednou; `unmappedErrored` hlídá chybu u obchodů — varování
  // u dividendy ji nesmí umlčet (obchod bez ISIN se zahazuje a bez chyby by
  // zmizel tiše)
  const unmapped = new Set<string>();
  const unmappedErrored = new Set<string>();

  /** ISIN z mapování pro BUY/SELL; bez něj obchod neemitujeme — JEDEN error per ticker. */
  const requireIsin = (ticker: string, line: number): string | null => {
    const instrument = instrumentMap[ticker];
    if (instrument) return instrument.isin;
    unmapped.add(ticker);
    if (!unmappedErrored.has(ticker)) {
      unmappedErrored.add(ticker);
      result.errors.push({
        line,
        message: `Symbol ${ticker}: doplň ISIN instrumentu (Revolut ho neexportuje).`,
        unmappedSymbol: ticker,
      });
    }
    return null;
  };

  /**
   * L23-03: ticker, ke kterému má výpis JEN dividendu (titul koupený dřív),
   * se k doplnění ISIN nenabídl vůbec — seznam se plnil jen u obchodů.
   * Dividenda se ukládá dál, ale bez ISIN u ní nejde určit stát zdroje.
   */
  const offerDividendIsin = (ticker: string, line: number): void => {
    if (ticker === '' || instrumentMap[ticker] || unmapped.has(ticker)) return;
    unmapped.add(ticker);
    result.warnings.push({
      line,
      message: `Symbol ${ticker}: doplň ISIN — Revolut ho neexportuje. Dividendu jsme zaúčtovali podle symbolu, ale bez ISIN ji nepřiřadíme k pozici a nepoznáme stát, ze kterého přišla. Po doplnění nahraj výpis znovu — dividenda se neuloží podruhé, jen dostane ISIN.`,
      unmappedSymbol: ticker,
    });
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

  // R-05d: časy jsou ve světovém čase, den i rok se berou z nich
  const yearBoundary = new YearBoundaryWatch(result);
  rows.forEach((row, rowIndex) => {
    const line = rowIndex + 2; // 1 = hlavička
    if (row.every((cell) => cell.trim() === '')) return;
    const raw = row.join(',');

    // ISO 8601 UTC s proměnným počtem desetinných sekund → prvních 10 znaků
    const dateRaw = map.get(row, 'Date');
    const isoDate = dateRaw.slice(0, 10);
    yearBoundary.row(line, dateRaw);
    if (!isValidIsoDate(isoDate)) {
      result.errors.push({
        line,
        message: `Neplatné datum „${dateRaw}“ (očekáván ISO 8601 čas, např. 2023-09-22T13:30:10Z).`,
        raw,
      });
      return;
    }

    const type = map.get(row, 'Type').toUpperCase();
    const ticker = map.get(row, 'Ticker');
    const currency = map.get(row, 'Currency');
    noteSymbolCurrency(result.symbolCurrencies, ticker, currency, line);
    const id = nextId(row);
    const classified = classifyInvestType(type);

    switch (classified.kind) {
      case 'BUY':
      case 'SELL': {
        if (ticker === '') {
          result.errors.push({ line, message: `${type}: chybí ticker instrumentu.`, raw });
          return;
        }
        if (!isIsoCurrency(currency)) {
          result.errors.push({
            line,
            message: `${type} ${ticker}: neplatná měna „${currency}“ ve sloupci Currency.`,
            raw,
          });
          return;
        }
        const quantityRaw = map.get(row, 'Quantity');
        // Počet kusů má vlastní lokalizaci: export z 9/2025 ho píše s desetinnou
        // čárkou („0,76672417“), ceny na témže řádku s tečkou — hlasování přes
        // celý soubor by čárku přehlasovalo a „1,125“ kusu uložilo jako 1 125.
        // Rozhoduje sloupec Quantity; když důkaz nedá, zkusí se, které čtení
        // sedí na Total Amount, a teprve pak se varuje.
        const quantityMoney = parseRevolutMoney(quantityRaw, quantityDecimal ?? decimal);
        let quantity = quantityMoney ? d(quantityMoney.amount) : null;
        const ambiguous =
          quantity !== null && revolutAmbiguityNote('Počet kusů', quantityRaw, quantity.toString()) !== null;
        if (ambiguous && quantity !== null && quantityDecimal === null) {
          const unitPrice = money(map.get(row, 'Price per share'));
          const total = money(map.get(row, 'Total Amount'));
          const asDecimal = parseRevolutMoney(quantityRaw, quantityRaw.includes(',') ? ',' : null);
          const asThousands = parseRevolutMoney(quantityRaw, quantityRaw.includes(',') ? '.' : ',');
          const fits = (candidate: ReturnType<typeof parseRevolutMoney>): boolean => {
            if (!candidate || !unitPrice || !total) return false;
            const expected = d(total.amount).abs();
            return (
              expected.gt(0) &&
              d(candidate.amount).mul(d(unitPrice.amount).abs()).minus(expected).abs().lte(expected.mul('0.02'))
            );
          };
          if (fits(asDecimal) !== fits(asThousands)) {
            quantity = d((fits(asDecimal) ? asDecimal : asThousands)!.amount);
          } else {
            const note = revolutAmbiguityNote('Počet kusů', quantityRaw, quantity.toString());
            if (note !== null) result.warnings.push({ line, message: note });
          }
        }
        if (!quantity || quantity.lte(0)) {
          result.errors.push({
            line,
            message: `${type} ${ticker}: chybí kladný počet kusů (Quantity „${map.get(row, 'Quantity')}“).`,
            raw,
          });
          return;
        }
        // Price per share je přesná jednotková cena; Total Amount jen jako
        // fallback (Total/Quantity) — Revolut ho zaokrouhluje
        const priceMoney = money(map.get(row, 'Price per share'));
        const totalMoney = money(map.get(row, 'Total Amount'));
        const price = priceMoney
          ? d(priceMoney.amount).abs()
          : totalMoney
            ? d(totalMoney.amount).abs().div(quantity)
            : null;
        if (price === null) {
          result.errors.push({
            line,
            message: `${type} ${ticker}: chybí cena (Price per share i Total Amount).`,
            raw,
          });
          return;
        }
        const isin = requireIsin(ticker, line);
        if (isin === null) return; // error per ticker už je nahlášený
        push(line, raw, {
          type: classified.kind,
          id,
          isin,
          ticker,
          quantity: quantity.toString(),
          pricePerShare: price.toString(),
          currency,
          tradeDate: isoDate, // datum vypořádání výpis neobsahuje — dopočte engine
        });
        return;
      }
      case 'DIVIDEND_TAX_CORRECTION': {
        const correction = money(map.get(row, 'Total Amount'));
        if (!correction) {
          result.errors.push({
            line,
            message: `${type} ${ticker}: chybí částka (Total Amount „${map.get(row, 'Total Amount')}“).`,
            raw,
          });
          return;
        }
        const key = `${ticker}|${isoDate}|${currency}`;
        const entry = taxCorrections.get(key) ?? { line, ticker, date: isoDate, currency, net: d(0) };
        entry.net = entry.net.plus(correction.amount);
        taxCorrections.set(key, entry);
        return;
      }
      case 'DIVIDEND': {
        const totalMoney = money(map.get(row, 'Total Amount'));
        const gross = totalMoney ? d(totalMoney.amount) : null;
        if (!gross || gross.lte(0)) {
          result.errors.push({
            line,
            message: `Dividenda ${ticker || 'bez tickeru'}: chybí kladná částka (Total Amount „${map.get(row, 'Total Amount')}“).`,
            raw,
          });
          return;
        }
        if (!isIsoCurrency(currency)) {
          result.errors.push({
            line,
            message: `Dividenda ${ticker}: neplatná měna „${currency}“ ve sloupci Currency.`,
            raw,
          });
          return;
        }
        // ISIN je u dividendy optional — bez mapování ji importujeme jen s tickerem
        // a ticker nabídneme k doplnění (L23-03)
        offerDividendIsin(ticker, line);
        push(line, raw, {
          type: 'DIVIDEND',
          id,
          isin: instrumentMap[ticker]?.isin,
          ticker: ticker || undefined,
          gross: gross.toString(),
          currency,
          withholdingTax: '0',
          date: isoDate,
        });
        result.warnings.push({
          line,
          message: `Dividenda ${ticker}: Revolut uvádí dividendy netto po srážce v zahraničí — srážkovou daň výpis neobsahuje, takže ji do zápočtu nedáváme. ${REENTER_VIA_TEMPLATE}`,
        });
        return;
      }
      case 'FEE': {
        const totalMoney = money(map.get(row, 'Total Amount'));
        if (!totalMoney) {
          result.errors.push({
            line,
            message: `Poplatek za úschovu: chybí částka (Total Amount „${map.get(row, 'Total Amount')}“).`,
            raw,
          });
          return;
        }
        if (!isIsoCurrency(currency)) {
          result.errors.push({
            line,
            message: `Poplatek za úschovu: neplatná měna „${currency}“ ve sloupci Currency.`,
            raw,
          });
          return;
        }
        // ve výpisu záporný → ukládáme jako kladný náklad
        push(line, raw, {
          type: 'FEE',
          id,
          amount: d(totalMoney.amount).abs().toString(),
          currency,
          date: isoDate,
          note: 'poplatek za úschovu (custody fee)',
        });
        return;
      }
      case 'SPLIT': {
        result.warnings.push({
          line,
          message: `Stock split ${ticker}: výpis neuvádí poměr splitu — doplň korporátní akci přes univerzální šablonu, jinak nebude sedět počet kusů. Řádek přeskočen.`,
        });
        return;
      }
      case 'SKIP': {
        result.skipped.push({ line, message: `„${type}“: ${classified.reason}` });
        return;
      }
      case 'UNKNOWN': {
        result.errors.push({
          line,
          message: `Neznámý typ řádku „${type}“ — nahlaš nám ho, doplníme podporu.`,
          raw,
        });
        return;
      }
    }
  });
  yearBoundary.flush();

  // „DIVIDEND TAX (CORRECTION)“: opravy chodí většinou v páru, který se vyruší
  // (dřív dvě zbytečné chyby „neznámý typ“). Co po sečtení zbude, je daň
  // sražená nebo vrácená dodatečně. Dividendy Revolut vyplácí už PO srážce
  // a brutto z výpisu neznáme, takže ji k dividendě sami nepřičítáme — řekneme
  // o ní, ať zápočet nezapadne.
  for (const correction of taxCorrections.values()) {
    if (correction.net.isZero()) {
      result.skipped.push({
        line: correction.line,
        message: `Opravy daně z dividendy ${correction.ticker} z ${correction.date} se navzájem ruší — nic k zaúčtování.`,
      });
      continue;
    }
    const withheld = correction.net.lt(0);
    result.warnings.push({
      line: correction.line,
      message: `Oprava daně z dividendy ${correction.ticker} z ${correction.date}: Revolut dodatečně ${withheld ? 'strhl' : 'vrátil'} ${correction.net.abs().toString()} ${correction.currency}. Do výpočtu ji sami nezařazujeme${withheld ? '' : ' — zápočet daně u té dividendy tím klesá'}. ${REENTER_VIA_TEMPLATE}`,
    });
  }

  result.unmappedSymbols = [...unmapped];
  return result;
}
