import type { RowIssue } from '@danero/importers';
import type { StoredIssues } from '@/lib/import-issues';

/**
 * Hlášky „doplň ISIN“ u starých dávek historie importů, které uživatel mezitím
 * vyřídil číselníkem.
 *
 * Dávka si hlášky ukládá tak, jak padly při importu. Když pak uživatel ISIN
 * doplní, stará dávka dál červeně tvrdila „Symbol X: doplň ISIN…“ a působilo
 * to, že je pořád něco špatně. Hláška k symbolu, který už v číselníku je, se
 * proto ukazuje jako vyřízená („ISIN doplněn — nahraj výpis znovu…“), a když
 * je JISTÉ, že tentýž soubor se už nahrál znovu s doplněným ISIN, nezobrazuje
 * se vůbec.
 *
 * Vazbu hláška → symbol nese parser strukturovaně (`RowIssue.unmappedSymbol`),
 * text hlášky se nečte. Dávky uložené dřív ten údaj nemají a ukazují se
 * beze změny — nic z nich nezmizí potichu.
 *
 * „Jisté“ znamená obojí naráz: novější dávka téhož brokera se STEJNÝM
 * otiskem souboru (`fileHash`) symbol už v seznamu k doplnění nemá, A v
 * databázi opravdu leží transakce brokera (obchody, resp. dividendy) pod ISIN
 * ze záznamu V DÁVKÁCH TOHOTO SOUBORU. Samotná novější dávka nestačí — tu,
 * která obchody uložila, mohl uživatel vrátit zpět (revize R1) — a obchod
 * z jiného výpisu nedokazuje nic (revize N3). Jiný soubor (navazující období) nic
 * nedokazuje — u něj zůstává věta o novém nahrání.
 */

/** Dávka historie tak, jak ji čte tahle logika (výřez řádku `import_batches`). */
export interface BatchForIssues {
  id: string;
  broker: string;
  errorCount: number;
  warningCount: number;
  issues: unknown;
  createdAt: Date;
}

/** Má uživatel k symbolu u brokera záznam v číselníku, který import použije? */
export type AliasCovers = (broker: string, symbol: string) => boolean;

/**
 * Leží v databázi transakce brokera pod ISIN, který k symbolu vede číselník,
 * a to v některé z daných dávek? `trade` = obchody a ostatní pohyby,
 * `dividend` = dividendy.
 */
export type StoredUnderAlias = (
  broker: string,
  symbol: string,
  kind: 'trade' | 'dividend',
  batchIds: readonly string[],
) => boolean;

export interface BatchIssueView {
  /** Chyby a varování k zobrazení — bez hlášek vyřízených číselníkem. */
  errors: RowIssue[];
  warnings: RowIssue[];
  /** Počty pro souhrn dávky — úplné počty ze sloupců mínus vyřízené hlášky. */
  errorCount: number;
  warningCount: number;
  /** Symboly s doplněným ISIN, jejichž obchody čekají na nové nahrání výpisu. */
  pendingTrades: string[];
  /** Symboly jen s dividendami, které ISIN dostanou po novém nahrání. */
  pendingDividends: string[];
}

interface UnmappedEntry {
  symbol: string;
}

const storedIssues = (batch: BatchForIssues): StoredIssues<UnmappedEntry> =>
  (batch.issues ?? {}) as StoredIssues<UnmappedEntry>;

/**
 * Symbol v novější dávce téhož souboru čekat na číselník přestal. Seznam
 * `unmapped` je na to spolehlivější než hlášky (ty se ukládají jen prvních
 * sto) — a když se ani on celý neuložil, jistota není.
 */
function resolvedBy(newer: BatchForIssues, symbol: string): boolean {
  const issues = storedIssues(newer);
  if (issues.truncated?.includes('unmapped')) return false;
  return !(issues.unmapped ?? []).some((item) => item.symbol === symbol);
}

export function batchIssueView(
  batch: BatchForIssues,
  allBatches: readonly BatchForIssues[],
  covers: AliasCovers,
  /** Bez něj se vyřízená hláška nikdy neschová úplně (jen „ISIN doplněn…“). */
  stored: StoredUnderAlias = () => false,
): BatchIssueView {
  const issues = storedIssues(batch);
  const errors = issues.errors ?? [];
  const warnings = issues.warnings ?? [];
  const resolved = (issue: RowIssue): boolean =>
    issue.unmappedSymbol !== undefined && covers(batch.broker, issue.unmappedSymbol);

  const sameFileLater = issues.fileHash
    ? allBatches.filter(
        (other) =>
          other.id !== batch.id &&
          other.broker === batch.broker &&
          other.createdAt > batch.createdAt &&
          storedIssues(other).fileHash === issues.fileHash,
      )
    : [];
  // Novější dávka téhož souboru sama nestačí: tu, která obchody uložila, mohl
  // uživatel vrátit a zůstala jen ta se samými duplicitami (revize R1).
  // Schovat se smí jen to, co v databázi opravdu leží.
  // Důkazem jsou jen transakce v dávkách TÉHOŽ souboru: obchod stejného
  // titulu z jiného výpisu neříká nic o tom, jestli se uložily obchody tohohle
  // (revize N3). Vlastní dávka se počítá taky — dividenda, které se ISIN
  // doplnil povýšením klíče, v ní zůstává.
  const reimported = (symbol: string, kind: 'trade' | 'dividend'): boolean => {
    const proving = sameFileLater.filter((later) => resolvedBy(later, symbol));
    return (
      proving.length > 0 &&
      stored(batch.broker, symbol, kind, [batch.id, ...proving.map((later) => later.id)])
    );
  };

  const tradeSymbols = new Set<string>();
  const dividendSymbols = new Set<string>();
  for (const issue of errors) if (resolved(issue)) tradeSymbols.add(issue.unmappedSymbol!);
  for (const issue of warnings) if (resolved(issue)) dividendSymbols.add(issue.unmappedSymbol!);

  const shownErrors = errors.filter((issue) => !resolved(issue));
  const shownWarnings = warnings.filter((issue) => !resolved(issue));
  // Kolik hlášek vyřízení ubírá: podle počtů per symbol z celého seznamu
  // (uložená je jen část, `MAX_STORED_ISSUES`), u starších dávek bez nich
  // jen ty uložené.
  const resolvedCount = (
    list: readonly RowIssue[],
    shown: readonly RowIssue[],
    counts: Record<string, number> | undefined,
  ): number => {
    if (!counts) return list.length - shown.length;
    return Object.entries(counts)
      .filter(([symbol]) => covers(batch.broker, symbol))
      .reduce((sum, [, count]) => sum + count, 0);
  };
  return {
    errors: shownErrors,
    warnings: shownWarnings,
    errorCount: Math.max(
      0,
      batch.errorCount - resolvedCount(errors, shownErrors, issues.unmappedCounts?.errors),
    ),
    warningCount: Math.max(
      0,
      batch.warningCount - resolvedCount(warnings, shownWarnings, issues.unmappedCounts?.warnings),
    ),
    pendingTrades: [...tradeSymbols].filter((symbol) => !reimported(symbol, 'trade')),
    pendingDividends: [...dividendSymbols].filter(
      (symbol) => !tradeSymbols.has(symbol) && !reimported(symbol, 'dividend'),
    ),
  };
}

/** Pohled na hlášky všech dávek naráz (stránka /import). */
export function batchIssueViews(
  batches: readonly BatchForIssues[],
  covers: AliasCovers,
  stored: StoredUnderAlias,
): Map<string, BatchIssueView> {
  return new Map(
    batches.map((batch) => [batch.id, batchIssueView(batch, batches, covers, stored)]),
  );
}
