import { describe, expect, it } from 'vitest';
import { reconcilePositions, suggestSplitRatio } from '../src';
import { d } from '@danero/shared';

describe('rekonciliace pozic (vypočtené vs. broker)', () => {
  it('shodné pozice → ok', () => {
    const report = reconcilePositions(
      [{ isin: 'US0378331005', quantity: '10' }],
      [{ isin: 'US0378331005', quantity: 10 }],
    );
    expect(report.ok).toBe(true);
    expect(report.matchedIsins).toEqual(['US0378331005']);
  });

  it('nesoulad množství → návrh poměru splitu (chybějící korporátní akce)', () => {
    const report = reconcilePositions(
      [{ isin: 'US0378331005', quantity: '10' }],
      [{ isin: 'US0378331005', quantity: '20' }],
    );
    expect(report.ok).toBe(false);
    const issue = report.issues[0]!;
    expect(issue.kind).toBe('QUANTITY_MISMATCH');
    expect(issue.suggestedSplitRatio).toEqual({ from: '1', to: '2' }); // split 2:1
  });

  it('reverse split a necelé poměry', () => {
    expect(suggestSplitRatio(d('20'), d('5'))).toEqual({ from: '4', to: '1' }); // 1:4
    expect(suggestSplitRatio(d('10'), d('15'))).toEqual({ from: '2', to: '3' }); // 3:2
    expect(suggestSplitRatio(d('10'), d('13'))).toBeUndefined(); // 13:10 není reálný split
  });

  it('pozice jen u brokera / jen lokálně', () => {
    const report = reconcilePositions(
      [{ isin: 'CZ0000000001', quantity: '5' }],
      [{ isin: 'US0378331005', quantity: '7' }],
    );
    const kinds = report.issues.map((i) => i.kind).sort();
    expect(kinds).toEqual(['MISSING_AT_BROKER', 'MISSING_LOCALLY']);
  });

  it('agreguje více lotů téhož ISIN', () => {
    const report = reconcilePositions(
      [
        { isin: 'US0378331005', quantity: '4' },
        { isin: 'US0378331005', quantity: '6' },
      ],
      [{ isin: 'US0378331005', quantity: '10' }],
    );
    expect(report.ok).toBe(true);
  });
});
