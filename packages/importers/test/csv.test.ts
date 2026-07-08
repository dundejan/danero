import { describe, expect, it } from 'vitest';
import { cleanNumber, isValidIsoDate, parseCsv } from '../src/csv';

describe('RFC 4180 CSV parser', () => {
  it('parsuje uvozovky, čárky a nové řádky uvnitř polí', () => {
    const { headers, rows } = parseCsv('a,b,c\n"x,1","řádek\nuvnitř","escaped ""quote"""\n');
    expect(headers).toEqual(['a', 'b', 'c']);
    expect(rows).toEqual([['x,1', 'řádek\nuvnitř', 'escaped "quote"']]);
  });

  it('zvládá BOM, CRLF a prázdné řádky na konci', () => {
    const { headers, rows } = parseCsv('﻿a,b\r\n1,2\r\n,\r\n');
    expect(headers).toEqual(['a', 'b']);
    expect(rows).toEqual([['1', '2']]);
  });

  it('cleanNumber odstraní tisícové čárky, ale nezničí desetinnou tečku', () => {
    expect(cleanNumber('1,234.56')).toBe('1234.56');
    expect(cleanNumber('185.50')).toBe('185.50');
    expect(cleanNumber('-2,000')).toBe('-2000');
    expect(cleanNumber('12,34')).toBe('12,34'); // nejednoznačné — neupravovat
  });

  it('isValidIsoDate: kalendářní kontrola, ne jen regex', () => {
    expect(isValidIsoDate('2025-01-31')).toBe(true);
    expect(isValidIsoDate('2024-02-29')).toBe(true); // přestupný rok
    expect(isValidIsoDate('2025-02-29')).toBe(false); // nepřestupný rok
    expect(isValidIsoDate('2025-13-31')).toBe(false); // neexistující měsíc
    expect(isValidIsoDate('2025-04-31')).toBe(false); // neexistující den
    expect(isValidIsoDate('2025-00-10')).toBe(false);
    expect(isValidIsoDate('25-01-31')).toBe(false); // špatný formát
    expect(isValidIsoDate('2025-1-31')).toBe(false);
  });
});
