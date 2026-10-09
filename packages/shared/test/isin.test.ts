import { describe, expect, it } from 'vitest';
import { isValidIsin } from '../src/isin';

describe('isValidIsin — kontrolní číslice ISIN podle ISO 6166', () => {
  it('platné ISIN projdou (číslice i písmena v národní části)', () => {
    expect(isValidIsin('US0378331005')).toBe(true);
    expect(isValidIsin('US5949181045')).toBe(true);
    expect(isValidIsin('IE00B4L5Y983')).toBe(true);
    expect(isValidIsin('CZ0005112300')).toBe(true);
    expect(isValidIsin('DE000BAY0017')).toBe(true);
  });

  it('špatná kontrolní číslice neprojde', () => {
    expect(isValidIsin('US0378331006')).toBe(false);
  });

  it('přehozené sousední číslice neprojdou — přesně ten překlep má číslice chytit', () => {
    expect(isValidIsin('US0378313005')).toBe(false);
    expect(isValidIsin('US1912161070')).toBe(false);
    expect(isValidIsin('US1912161007')).toBe(true);
  });

  it('překlep v písmenu národní části neprojde', () => {
    expect(isValidIsin('IE00B4L5Y983')).toBe(true);
    expect(isValidIsin('IE00B4L5X983')).toBe(false);
  });

  it('špatný tvar neprojde bez ohledu na součet', () => {
    expect(isValidIsin('')).toBe(false);
    expect(isValidIsin('US037833100')).toBe(false);
    expect(isValidIsin('US03783310055')).toBe(false);
    expect(isValidIsin('us0378331005')).toBe(false);
    expect(isValidIsin(' US0378331005')).toBe(false);
    expect(isValidIsin('1S0378331005')).toBe(false);
    expect(isValidIsin('US037833100A')).toBe(false);
  });

  it('náhradní identifikátory šablony (CFD, krypto) ISIN nejsou', () => {
    expect(isValidIsin('CFD:US500')).toBe(false);
    expect(isValidIsin('CRYPTO:BTC')).toBe(false);
  });
});
