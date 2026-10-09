import type { RowIssue } from '@danero/importers';

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
}

const clip = (text: string): string =>
  text.length <= MAX_STORED_TEXT ? text : `${text.slice(0, MAX_STORED_TEXT - 1)}…`;

const clipIssue = (issue: RowIssue): RowIssue => ({
  ...issue,
  message: clip(issue.message),
  ...(issue.raw === undefined ? {} : { raw: clip(issue.raw) }),
});

export function capStoredIssues<U extends { symbol: string }>(issues: {
  errors: RowIssue[];
  skipped: RowIssue[];
  warnings: RowIssue[];
  unmapped: U[];
  crossBroker: string[];
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
  };
}
