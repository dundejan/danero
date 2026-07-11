import { describe, expect, it } from 'vitest';
import { dedupeTransactions, UNIVERSAL_TEMPLATE_CSV } from '../src';
import { parsePortuCsv, PORTU_BROKER, sniffPortuCsv } from '../src/portu/csv';
import { DEGIRO_ACCOUNT_HEADER_CZ, DEGIRO_TRANSACTIONS_HEADER_CZ } from './fixtures/degiro';
import {
  PORTU_ASCII_FIXTURE,
  PORTU_EDGE_FIXTURE,
  PORTU_ERROR_FIXTURE,
  PORTU_FIXTURE,
  PORTU_HEADER,
} from './fixtures/portu';
import { T212_HEADER } from './fixtures/t212';

describe('Portu CSV parser', () => {
  it('happy path: BUY/SELL/DIVIDEND/FEE, vklad a forex přeskočené, neznámý typ error', () => {
    const result = parsePortuCsv(PORTU_FIXTURE);

    expect(result.broker).toBe(PORTU_BROKER);
    expect(result.transactions).toHaveLength(4);
    expect(result.transactions.map((t) => t.type).sort()).toEqual(
      ['BUY', 'DIVIDEND', 'FEE', 'SELL'].sort(),
    );
    expect(result.skipped).toHaveLength(3);
    expect(result.errors).toHaveLength(1);
    expect(result.warnings).toEqual([]);
  });

  it('BUY: frakční kusy, desetinná čárka, dd.MM.yyyy → ISO, name se NEBERE z Názvu (portfolio)', () => {
    const result = parsePortuCsv(PORTU_FIXTURE);

    const buy = result.transactions.find((t) => t.type === 'BUY');
    if (!buy || buy.type !== 'BUY') throw new Error('unreachable');
    expect(buy.id).toMatch(/^portu-[0-9a-f]{16}$/);
    expect(buy.isin).toBe('IE00BK5BQT80');
    expect(buy.ticker).toBe('VWCE');
    expect(buy.name).toBeUndefined(); // Název = jméno portfolia, ne instrumentu
    expect(buy.quantity.toString()).toBe('0.4823');
    expect(buy.pricePerShare.toString()).toBe('103.58');
    expect(buy.currency).toBe('EUR');
    expect(buy.tradeDate).toBe('2026-01-15');
    expect(buy.settlementDate).toBeUndefined(); // dopočítá engine
  });

  it('SELL: kladné kusy i kladná Hodnota (příjem)', () => {
    const result = parsePortuCsv(PORTU_FIXTURE);

    const sell = result.transactions.find((t) => t.type === 'SELL');
    if (!sell || sell.type !== 'SELL') throw new Error('unreachable');
    expect(sell.quantity.toString()).toBe('0.25');
    expect(sell.pricePerShare.toString()).toBe('110');
    expect(sell.currency).toBe('EUR');
    expect(sell.tradeDate).toBe('2026-02-20');
  });

  it('dividenda: gross z „Hrubá výše dividendy", srážka ze „Srážková daň", ne z čisté Hodnoty', () => {
    const result = parsePortuCsv(PORTU_FIXTURE);

    const dividend = result.transactions.find((t) => t.type === 'DIVIDEND');
    if (!dividend || dividend.type !== 'DIVIDEND') throw new Error('unreachable');
    expect(dividend.isin).toBe('IE00B5BMR087');
    expect(dividend.ticker).toBe('CSPX');
    expect(dividend.gross.toString()).toBe('14.53'); // hrubá výše, ne Hodnota 12,35
    expect(dividend.withholdingTax.toString()).toBe('2.18');
    expect(dividend.currency).toBe('USD');
    expect(dividend.date).toBe('2026-03-10');
  });

  it('poplatek: |Hodnota| + měna + popis jako poznámka', () => {
    const result = parsePortuCsv(PORTU_FIXTURE);

    const fee = result.transactions.find((t) => t.type === 'FEE');
    if (!fee || fee.type !== 'FEE') throw new Error('unreachable');
    expect(fee.amount.toString()).toBe('1.25');
    expect(fee.currency).toBe('EUR');
    expect(fee.date).toBe('2026-03-31');
    expect(fee.note).toBe('Poplatek za správu portfolia');
  });

  it('vklad a forex pár → skipped s vysvětlením (měnová konverze bez daňové události)', () => {
    const result = parsePortuCsv(PORTU_FIXTURE);

    expect(result.skipped.map((s) => s.line)).toEqual([6, 7, 8]);
    expect(result.skipped[0]!.message).toContain('převod peněz');
    const forex = result.skipped.filter((s) => s.message.includes('měnová konverze'));
    expect(forex).toHaveLength(2);
    expect(forex[0]!.message).toContain('bez daňové události');
    expect(forex[0]!.message).toContain('EUR/USD'); // měnový pár z Popisu
  });

  it('neznámý typ → error s DOSLOVNÝM zněním a poznámkou o odvozeném slovníku', () => {
    const result = parsePortuCsv(PORTU_FIXTURE);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.line).toBe(9);
    expect(result.errors[0]!.message).toContain('„Odměna"');
    expect(result.errors[0]!.message).toContain('nahlaš nám ho');
    expect(result.errors[0]!.message).toContain('odvozujeme');
  });

  it('chybějící Cena → jednotková cena z |Hodnota| / kusy (Decimal)', () => {
    const result = parsePortuCsv(PORTU_EDGE_FIXTURE);

    const buy = result.transactions.find((t) => t.type === 'BUY' && t.tradeDate === '2026-05-05');
    if (!buy || buy.type !== 'BUY') throw new Error('unreachable');
    expect(buy.quantity.toString()).toBe('0.5');
    expect(buy.pricePerShare.toString()).toBe('110'); // 55 / 0,5
  });

  it('dividenda bez hrubé výše → |Hodnota| jako gross + warning o čisté částce', () => {
    const result = parsePortuCsv(PORTU_EDGE_FIXTURE);

    const dividend = result.transactions.find((t) => t.type === 'DIVIDEND');
    if (!dividend || dividend.type !== 'DIVIDEND') throw new Error('unreachable');
    expect(dividend.gross.toString()).toBe('10');
    expect(dividend.withholdingTax.toString()).toBe('0');
    const warning = result.warnings.find((w) => w.line === 3);
    expect(warning?.message).toContain('čistá částka');
  });

  it('převod mezi portfolii → warning + skip (může jít o prodej)', () => {
    const result = parsePortuCsv(PORTU_EDGE_FIXTURE);

    const warning = result.warnings.find((w) => w.line === 4);
    expect(warning?.message).toContain('převod mezi portfolii');
    expect(warning?.message).toContain('prodej');
    // převod se neemituje jako transakce
    expect(result.transactions.filter((t) => t.type === 'TRANSFER_OUT')).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it('rozbitá diakritika v Typ („Nakup") → mapuje se stejně jako „Nákup"', () => {
    const result = parsePortuCsv(PORTU_EDGE_FIXTURE);

    const buy = result.transactions.find((t) => t.type === 'BUY' && t.tradeDate === '2026-05-08');
    if (!buy || buy.type !== 'BUY') throw new Error('unreachable');
    expect(buy.quantity.toString()).toBe('1.5');
    expect(buy.pricePerShare.toString()).toBe('104');
  });

  it('celý export bez diakritiky (hlavička i typy ASCII) se zpracuje beze změn', () => {
    const result = parsePortuCsv(PORTU_ASCII_FIXTURE);

    expect(result.errors).toEqual([]);
    expect(result.transactions).toHaveLength(1); // Nakup; Vyber a Forex nakup skipped
    expect(result.transactions[0]!.type).toBe('BUY');
    expect(result.skipped).toHaveLength(2);
  });

  it('chybové řádky: neplatné datum, chybějící kusy/ISIN/měna — s čísly řádků', () => {
    const result = parsePortuCsv(PORTU_ERROR_FIXTURE);

    expect(result.transactions).toEqual([]);
    expect(result.errors.map((e) => e.line)).toEqual([2, 3, 4, 5]);
    expect(result.errors[0]!.message).toContain('Neplatné datum');
    expect(result.errors[1]!.message).toContain('počet kusů');
    expect(result.errors[2]!.message).toContain('ISIN');
    expect(result.errors[3]!.message).toContain('měna');
  });

  it('prázdný soubor = prázdný výsledek, ne chyba (konzistentně s T212)', () => {
    for (const text of ['', '\n\n', '   ']) {
      const result = parsePortuCsv(text);
      expect(result.transactions).toEqual([]);
      expect(result.errors).toEqual([]);
      expect(result.skipped).toEqual([]);
      expect(result.warnings).toEqual([]);
    }
  });

  it('cizí soubor (T212) → srozumitelný error na řádku 1', () => {
    const result = parsePortuCsv(`${T212_HEADER}\nDeposit,2024-01-05 08:00:00,,,,,,,,,,100.00,CZK,,,,,,`);

    expect(result.transactions).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.line).toBe(1);
    expect(result.errors[0]!.message).toContain('nevypadá jako export transakcí z Portu');
  });

  it('dedupe-stabilita: dva parse téhož souboru = stejná id, opakovaný import = samé duplicity', () => {
    const first = parsePortuCsv(PORTU_FIXTURE);
    const second = parsePortuCsv(PORTU_FIXTURE);

    const firstIds = first.transactions.map((t) => t.id);
    expect(new Set(firstIds).size).toBe(firstIds.length);
    expect(firstIds.every((id) => id.startsWith('portu-'))).toBe(true);
    expect(second.transactions.map((t) => t.id)).toEqual(firstIds);

    const combined = dedupeTransactions(PORTU_BROKER, [
      ...first.transactions,
      ...second.transactions,
    ]);
    expect(combined.fresh).toHaveLength(4);
    expect(combined.duplicates).toBe(4);
  });

  it('identické legitimní řádky → odlišná stabilní id (pořadový suffix)', () => {
    const feeRow = '31.03.2026;Moje portfolio;Poplatek;;;;Poplatek za správu;;-1,25;EUR;;';
    const csv = [PORTU_HEADER, feeRow, feeRow].join('\n');

    const first = parsePortuCsv(csv);
    const second = parsePortuCsv(csv);

    const ids = first.transactions.map((t) => t.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2); // suffix -2 pro identický řádek
    expect(ids[1]).toBe(`${ids[0]}-2`);
    expect(second.transactions.map((t) => t.id)).toEqual(ids);
  });
});

describe('sniffPortuCsv (autodetekce)', () => {
  it('pozná Portu hlavičku — i s rozbitou diakritikou (ASCII fragmenty)', () => {
    expect(sniffPortuCsv(PORTU_FIXTURE)).toBe(true);
    expect(sniffPortuCsv(PORTU_HEADER)).toBe(true);
    expect(sniffPortuCsv(PORTU_ASCII_FIXTURE)).toBe(true);
  });

  it('cizí formáty a prázdný vstup → false', () => {
    expect(sniffPortuCsv('')).toBe(false);
    expect(sniffPortuCsv('foo;bar\n1;2')).toBe(false);
    expect(sniffPortuCsv(DEGIRO_TRANSACTIONS_HEADER_CZ)).toBe(false);
    expect(sniffPortuCsv(DEGIRO_ACCOUNT_HEADER_CZ)).toBe(false);
    expect(sniffPortuCsv(T212_HEADER)).toBe(false);
    expect(sniffPortuCsv(UNIVERSAL_TEMPLATE_CSV)).toBe(false);
  });
});
