import type { RowIssue } from '@danero/importers';
import type { StoredFilled } from '@/lib/alias-feedback';

/**
 * Co si dávka importu ukládá do `import_batches.issues` (L8b-02).
 *
 * Parser vrací hlášku ke každému vadnému řádku a hláška smí citovat buňku.
 * Uložené celé to u výpisu s tisíci vadnými řádky (nebo s jednou obří buňkou)
 * nechalo v historii megabajty JSON, které stránka /import i export načítají
 * najednou. Ukládá se proto jen začátek každého seznamu a každý text nejvýš
 * do pevné délky; celkové počty dál nesou sloupce `error_count`,
 * `skipped_count` a `warning_count`. Souhrn vrácený hned po nahrání se nekrátí.
 */

/** Nejvýš tolik chyb, přeskočených řádků, varování a shod s jiným brokerem. */
export const MAX_STORED_ISSUES = 100;
/** Symboly k doplnění: z nich /import skládá výzvu číselníku, proto štědřeji. */
export const MAX_STORED_UNMAPPED = 500;
/** Nejvýš tolik znaků jedné hlášky (a jednoho citovaného řádku). */
export const MAX_STORED_TEXT = 500;
/** Delší symbol není symbol, ale rozbitá buňka. */
const MAX_STORED_SYMBOL = 100;

export type IssueList = 'errors' | 'skipped' | 'warnings' | 'unmapped' | 'crossBroker';

export interface StoredIssues<U = unknown> {
  errors: RowIssue[];
  skipped: RowIssue[];
  warnings: RowIssue[];
  unmapped?: U[];
  crossBroker?: string[];
  /** Seznamy, ze kterých se neuložilo všechno — úplné počty jsou ve sloupcích dávky. */
  truncated?: IssueList[];
  /**
   * Otisk nahraného souboru (SHA-256 obsahu). Podle něj historie pozná, že
   * uživatel TENTÝŽ výpis nahrál znovu — a hlášky o chybějícím ISIN, které
   * nové nahrání vyřídilo, u staré dávky už neukazuje (`lib/import-resolved.ts`).
   */
  fileHash?: string;
  /**
   * Symboly, kterým import doplnil ISIN z vestavěného číselníku — historie
   * a hláška po nahrání je vyjmenují (`FilledInstrument` z lib/instrument-aliases).
   */
  filled?: StoredFilled[];
  /**
   * Kolik hlášek „doplň ISIN“ připadá na který symbol — spočítané z CELÝCH
   * seznamů před oříznutím. Historie podle toho odečte vyřízené hlášky
   * i tehdy, když se uložila jen část (`MAX_STORED_ISSUES`).
   */
  unmappedCounts?: { errors: Record<string, number>; warnings: Record<string, number> };
}

const clip = (text: string): string =>
  text.length <= MAX_STORED_TEXT ? text : `${text.slice(0, MAX_STORED_TEXT - 1)}…`;

const clipIssue = ({ unmappedSymbol, ...issue }: RowIssue): RowIssue => ({
  ...issue,
  message: clip(issue.message),
  ...(issue.raw === undefined ? {} : { raw: clip(issue.raw) }),
  // zkrácený symbol by se s číselníkem nespároval — hláška pak zůstane vidět
  ...(unmappedSymbol !== undefined && unmappedSymbol.length <= MAX_STORED_SYMBOL
    ? { unmappedSymbol }
    : {}),
});

/** Počty hlášek per symbol (`StoredIssues.unmappedCounts`); prázdný objekt, když žádné nejsou. */
function unmappedCountsOf(
  errors: readonly RowIssue[],
  warnings: readonly RowIssue[],
): Pick<StoredIssues, 'unmappedCounts'> {
  const count = (list: readonly RowIssue[]): Record<string, number> => {
    const counts = new Map<string, number>();
    for (const issue of list) {
      const symbol = issue.unmappedSymbol;
      if (symbol === undefined || symbol.length > MAX_STORED_SYMBOL) continue;
      counts.set(symbol, (counts.get(symbol) ?? 0) + 1);
    }
    // fromEntries zakládá vlastní klíče — i symbol „__proto__“ zůstane daty
    return Object.fromEntries(counts);
  };
  const result = { errors: count(errors), warnings: count(warnings) };
  return Object.keys(result.errors).length + Object.keys(result.warnings).length > 0
    ? { unmappedCounts: result }
    : {};
}

export function capStoredIssues<U extends { symbol: string }>(issues: {
  errors: RowIssue[];
  skipped: RowIssue[];
  warnings: RowIssue[];
  unmapped: U[];
  crossBroker: string[];
  fileHash?: string;
  filled?: StoredFilled[];
}): StoredIssues<U> {
  // zkrácený symbol by se s výpisem už nikdy nespároval — raději ho vynechat
  const symbols = issues.unmapped.filter((item) => item.symbol.length <= MAX_STORED_SYMBOL);
  const unmapped = symbols.slice(0, MAX_STORED_UNMAPPED);
  const crossBroker = issues.crossBroker.slice(0, MAX_STORED_ISSUES).map(clip);
  const truncated: IssueList[] = [];
  for (const list of ['errors', 'skipped', 'warnings', 'crossBroker'] as const) {
    if (issues[list].length > MAX_STORED_ISSUES) truncated.push(list);
  }
  if (unmapped.length < issues.unmapped.length) {
    truncated.splice(Math.min(3, truncated.length), 0, 'unmapped');
  }
  return {
    errors: issues.errors.slice(0, MAX_STORED_ISSUES).map(clipIssue),
    skipped: issues.skipped.slice(0, MAX_STORED_ISSUES).map(clipIssue),
    warnings: issues.warnings.slice(0, MAX_STORED_ISSUES).map(clipIssue),
    ...(unmapped.length > 0 ? { unmapped } : {}),
    ...(crossBroker.length > 0 ? { crossBroker } : {}),
    ...(truncated.length > 0 ? { truncated } : {}),
    ...(issues.fileHash ? { fileHash: issues.fileHash } : {}),
    ...unmappedCountsOf(issues.errors, issues.warnings),
    ...(issues.filled?.length
      ? {
          filled: issues.filled.slice(0, MAX_STORED_UNMAPPED).map((item) => ({
            ...item,
            name: clip(item.name),
          })),
        }
      : {}),
  };
}
