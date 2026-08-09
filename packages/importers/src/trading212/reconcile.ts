import { d, Decimal, ZERO, type Money } from '@danero/shared';

/**
 * Rekonciliace pozic (docs/03): T212 export neobsahuje korporátní akce, takže po
 * splitu/změně ISIN nesedí vypočtené pozice s realitou. Porovnáním s pozicemi
 * z API odhalíme chybějící akce a rovnou navrhneme poměr splitu.
 */
export interface QuantityByIsin {
  isin: string;
  quantity: Decimal.Value;
}

export type ReconciliationIssueKind =
  | 'QUANTITY_MISMATCH'
  | 'MISSING_AT_BROKER'
  | 'MISSING_LOCALLY';

export interface ReconciliationIssue {
  kind: ReconciliationIssueKind;
  isin: string;
  expectedQuantity: Money;
  brokerQuantity: Money;
  /** Návrh poměru korporátní akce SPLIT (from → to), pokud rozdíl odpovídá malému zlomku. */
  suggestedSplitRatio?: { from: string; to: string };
}

export interface ReconciliationReport {
  ok: boolean;
  matchedIsins: string[];
  issues: ReconciliationIssue[];
}

const aggregate = (items: QuantityByIsin[]): Map<string, Money> => {
  const map = new Map<string, Money>();
  for (const item of items) {
    map.set(item.isin, (map.get(item.isin) ?? ZERO).plus(d(item.quantity)));
  }
  return map;
};

/**
 * Tolerance porovnání počtu kusů (B-3-4).
 *
 * Broker posílá množství jako JSON číslo, tedy IEEE-754 double
 * (`Trading212Position.quantity: number`), zatímco my sčítáme jednotlivé fill-y
 * Decimalem. Součet TÝCHŽ 891 reálných fill-ů se takhle rozešel u 34 ze 114
 * ISINů a dvě uzavřené pozice vyšly 1,11e-16 a 3,47e-18 místo nuly — z čehož
 * `exp.eq(act)` udělal falešné „chybí u brokera“ a rekonciliace pak nabízela
 * neexistující korporátní akci.
 *
 * Chyba double roste s velikostí čísla (drží ~15–16 platných číslic), takže
 * tolerance musí být RELATIVNÍ; 1e-9 je o šest řádů nad chybou double a pořád
 * hluboko pod nejmenším množstvím, které broker eviduje (zlomky akcií mají
 * ~7 desetinných míst). Absolutní podlaha řeší pozice kolem nuly, kde relativní
 * tolerance vyjde nula. Stejnou hodnotu používá `suggestSplitRatio`.
 */
const RELATIVE_TOLERANCE = d('1e-9');
const ABSOLUTE_TOLERANCE = d('1e-9');

const closeEnough = (a: Money, b: Money): boolean =>
  a.sub(b).abs().lte(Decimal.max(a.abs(), b.abs()).mul(RELATIVE_TOLERANCE).plus(ABSOLUTE_TOLERANCE));

/** Pozice, kterou lze považovat za uzavřenou (viz tolerance výš). */
const isClosed = (v: Money): boolean => v.lte(ABSOLUTE_TOLERANCE);

export function reconcilePositions(
  computed: QuantityByIsin[],
  broker: QuantityByIsin[],
): ReconciliationReport {
  const expected = aggregate(computed);
  const actual = aggregate(broker);
  const isins = new Set([...expected.keys(), ...actual.keys()]);

  const matchedIsins: string[] = [];
  const issues: ReconciliationIssue[] = [];

  for (const isin of [...isins].sort()) {
    const exp = expected.get(isin) ?? ZERO;
    const act = actual.get(isin) ?? ZERO;
    if (closeEnough(exp, act)) {
      if (!isClosed(exp)) matchedIsins.push(isin);
      continue;
    }
    if (isClosed(exp)) {
      issues.push({ kind: 'MISSING_LOCALLY', isin, expectedQuantity: exp, brokerQuantity: act });
      continue;
    }
    if (isClosed(act)) {
      issues.push({ kind: 'MISSING_AT_BROKER', isin, expectedQuantity: exp, brokerQuantity: act });
      continue;
    }
    issues.push({
      kind: 'QUANTITY_MISMATCH',
      isin,
      expectedQuantity: exp,
      brokerQuantity: act,
      suggestedSplitRatio: suggestSplitRatio(exp, act),
    });
  }

  return { ok: issues.length === 0, matchedIsins, issues };
}

/**
 * Najde nejmenší poměr p:q (p, q ≤ 10 — reálné splity), pro který
 * broker ≈ vypočtené × p/q. Sémantika CORPORATE_ACTION SPLIT: remaining × to/from
 * → to = p, from = q. Divoké poměry (13:10…) nenavrhujeme — spíš chybí transakce.
 */
export function suggestSplitRatio(
  expected: Money,
  actual: Money,
): { from: string; to: string } | undefined {
  for (let total = 3; total <= 20; total += 1) {
    for (let p = 1; p < total; p += 1) {
      const q = total - p;
      if (p === q || p > 10 || q > 10) continue;
      if (gcd(p, q) !== 1) continue;
      const candidate = expected.mul(p).div(q);
      const tolerance = actual.mul('1e-9').abs();
      if (candidate.sub(actual).abs().lte(tolerance)) {
        return { from: String(q), to: String(p) };
      }
    }
  }
  return undefined;
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
