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

  /**
   * B-3-4: množství od brokera je JSON číslo (double), naše je součet fill-ů
   * Decimalem. Na reálném účtu se ty dva součty rozešly u 34 ze 114 ISINů
   * a uzavřené pozice vyšly 1,11e-16 místo nuly — z čehož přesné `eq` udělalo
   * falešné „chybí u brokera“ a rekonciliace navrhla neexistující split.
   */
  it('zbytek po sčítání doublem (1,11e-16) není rozdíl pozice', () => {
    // přesně to, co vyrobí JS: 0.1 + 0.2 - 0.3 = 5.55e-17
    const zbytek = 0.1 + 0.2 - 0.3;
    expect(zbytek).not.toBe(0);
    const report = reconcilePositions(
      [{ isin: 'US0378331005', quantity: '0' }],
      [{ isin: 'US0378331005', quantity: zbytek }],
    );
    expect(report.issues).toEqual([]);
    // uzavřená pozice se ani netváří jako spárovaná držba
    expect(report.matchedIsins).toEqual([]);
  });

  it('tolerance roste s velikostí pozice, ale skutečný rozdíl neschová', () => {
    const velka = reconcilePositions(
      [{ isin: 'US0378331005', quantity: '1234.5678901' }],
      // chyba double na 16. platné číslici
      [{ isin: 'US0378331005', quantity: 1234.5678901 + 1e-9 }],
    );
    expect(velka.ok).toBe(true);

    // chybějící tisícina kusu (zlomkové akcie) se pořád musí ozvat
    const skutecny = reconcilePositions(
      [{ isin: 'US0378331005', quantity: '1234.5678901' }],
      [{ isin: 'US0378331005', quantity: '1234.5668901' }],
    );
    expect(skutecny.issues[0]!.kind).toBe('QUANTITY_MISMATCH');
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
