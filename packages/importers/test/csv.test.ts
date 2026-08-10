import { describe, expect, it } from 'vitest';
import { cleanNumber, isAmbiguousThousands, isValidIsoDate, parseCsv } from '../src/csv';

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

describe('pomocníci pro evropské formáty (sdílené parserovými moduly)', () => {
  it('parseCsv s volitelným oddělovačem (středník, tabulátor)', async () => {
    const { parseCsv } = await import('../src/csv');
    expect(parseCsv('a;b;c\n1;"x;y";3', ';').rows).toEqual([['1', 'x;y', '3']]);
    expect(parseCsv('a\tb\n1\t2', '\t').rows).toEqual([['1', '2']]);
  });

  it('cleanNumberEu: desetinná čárka, mezery i německé tisícové tečky', async () => {
    const { cleanNumberEu } = await import('../src/csv');
    expect(cleanNumberEu('1 234,56')).toBe('1234.56');
    expect(cleanNumberEu('1.234,56')).toBe('1234.56');
    expect(cleanNumberEu('-0,5')).toBe('-0.5');
    expect(cleanNumberEu('1234')).toBe('1234');
    expect(cleanNumberEu('1 234,5')).toBe('1234.5');
  });

  it('parseEuroDate: tečkové, lomítkové i ISO tvary, čas se zahodí, nesmysly null', async () => {
    const { parseEuroDate } = await import('../src/csv');
    expect(parseEuroDate('31.12.2025')).toBe('2025-12-31');
    expect(parseEuroDate('31. 12. 2025')).toBe('2025-12-31');
    expect(parseEuroDate('1.2.2025 14:35')).toBe('2025-02-01');
    expect(parseEuroDate('31/12/2025')).toBe('2025-12-31');
    expect(parseEuroDate('2025-12-31T10:00:00Z')).toBe('2025-12-31');
    expect(parseEuroDate('2025-12-31 10:00')).toBe('2025-12-31');
    expect(parseEuroDate('32.1.2025')).toBeNull();
    expect(parseEuroDate('2025-13-01')).toBeNull();
    expect(parseEuroDate('nesmysl')).toBeNull();
  });

  it('normalizeHeader: trim, lowercase, bez diakritiky', async () => {
    const { normalizeHeader } = await import('../src/csv');
    expect(normalizeHeader('  Čas Otevření ')).toBe('cas otevreni');
  });
});

describe('isAmbiguousThousands (B-3-12)', () => {
  it('jedno trojčíslí bez desetinné tečky je nerozhodnutelné', () => {
    expect(isAmbiguousThousands('7,848')).toBe(true);
    expect(isAmbiguousThousands('-1,000')).toBe(true);
    expect(isAmbiguousThousands(' 12,345 ')).toBe(true);
  });

  it('víc trojčíslí nebo desetinná tečka nejednoznačné nejsou', () => {
    expect(isAmbiguousThousands('1,234,567')).toBe(false);
    expect(isAmbiguousThousands('1,234.56')).toBe(false);
    expect(isAmbiguousThousands('12.5')).toBe(false);
    expect(isAmbiguousThousands('7848')).toBe(false);
    // čtyři číslice za čárkou nejsou tisícové trojčíslí
    expect(isAmbiguousThousands('7,8480')).toBe(false);
  });
});
