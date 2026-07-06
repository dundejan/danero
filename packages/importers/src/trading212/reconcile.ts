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
    if (exp.eq(act)) {
      if (exp.gt(0)) matchedIsins.push(isin);
      continue;
    }
    if (exp.lte(0)) {
      issues.push({ kind: 'MISSING_LOCALLY', isin, expectedQuantity: exp, brokerQuantity: act });
      continue;
    }
    if (act.lte(0)) {
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
