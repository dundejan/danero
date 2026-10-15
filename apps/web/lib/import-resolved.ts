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
 * „Jisté“ znamená: novější dávka téhož brokera se STEJNÝM otiskem souboru
 * (`fileHash`) a symbol už v jejím seznamu k doplnění není. Tentýž soubor se
 * čte deterministicky, takže jeho obchody s tím symbolem se tehdy buď uložily,
 * nebo už uložené byly. Jiný soubor (navazující období) to dokázat neumí —
 * u něj zůstává věta o novém nahrání.
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
  const reimported = (symbol: string): boolean =>
    sameFileLater.some((later) => resolvedBy(later, symbol));

  const tradeSymbols = new Set<string>();
  const dividendSymbols = new Set<string>();
  for (const issue of errors) if (resolved(issue)) tradeSymbols.add(issue.unmappedSymbol!);
  for (const issue of warnings) if (resolved(issue)) dividendSymbols.add(issue.unmappedSymbol!);

  const shownErrors = errors.filter((issue) => !resolved(issue));
  const shownWarnings = warnings.filter((issue) => !resolved(issue));
  return {
    errors: shownErrors,
    warnings: shownWarnings,
    errorCount: Math.max(0, batch.errorCount - (errors.length - shownErrors.length)),
    warningCount: Math.max(0, batch.warningCount - (warnings.length - shownWarnings.length)),
    pendingTrades: [...tradeSymbols].filter((symbol) => !reimported(symbol)),
    pendingDividends: [...dividendSymbols].filter(
      (symbol) => !tradeSymbols.has(symbol) && !reimported(symbol),
    ),
  };
}

/** Pohled na hlášky všech dávek naráz (stránka /import). */
export function batchIssueViews(
  batches: readonly BatchForIssues[],
  covers: AliasCovers,
): Map<string, BatchIssueView> {
  return new Map(batches.map((batch) => [batch.id, batchIssueView(batch, batches, covers)]));
}
