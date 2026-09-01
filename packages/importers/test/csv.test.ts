import { describe, expect, it } from 'vitest';
import {
  cleanNumber,
  decodeUpload,
  firstLine,
  isAmbiguousThousandGroup,
  isAmbiguousThousands,
  isValidIsoDate,
  parseCsv,
} from '../src/csv';

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

describe('isAmbiguousThousandGroup (B-3-12)', () => {
  it('jedno trojčíslí za tečkou i za čárkou je nerozhodnutelné', () => {
    expect(isAmbiguousThousandGroup('1,000')).toBe(true);
    expect(isAmbiguousThousandGroup('1.000')).toBe(true);
    expect(isAmbiguousThousandGroup('-999,000')).toBe(true);
  });

  /**
   * R2-N1: tisíce se s vedoucí nulou nepíšou, takže oddělovač je jistě
   * desetinný. Dokud to bylo „nerozhodnutelné“, četl Revolut `0,125`
   * v anglicky lokalizovaném výpisu jako `0125`, tedy 125 kusů.
   */
  it('vedoucí nula v celé části tisícové oddělování vylučuje', () => {
    expect(isAmbiguousThousandGroup('0,125')).toBe(false);
    expect(isAmbiguousThousandGroup('0.125')).toBe(false);
    expect(isAmbiguousThousandGroup('-0,125')).toBe(false);
    expect(isAmbiguousThousandGroup('01,234')).toBe(false);
  });
});

describe('firstLine', () => {
  it('bere první řádek u LF i CRLF', () => {
    expect(firstLine('a,b\n1,2\n3,4')).toBe('a,b');
    expect(firstLine('a,b\r\n1,2')).toBe('a,b');
  });

  /**
   * Starší Excel pro Mac ukládá CSV se samotnými `\r`. Bez téhle větve by
   * „hlavička“ byl celý soubor — a ta se vypisuje uživateli do hlášky
   * „v hlavičce jsme našli…“ i provozovateli do upozornění o nepřečteném
   * výpisu, takže by se do nich obtiskly obchody.
   */
  it('bere první řádek i u souboru bez LF (Excel pro Mac)', () => {
    expect(firstLine('a,b\r1,2\r3,4')).toBe('a,b');
  });

  it('soubor o jediném řádku vrací celý', () => {
    expect(firstLine('a,b')).toBe('a,b');
  });
});

/**
 * Kódování nahraného souboru (K6a-10, K6a-11).
 *
 * Bajty jsou psané ručně schválně: `Buffer.from(…, 'latin1')` ani žádná
 * knihovna windows-1250 neumí, a hlavně je na nich vidět přesně to, co doráží
 * z Excelu — `Č` je v CP1250 jediný bajt `0xC8`, který jako UTF-8 platný není.
 */
describe('decodeUpload', () => {
  /** `ČEZ a.s.` ve windows-1250 (`Č` = 0xC8). */
  const CEZ_CP1250 = Uint8Array.from([0xc8, 0x45, 0x5a, 0x20, 0x61, 0x2e, 0x73, 0x2e]);

  it('UTF-8 (i s BOM) nechá být — tak přichází drtivá většina výpisů', () => {
    expect(decodeUpload(new TextEncoder().encode('name,qty\nČEZ a.s.,10'))).toBe(
      'name,qty\nČEZ a.s.,10',
    );
    const withBom = Uint8Array.from([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('a,b')]);
    expect(decodeUpload(withBom)).toBe('a,b');
  });

  it('windows-1250 s ASCII hlavičkou pozná podle neplatného UTF-8', () => {
    const bytes = Uint8Array.from([...new TextEncoder().encode('name\n'), ...CEZ_CP1250]);
    expect(decodeUpload(bytes)).toBe('name\nČEZ a.s.');
  });

  it('UTF-16 podle BOM (LE i BE) — takhle ukládá CSV Excel „Unicode text“', () => {
    const text = 'Action,Time\nMarket buy,2026-01-02';
    const le = Uint8Array.from([0xff, 0xfe, ...Buffer.from(text, 'utf16le')]);
    const be = Uint8Array.from([0xfe, 0xff, ...Buffer.from(text, 'utf16le').swap16()]);
    expect(decodeUpload(le)).toBe(text);
    expect(decodeUpload(be)).toBe(text);
  });

  /**
   * Náhradní znak zapsaný v UTF-8 je PLATNÁ sekvence — soubor se proto nesmí
   * celý předekódovat na windows-1250. Přesně tohle hlídala původní podmínka
   * „hlavička obsahuje U+FFFD“, jen za cenu tiché vady v datech (K6a-11).
   */
  it('legitimní U+FFFD uvnitř UTF-8 souboru nepřepne kódování', () => {
    const text = 'name\nnějaká � firma,ČEZ';
    expect(decodeUpload(new TextEncoder().encode(text))).toBe(text);
  });
});
