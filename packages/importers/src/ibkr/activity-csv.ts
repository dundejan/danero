import { d, isValidIsin, TransactionSchema, ZERO } from '@danero/shared';
import { cleanNumber, firstLine, HeaderMap, isValidIsoDate, parseCsv } from '../csv';
import { fnv1a64 } from '../dedupe';
import { REENTER_VIA_TEMPLATE, type ImportResult } from '../types';
import { IBKR_BROKER } from './xml';

/**
 * Parser CSV výpisu „Activity Statement“ z Interactive Brokers a Lynxu
 * (Client Portal → Performance & Reports → Statements → Activity → CSV).
 *
 * Je to jiný export než Flex Query: jeden soubor nese desítky tabulek pod
 * sebou a každý řádek začíná názvem sekce a druhem řádku
 * (`Trades,Header,…`, `Trades,Data,…`, `Trades,SubTotal,…`). Hlavička se
 * uvnitř sekce smí opakovat s jinou sadou sloupců (akcie × forex), takže se
 * sloupce čtou podle POSLEDNÍ hlavičky téže sekce a výhradně podle názvů.
 *
 * Čteme, co má daňový význam a co umíme přečíst bez hádání: obchody s akciemi
 * a ETF, dividendy se sraženou daní, úroky, poplatky, vklady a výběry. Všechno
 * ostatní se buď vědomě přeskočí (přehledy, které transakce nenesou), nebo
 * skončí viditelnou chybou s radou (deriváty, dluhopisy, korporátní akce,
 * převody pozic — ty nese celé Flex Query). Nic nepropadá potichu.
 *
 * Výpis je vždy anglicky formátovaný (desetinná tečka, tisíce čárkou
 * v uvozovkách) a obchody mají úroveň objednávky (`DataDiscriminator` =
 * `Order`); jednotlivá plnění (`Trade`) a uzavřené loty (`ClosedLot`) jsou
 * tatáž událost podruhé a nečtou se, pokud objednávky ve výpisu jsou.
 */

/** První řádek výpisu — podle něj se formát pozná (sniffer i parser). */
const STATEMENT_HEADER = ['Statement', 'Header', 'Field Name', 'Field Value'] as const;

function isActivityStatementHeader(cells: readonly string[]): boolean {
  return STATEMENT_HEADER.every((name, index) => (cells[index] ?? '').trim() === name);
}

/** Autodetekce: první řádek je hlavička sekce `Statement`. */
export function sniffIbkrActivityCsv(text: string): boolean {
  return isActivityStatementHeader(parseCsv(firstLine(text)).headers);
}

/**
 * Sekce, které transakce nenesou (stavy, přehledy, vysvětlivky) nebo je nesou
 * podruhé v jiném řezu — přeskakují se bez hlášení. Sekce mimo tenhle seznam
 * a mimo ty, které čteme, se ohlásí jménem (`skipped`).
 */
const INFORMATIONAL_SECTIONS = new Set([
  'Statement',
  'Account Information',
  'Net Asset Value',
  'Change in NAV',
  'Mark-to-Market Performance Summary',
  'Realized & Unrealized Performance Summary',
  'Month & Year to Date Performance Summary',
  'Cash Report',
  'Open Positions',
  'Forex Balances',
  'Net Stock Position Summary',
  'Change in Dividend Accruals',
  'Open Dividend Accruals',
  'Interest Accruals',
  'Financial Instrument Information',
  'Codes',
  'Notes/Legal Notes',
  'Location of Customer Assets, Positions and Money',
  'Complex Positions Summary',
  'Collateral for Customer Borrowing',
  'Total P/L for Statement Period',
]);

/**
 * Sekce, které transakce NESOU, ale z tohohle výpisu je nečteme — jejich
 * tvar je volný text bez ISIN a chyba by znamenala špatný počet kusů.
 * Uživatel dostane chybu s radou; nejde o vadu parseru (`knownUnsupported`).
 */
const UNSUPPORTED_SECTIONS: Record<string, string> = {
  'Corporate Actions': 'korporátní akce (split, spin-off, změna ISIN)',
  Transfers: 'převody cenných papírů',
  'Option Exercises, Assignments and Expirations': 'uplatnění a expirace opcí',
  'Option Cash Settlements': 'peněžní vypořádání opcí',
  'Grant Activity': 'přidělené zaměstnanecké akcie',
};

const USE_FLEX_INSTEAD =
  'Tyhle řádky nese Flex Query: vrať tenhle import zpět (tlačítko v historii importů) a napoj účet přes Flex Web Service, nebo si Flex Query stáhni jako XML.';

type Decimal = ReturnType<typeof d>;

/**
 * Druh aktiv bez přípony, kterou IBKR přidává u pozic vedených jinou svou
 * entitou („Stocks - Held with Interactive Brokers (U.K.) Limited carried by
 * Interactive Brokers LLC“).
 */
const assetCategoryOf = (row: Row): string =>
  row.map.get(row.cells, 'Asset Category').split(' - Held with')[0]!.trim();

interface Row {
  line: number;
  section: string;
  map: HeaderMap;
  cells: string[];
}

interface Instrument {
  isin?: string;
  name?: string;
  /** `Type` z Financial Instrument Information (COMMON, ETF, REIT, ADR…). */
  kind?: string;
  /** Tentýž symbol vede ve výpisu ke dvěma různým ISIN — titul nejde určit. */
  ambiguous?: true;
}

/** Číslo z buňky; `null` = prázdná, `undefined` = nečitelná. */
function readNumber(raw: string): Decimal | null | undefined {
  if (raw === '') return null;
  // jen desítkový zápis: decimal.js by jinak vzal i „0x10“ nebo „Infinity“
  if (!/^-?(?:\d[\d,]*(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?$/.test(raw.replace(/\s/g, ''))) return undefined;
  try {
    const value = d(cleanNumber(raw));
    return value.isFinite() ? value : undefined;
  } catch {
    return undefined;
  }
}

/** „2024-03-05, 12:30:45“ i samotné „2024-03-05“ → ISO datum. */
function readDate(raw: string): string | null {
  const match = /^(\d{4}-\d{2}-\d{2})(?!\d)/.exec(raw.trim());
  return match && isValidIsoDate(match[1]!) ? match[1]! : null;
}

/**
 * Titul z popisu dividendy a srážkové daně:
 * „ABC(US0000000000) Cash Dividend USD 0.5 per Share (Ordinary Dividend)“,
 * u některých titulů s mezerou před závorkou („ABC (CA…)“). V závorce bývá
 * ISIN; když ne (CUSIP, conid), zůstane jen symbol a ISIN se dohledá ve
 * Financial Instrument Information.
 */
function securityFromDescription(description: string): { symbol?: string; isin?: string } {
  // bez regulárního výrazu nad celým popisem: je to cizí vstup a výraz
  // s volitelnými mezerami kolem symbolu by na dlouhém řádku běžel kvadraticky
  const open = description.indexOf('(');
  if (open <= 0 || open > 60) return {};
  const symbol = description.slice(0, open).trim();
  const match = /^\(([A-Za-z0-9]{1,20})\)/.exec(description.slice(open, open + 24));
  if (symbol === '' || symbol.includes(')') || !match) return {};
  const id = match[1]!.toUpperCase();
  return { symbol, ...(isValidIsin(id) ? { isin: id } : {}) };
}

export function parseIbkrActivityCsv(text: string): ImportResult {
  const result: ImportResult = {
    broker: IBKR_BROKER,
    transactions: [],
    errors: [],
    skipped: [],
    warnings: [],
  };

  const table = parseCsv(text);
  if (!isActivityStatementHeader(table.headers)) {
    result.errors.push({
      line: 1,
      message:
        'Tohle nevypadá jako Activity Statement z Interactive Brokers (první řádek má být „Statement,Header,Field Name,Field Value“). Stáhni ho v Client Portalu: Performance & Reports → Statements → Activity → CSV.',
    });
    return result;
  }

  // ── 1. průchod: řádky podle sekcí, každý s hlavičkou platnou v tu chvíli ──
  const headers = new Map<string, HeaderMap>();
  const rows: Row[] = [];
  const statement = new Map<string, string>();
  const accountInfo = new Map<string, string>();
  const headerless = new Set<string>();
  headers.set('Statement', new HeaderMap(STATEMENT_HEADER.slice(2)));

  table.rows.forEach((cells, index) => {
    const line = index + 2;
    const section = (cells[0] ?? '').trim();
    const kind = (cells[1] ?? '').trim();
    if (section === '') return;
    if (kind === 'Header') {
      headers.set(section, new HeaderMap(cells.slice(2).map((cell) => cell.trim())));
      return;
    }
    // SubTotal, Total a případné další druhy jsou součty řádků Data
    if (kind !== 'Data') return;
    const map = headers.get(section);
    if (!map) {
      headerless.add(section);
      return;
    }
    const data = cells.slice(2);
    if (section === 'Statement') statement.set(map.get(data, 'Field Name'), map.get(data, 'Field Value'));
    if (section === 'Account Information') {
      accountInfo.set(map.get(data, 'Field Name'), map.get(data, 'Field Value'));
    }
    rows.push({ line, section, map, cells: data });
  });

  for (const section of headerless) {
    result.errors.push({
      line: 1,
      message: `Sekce „${section}“ nemá ve výpisu hlavičku se sloupci, takže její řádky neumíme přečíst. Stáhni výpis z IBKR znovu.`,
    });
  }

  const bySection = (section: string): Row[] => rows.filter((row) => row.section === section);
  // číslo účtu bez případného aliasu v závorce
  const statementAccount = (accountInfo.get('Account') ?? '').split(/[\s(]/)[0] ?? '';
  const accountOf = (row: Row): string | undefined =>
    row.map.get(row.cells, 'Account') || statementAccount || undefined;

  // ── číselník titulů: symbol → ISIN, název, druh ──
  const instruments = new Map<string, Instrument>();
  for (const row of bySection('Financial Instrument Information')) {
    if (assetCategoryOf(row) !== 'Stocks') continue;
    const securityId = row.map.get(row.cells, 'Security ID').toUpperCase();
    const instrument: Instrument = {
      ...(isValidIsin(securityId) ? { isin: securityId } : {}),
      name: row.map.get(row.cells, 'Description') || undefined,
      kind: row.map.get(row.cells, 'Type') || undefined,
    };
    // jeden titul může mít víc symbolů oddělených čárkou (kotace na víc trzích)
    for (const alias of row.map.get(row.cells, 'Symbol').split(',')) {
      const symbol = alias.trim();
      if (symbol === '') continue;
      const known = instruments.get(symbol);
      // obchody burzu ani conid nenesou, takže dva tituly pod jedním symbolem
      // (týž ticker v USA a v Kanadě) od sebe nejde poznat — radši chyba než cizí ISIN
      if (known && known.isin !== instrument.isin) instruments.set(symbol, { ambiguous: true });
      else if (!known) instruments.set(symbol, instrument);
    }
  }

  // Stabilní id z obsahu — nikdy z pořadí v souboru (viz `contentId` v xml.ts).
  const idOccurrences = new Map<string, number>();
  const contentId = (prefix: string, parts: Array<string | undefined>): string => {
    const base = `ibkr-as-${prefix}-${fnv1a64(parts.map((part) => part ?? '').join('|'))}`;
    const seen = (idOccurrences.get(base) ?? 0) + 1;
    idOccurrences.set(base, seen);
    return seen === 1 ? base : `${base}-${seen}`;
  };

  const push = (row: Row, candidate: Record<string, unknown>): boolean => {
    try {
      result.transactions.push(TransactionSchema.parse(candidate));
      return true;
    } catch (error) {
      result.errors.push({
        line: row.line,
        message: `Řádek sekce „${row.section}“ se nepodařilo zpracovat: ${error instanceof Error ? error.message : String(error)}`,
        raw: row.cells.join(','),
      });
      return false;
    }
  };

  const isTotalRow = (row: Row): boolean =>
    ['Currency', 'Subtitle', 'Asset Category'].some((column) =>
      row.map.get(row.cells, column).startsWith('Total'),
    );

  /** Datum, částka a měna hotovostního řádku; chybu zapíše a vrátí `null`. */
  const cashRow = (
    row: Row,
    dateColumns: readonly string[],
  ): { date: string; amount: Decimal; currency: string; description: string } | null => {
    const date = readDate(row.map.getAny(row.cells, dateColumns));
    const amount = readNumber(row.map.get(row.cells, 'Amount'));
    const currency = row.map.get(row.cells, 'Currency');
    if (!date || !amount || currency === '') {
      result.errors.push({
        line: row.line,
        message: `Řádek sekce „${row.section}“ nemá čitelné datum, částku nebo měnu — nenačetli jsme ho. Zkontroluj ho ve výpisu.`,
        raw: row.cells.join(','),
      });
      return null;
    }
    return { date, amount, currency, description: row.map.get(row.cells, 'Description') };
  };

  // ── Trades ──
  const netTraded = new Map<string, Decimal>();
  const unsaved = new Set<string>();
  processTrades(bySection('Trades'), {
    result,
    instruments,
    accountOf,
    contentId,
    push,
    netTraded,
    unsaved,
  });

  // ── Dividends + Withholding Tax (+ Payment In Lieu) ──
  interface DividendGroup {
    dividends: Array<{ row: Row; amount: Decimal; symbol?: string; isin?: string; description: string }>;
    withholding: Decimal;
    withholdingLines: number[];
  }
  const dividendGroups = new Map<string, DividendGroup>();
  const groupOf = (key: string): DividendGroup => {
    const group = dividendGroups.get(key) ?? { dividends: [], withholding: ZERO, withholdingLines: [] };
    dividendGroups.set(key, group);
    return group;
  };
  const securityOf = (description: string): { symbol?: string; isin?: string } => {
    const security = securityFromDescription(description);
    const isin = security.isin ?? (security.symbol ? instruments.get(security.symbol)?.isin : undefined);
    return { ...(security.symbol ? { symbol: security.symbol } : {}), ...(isin ? { isin } : {}) };
  };
  // účet je součást klíče: konsolidovaný výpis nese tutéž dividendu za každý účet zvlášť
  const groupKey = (row: Row, security: { symbol?: string; isin?: string }, date: string, currency: string): string =>
    `${accountOf(row) ?? ''}|${security.isin ?? security.symbol ?? '?'}|${date}|${currency}`;

  {
    // náhradní platby (payment in lieu) chodí v téže sekci jako dividendy
    for (const row of bySection('Dividends')) {
      if (isTotalRow(row)) continue;
      const cash = cashRow(row, ['Date']);
      if (!cash) continue;
      const security = securityOf(cash.description);
      if (/payment in lieu/i.test(cash.description)) {
        result.warnings.push({
          line: row.line,
          message:
            'Náhradní platba za dividendu (payment in lieu) — daňově ji řadíme jako dividendu (§ 8), u zapůjčených akcií může být posouzení sporné.',
        });
      }
      // R-07h: vratka kapitálu jde mimo skupinu, ať se nespáruje se srážkou
      if (/return of capital/i.test(cash.description)) {
        if (cash.amount.lte(0)) {
          result.warnings.push({
            line: row.line,
            message: `Vratka kapitálu ${security.symbol ?? ''} s částkou ${cash.amount.toString()} ${cash.currency} — nezáporná se čekala, řádek přeskočen. Zkontroluj ho ve výpisu.`,
          });
          continue;
        }
        push(row, {
          type: 'DIVIDEND',
          id: contentId('roc', [cash.date, security.isin ?? security.symbol, cash.amount.toString(), cash.currency]),
          account: accountOf(row),
          isin: security.isin,
          ticker: security.symbol,
          gross: cash.amount.toString(),
          currency: cash.currency,
          withholdingTax: '0',
          returnOfCapital: true,
          date: cash.date,
          note: cash.description || undefined,
        });
        result.warnings.push({
          line: row.line,
          message: `Return of Capital ${security.symbol ?? ''}: vratka kapitálu není podíl na zisku — věcně snižuje nabývací cenu držených kusů (daň až při prodeji). Ve výchozím nastavení ji daníme jako dividendu (§ 8) a čerpá limit 50 000 Kč; přepnout to jde v Nastavení u „Vratka kapitálu" (R-07h).`,
        });
        continue;
      }
      groupOf(groupKey(row, security, cash.date, cash.currency)).dividends.push({
        row,
        amount: cash.amount,
        ...security,
        description: cash.description,
      });
    }
  }

  // srážka bez titulu patří k úroku téhož dne a měny (IBKR Ireland, R-07f)
  const interestWithholding = new Map<string, { total: Decimal; line: number }>();
  for (const row of bySection('Withholding Tax')) {
    if (isTotalRow(row)) continue;
    const cash = cashRow(row, ['Date']);
    if (!cash) continue;
    const security = securityOf(cash.description);
    if (!security.symbol && !security.isin) {
      const key = `${cash.date}|${cash.currency}`;
      const entry = interestWithholding.get(key) ?? { total: ZERO, line: row.line };
      entry.total = entry.total.plus(cash.amount.neg());
      interestWithholding.set(key, entry);
      continue;
    }
    // srážka je záporná; kladná hodnota je oprava a odečte se
    const group = groupOf(groupKey(row, security, cash.date, cash.currency));
    group.withholding = group.withholding.plus(cash.amount.neg());
    group.withholdingLines.push(row.line);
  }

  for (const group of dividendGroups.values()) {
    if (group.dividends.length === 0) {
      result.warnings.push({
        line: group.withholdingLines[0] ?? 1,
        message:
          'Srážková daň bez párové dividendy ve výpisu (nejspíš oprava přes hranici období) — nezaúčtováno, zkontroluj výpis za sousední období.',
      });
      continue;
    }
    const totalWithholding = group.withholding.lt(0) ? ZERO : group.withholding;
    if (group.withholding.lt(0)) {
      result.warnings.push({
        line: group.dividends[0]!.row.line,
        message:
          'Kladná srážková daň (refund) převažuje — srážku počítáme jako 0, zkontroluj opravy dividend.',
      });
    }
    const emit = (item: DividendGroup['dividends'][number], gross: Decimal, withholding: Decimal): void => {
      const cash = cashRow(item.row, ['Date'])!;
      push(item.row, {
        type: 'DIVIDEND',
        id: contentId('div', [cash.date, item.isin ?? item.symbol, gross.toString(), cash.currency]),
        account: accountOf(item.row),
        isin: item.isin,
        ticker: item.symbol,
        gross: gross.toString(),
        currency: cash.currency,
        withholdingTax: withholding.toDecimalPlaces(6).toString(),
        date: cash.date,
        note: item.description || undefined,
      });
    };

    if (group.dividends.some((item) => item.amount.lt(0))) {
      // storno nebo korekce v téže skupině: poctivé netto jednou transakcí
      const netGross = group.dividends.reduce((sum, item) => sum.plus(item.amount), ZERO);
      const firstPositive = group.dividends.find((item) => item.amount.gt(0)) ?? group.dividends[0]!;
      if (netGross.lte(0)) {
        result.warnings.push({
          line: firstPositive.row.line,
          message:
            'Dividenda s korekcí vychází netto ≤ 0 — skupinu vynecháváme, zkontroluj opravy ve výpisu.',
        });
        continue;
      }
      result.warnings.push({
        line: firstPositive.row.line,
        message: 'Dividenda obsahuje korekční (zápornou) položku — účtujeme netto jednou transakcí.',
      });
      emit(firstPositive, netGross, totalWithholding);
      continue;
    }

    // srážka pro-rata podle brutta, poslední položka bere zbytek
    const totalGross = group.dividends.reduce((sum, item) => sum.plus(item.amount), ZERO);
    let allocated = ZERO;
    group.dividends.forEach((item, index) => {
      const share =
        index === group.dividends.length - 1
          ? totalWithholding.minus(allocated)
          : totalGross.gt(0)
            ? totalWithholding.mul(item.amount).div(totalGross).toDecimalPlaces(6)
            : ZERO;
      allocated = allocated.plus(share);
      emit(item, item.amount, share);
    });
  }

  // ── Interest ──
  {
    for (const row of bySection('Interest')) {
      if (isTotalRow(row)) continue;
      const cash = cashRow(row, ['Date']);
      if (!cash) continue;
      if (cash.amount.lt(0)) {
        push(row, {
          type: 'FEE',
          id: contentId('cash', ['FEE', cash.date, cash.amount.toString(), cash.currency, cash.description]),
          account: accountOf(row),
          amount: cash.amount.abs().toString(),
          currency: cash.currency,
          date: cash.date,
          note: `Zaplacený úrok brokerovi${cash.description ? ` — ${cash.description}` : ''}`,
        });
        continue;
      }
      // srážka bez titulu patří k úroku od brokera, ne ke kupónu z dluhopisu
      const key = /bond coupon|accrued interest/i.test(cash.description) ? '' : `${cash.date}|${cash.currency}`;
      const withheld = interestWithholding.get(key);
      interestWithholding.delete(key);
      if (withheld?.total.lt(0)) {
        result.warnings.push({
          line: withheld.line,
          message:
            'U úroku převažuje vrácená srážková daň nad sraženou — srážku počítáme jako 0, zkontroluj opravy ve výpisu.',
        });
      }
      push(row, {
        type: 'INTEREST',
        id: contentId('cash', ['INTEREST', cash.date, cash.amount.toString(), cash.currency, cash.description]),
        account: accountOf(row),
        amount: cash.amount.toString(),
        currency: cash.currency,
        ...(withheld ? { withholdingTax: (withheld.total.lt(0) ? ZERO : withheld.total).toString() } : {}),
        date: cash.date,
        note: cash.description || undefined,
      });
    }
  }
  for (const withheld of interestWithholding.values()) {
    result.warnings.push({
      line: withheld.line,
      message: `Srážková daň ${withheld.total.toString()} bez titulu a bez úroku ze stejného dne — nezaúčtováno. Bývá to srážka z úroku, který je ve výpisu za sousední období.`,
    });
  }

  // ── Fees ──
  for (const section of ['Fees', 'Transaction Fees', 'Commission Adjustments'] as const) {
    for (const row of bySection(section)) {
      if (isTotalRow(row)) continue;
      const cash = cashRow(row, ['Date', 'Date/Time']);
      if (!cash) continue;
      if (cash.amount.gte(0)) {
        result.warnings.push({
          line: row.line,
          message: `Vratka poplatku ${cash.amount.toString()} ${cash.currency} z ${cash.date} — do výpočtu nevstupuje, neukládáme ji.`,
        });
        continue;
      }
      push(row, {
        type: 'FEE',
        id: contentId('cash', ['FEE', cash.date, cash.amount.toString(), cash.currency, cash.description]),
        account: accountOf(row),
        amount: cash.amount.abs().toString(),
        currency: cash.currency,
        date: cash.date,
        note: cash.description || undefined,
      });
    }
  }

  // ── Deposits & Withdrawals ──
  for (const row of bySection('Deposits & Withdrawals')) {
    if (isTotalRow(row)) continue;
    const cash = cashRow(row, ['Settle Date', 'Date']);
    if (!cash) continue;
    if (cash.amount.isZero()) continue;
    push(row, {
      type: cash.amount.gt(0) ? 'DEPOSIT' : 'WITHDRAWAL',
      id: contentId('cash', ['DW', cash.date, cash.amount.toString(), cash.currency]),
      account: accountOf(row),
      amount: cash.amount.abs().toString(),
      currency: cash.currency,
      date: cash.date,
      note: cash.description || undefined,
    });
  }

  // ── sekce, které transakce nesou a nečteme je ──
  const HANDLED = new Set([
    'Trades',
    'Dividends',
    'Withholding Tax',
    'Interest',
    'Fees',
    'Transaction Fees',
    'Commission Adjustments',
    'Deposits & Withdrawals',
  ]);
  const otherSections = new Map<string, { line: number; count: number }>();
  for (const row of rows) {
    if (HANDLED.has(row.section) || INFORMATIONAL_SECTIONS.has(row.section)) continue;
    const entry = otherSections.get(row.section) ?? { line: row.line, count: 0 };
    entry.count += 1;
    otherSections.set(row.section, entry);
  }
  for (const [section, entry] of otherSections) {
    const known = UNSUPPORTED_SECTIONS[section];
    if (known) {
      result.errors.push({
        line: entry.line,
        message: `Výpis obsahuje ${known} (sekce „${section}“, řádků: ${entry.count}) — z Activity Statementu je nečteme, protože je popisuje jen volným textem. ${USE_FLEX_INSTEAD}`,
        knownUnsupported: true,
      });
    } else {
      result.skipped.push({
        line: entry.line,
        message: `Sekci „${section}“ (řádků: ${entry.count}) z výpisu nečteme.`,
      });
    }
  }

  // ── neúplná historie: kusy držené z doby před začátkem výpisu ──
  const positions = new Map<string, Decimal>();
  for (const row of bySection('Open Positions')) {
    if (assetCategoryOf(row) !== 'Stocks') continue;
    const discriminator = row.map.get(row.cells, 'DataDiscriminator');
    if (discriminator !== '' && discriminator !== 'Summary') continue;
    const quantity = readNumber(row.map.get(row.cells, 'Quantity'));
    const symbol = row.map.get(row.cells, 'Symbol');
    if (!quantity || symbol === '') continue;
    positions.set(symbol, (positions.get(symbol) ?? ZERO).plus(quantity));
  }
  const hasPositionsSection = headers.has('Open Positions');
  // převody a korporátní akce mění kusy mimo obchody, takže rozdíl nic neříká
  const quantitiesComparable = !Object.keys(UNSUPPORTED_SECTIONS).some((section) => otherSections.has(section));
  const candidates = quantitiesComparable ? [...new Set([...positions.keys(), ...netTraded.keys()])] : [];
  const fromBefore = candidates.filter((symbol) => {
    if (unsaved.has(symbol)) return false;
    const held = positions.get(symbol) ?? ZERO;
    const traded = netTraded.get(symbol) ?? ZERO;
    // bez sekce pozic jde poznat jen to, že se prodalo víc, než se koupilo
    return hasPositionsSection ? !held.eq(traded) : traded.lt(0);
  });
  if (fromBefore.length > 0) {
    const years = [...(statement.get('Period') ?? '').matchAll(/\b(?:19|20)\d{2}\b/g)].map((match) => match[0]);
    const period =
      years.length === 0
        ? 'jen část historie účtu'
        : years[0] === years[years.length - 1]
          ? `jen rok ${years[0]}`
          : `jen roky ${years[0]}–${years[years.length - 1]}`;
    const listed = fromBefore.slice(0, 8).join(', ') + (fromBefore.length > 8 ? '…' : '');
    result.warnings.push({
      line: 1,
      message: `Výpis pokrývá ${period}, ale u ${fromBefore.length === 1 ? 'titulu' : 'titulů'} ${listed} držíš nebo prodáváš kusy koupené dřív. Jestli starší roky nahrané nemáš, nahraj i je (Activity Statement za každý rok zvlášť) — bez nich neznáme nabývací cenu ani datum nákupu a prodej těch kusů by vyšel jako čistý příjem.`,
    });
  }

  // ── výkaz bez jediné sekce s pohyby ──
  if (result.transactions.length === 0 && result.errors.length === 0) {
    const title = (statement.get('Title') ?? '').slice(0, 60);
    const hasActivity = rows.some((row) => HANDLED.has(row.section));
    const unknown = [...otherSections.keys()].filter((section) => !(section in UNSUPPORTED_SECTIONS));
    if (!hasActivity && unknown.length > 0) {
      // přejmenovaná nebo přeložená sekce: soubor jsme poznali a nic z něj
      // nepřečetli — to je vada naše, ne prázdné období
      result.errors.push({
        line: 1,
        message: `Ve výpisu jsme nenašli žádnou sekci s obchody, dividendami ani vklady — jen sekce, které neznáme (${unknown.slice(0, 6).join(', ')}). Stáhni výpis v angličtině; kdyby to nepomohlo, podíváme se na něj.`,
      });
    } else if (!hasActivity && title !== '' && !/activity/i.test(title)) {
      result.errors.push({
        line: 1,
        message: `Tohle je výkaz „${title}“, který obchody ani dividendy nenese. Stáhni Activity Statement: Performance & Reports → Statements → Activity → CSV.`,
        knownUnsupported: true,
      });
    }
  }

  return result;
}

/* ── Trades ──────────────────────────────────────────────────────────────── */

interface TradeContext {
  result: ImportResult;
  instruments: Map<string, Instrument>;
  accountOf: (row: Row) => string | undefined;
  contentId: (prefix: string, parts: Array<string | undefined>) => string;
  push: (row: Row, candidate: Record<string, unknown>) => boolean;
  /** Symbol → čistý počet kusů nakoupených ve výpisu (prodeje záporně). */
  netTraded: Map<string, Decimal>;
  /** Symboly s obchodem, který se nenačetl — počet kusů u nich z výpisu neznáme. */
  unsaved: Set<string>;
}

/** Druhy aktiv, které z tohohle výpisu nečteme, a jak je uživateli pojmenovat. */
const UNSUPPORTED_ASSETS: Record<string, string> = {
  'Equity and Index Options': 'opce',
  'Options On Futures': 'opce na futures',
  Futures: 'futures',
  CFDs: 'CFD',
  Warrants: 'warrant',
  Bonds: 'dluhopis',
  'Structured Products': 'strukturovaný produkt',
};

function processTrades(tradeRows: Row[], context: TradeContext): void {
  const { result, instruments, accountOf, contentId, push, netTraded, unsaved } = context;
  const discriminatorOf = (row: Row): string => row.map.get(row.cells, 'DataDiscriminator');
  // objednávky a jejich plnění jsou tatáž událost: čte se jedna úroveň
  // — a rozhoduje se zvlášť pro každý druh aktiv, ať forex s objednávkami
  // nezahodí akcie, které mají jen plnění
  const withOrders = new Set(
    tradeRows
      .filter((row) => discriminatorOf(row) === 'Order')
      .map((row) => assetCategoryOf(row)),
  );
  const otherLevels = new Map<string, number>();

  for (const row of tradeRows) {
    const discriminator = discriminatorOf(row);
    const level = withOrders.has(assetCategoryOf(row)) ? 'Order' : 'Trade';
    if (row.map.has('DataDiscriminator') && discriminator !== level) {
      // plnění pod objednávkou a uzavřené loty jsou rozpad téhož obchodu
      if (discriminator !== 'Trade' && discriminator !== 'ClosedLot') {
        otherLevels.set(discriminator, (otherLevels.get(discriminator) ?? 0) + 1);
      }
      continue;
    }

    const category = assetCategoryOf(row);
    const symbol = row.map.get(row.cells, 'Symbol');
    const raw = row.cells.join(',');
    if (category === 'Forex') {
      result.skipped.push({
        line: row.line,
        message: `Měnová konverze ${symbol} — pro daň z prodeje CP není potřeba.`,
      });
      continue;
    }
    if (category !== 'Stocks') {
      const label = UNSUPPORTED_ASSETS[category];
      result.errors.push({
        line: row.line,
        message: `Obchod ${symbol} (${label ?? category}) z Activity Statementu nečteme — výpis u něj neuvádí všechno, co k výpočtu potřebujeme. ${USE_FLEX_INSTEAD}`,
        raw,
        knownUnsupported: true,
      });
      continue;
    }

    const codes = new Set(
      row.map
        .get(row.cells, 'Code')
        .split(';')
        .map((code) => code.trim())
        .filter((code) => code !== ''),
    );
    const dateRaw = row.map.get(row.cells, 'Date/Time');
    const tradeDate = readDate(dateRaw);
    const quantity = readNumber(row.map.get(row.cells, 'Quantity'));
    const price = readNumber(row.map.get(row.cells, 'T. Price'));
    const commission = readNumber(row.map.getAny(row.cells, ['Comm/Fee', 'Comm in USD']));
    const currency = row.map.get(row.cells, 'Currency');
    if (quantity === undefined || price === undefined || commission === undefined) {
      unsaved.add(symbol);
      result.errors.push({
        line: row.line,
        message: `Obchod ${symbol} má v počtu kusů, ceně nebo poplatku hodnotu, která není číslo — nenačetli jsme ho. Stáhni výpis z IBKR znovu.`,
        raw,
      });
      continue;
    }
    if (!tradeDate || !quantity || quantity.isZero() || !price || !/^[A-Z]{3}$/.test(currency)) {
      result.errors.push({
        line: row.line,
        message: `Obchodu ${symbol} chybí datum, množství, cena nebo měna.`,
        raw,
      });
      unsaved.add(symbol);
      continue;
    }
    if (codes.has('Ca')) {
      unsaved.add(symbol);
      result.errors.push({
        line: row.line,
        message: `Obchod ${symbol} z ${tradeDate} je ve výpisu označený jako stornovaný (kód Ca) — nezaúčtovali jsme ho. Který původní obchod ruší, Activity Statement neuvádí. ${USE_FLEX_INSTEAD}`,
        raw,
        knownUnsupported: true,
      });
      continue;
    }
    const instrument = instruments.get(symbol);
    if (instrument?.ambiguous) {
      result.errors.push({
        line: row.line,
        message: `Symbol ${symbol} patří ve výpisu dvěma různým titulům (dva různé ISIN) a u obchodu není uvedeno, o který jde — nenačetli jsme ho. ${USE_FLEX_INSTEAD}`,
        raw,
        knownUnsupported: true,
      });
      unsaved.add(symbol);
      continue;
    }
    if (!instrument?.isin) {
      unsaved.add(symbol);
      result.errors.push({
        line: row.line,
        message: `Obchod ${symbol} nemá ve výpisu ISIN (sekce „Financial Instrument Information“ ho neuvádí) — nenačetli jsme ho. Při stahování výpisu nech zapnuté všechny sekce a nahraj ho znovu.`,
        raw,
      });
      continue;
    }

    const type = quantity.gt(0) ? 'BUY' : 'SELL';
    // R-13: prodej nakrátko = prodej, který pozici OTEVÍRÁ (a nákup, který ji zavírá)
    let positionEffect: 'OPEN' | 'CLOSE' | undefined;
    if (codes.has('O') && codes.has('C')) {
      result.warnings.push({
        line: row.line,
        message: `Obchod ${symbol} z ${tradeDate} zároveň zavírá jednu pozici a otevírá opačnou (kódy C a O) — kolik kusů patří na kterou stranu, výpis neuvádí. Zpracovali jsme ho jako jeden běžný obchod, takže počet kusů i částka sedí; rozdělené na prodej nakrátko a běžnou pozici není. Nedoplňuj ho přes univerzální šablonu — obchod už naimportovaný je a druhý záznam by kusy přičetl podruhé.`,
      });
    } else if (type === 'SELL' && codes.has('O')) positionEffect = 'OPEN';
    else if (type === 'BUY' && codes.has('C')) positionEffect = 'CLOSE';

    let fee: { amount: string; currency: string } | undefined;
    if (commission?.gt(0)) {
      result.warnings.push({
        line: row.line,
        message: `Obchod ${symbol} z ${tradeDate}: komise je kladná (${commission.toString()} ${currency}) — broker ti ji vrátil. Od nabývací ceny ji neodečítáme. ${REENTER_VIA_TEMPLATE}`,
      });
    } else if (commission?.lt(0)) {
      fee = { amount: commission.abs().toString(), currency };
    }

    const saved = push(row, {
      type,
      ...(positionEffect ? { positionEffect } : {}),
      id: contentId('trade', [type, dateRaw, instrument.isin, quantity.toString(), price.toString(), currency]),
      account: accountOf(row),
      isin: instrument.isin,
      ticker: symbol || undefined,
      name: instrument.name,
      assetClass: instrument.kind === 'ETF' ? 'ETF' : 'STOCK',
      quantity: quantity.abs().toString(),
      pricePerShare: price.toString(),
      currency,
      ...(fee ? { fee } : {}),
      tradeDate,
    });
    if (saved) netTraded.set(symbol, (netTraded.get(symbol) ?? ZERO).plus(quantity));
    else unsaved.add(symbol);
  }

  for (const [discriminator, count] of otherLevels) {
    result.skipped.push({
      line: 1,
      message: `Řádky obchodů druhu „${discriminator || 'bez označení'}“ (${count}×) nečteme — obchody bereme z řádků objednávek.`,
    });
  }
}
