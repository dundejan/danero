import { describe, expect, it } from 'vitest';
import { dedupeTransactions, UNIVERSAL_TEMPLATE_CSV } from '../src';
import {
  parseSwissquoteCsv,
  sniffSwissquoteCsv,
  SWISSQUOTE_BROKER,
} from '../src/swissquote/csv';
import { DEGIRO_TRANSACTIONS_HEADER_CZ } from './fixtures/degiro';
import {
  SWISSQUOTE_BAD_DATE,
  SWISSQUOTE_DE,
  SWISSQUOTE_DE_ALT,
  SWISSQUOTE_DE_BROKEN_UMLAUTS,
  SWISSQUOTE_DIVIDEND_MISMATCH,
  SWISSQUOTE_EN,
  SWISSQUOTE_HEADER_DE,
  SWISSQUOTE_HEADER_EN,
  SWISSQUOTE_IDENTICAL_ROWS,
  SWISSQUOTE_UNKNOWN_TYPE,
} from './fixtures/swissquote';

describe('Swissquote CSV parser (EN, 13 sloupců)', () => {
  it('happy path: obchody, dividendy, poplatek, úrok; forex přeskočen', () => {
    const result = parseSwissquoteCsv(SWISSQUOTE_EN);

    expect(result.broker).toBe(SWISSQUOTE_BROKER);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    // 11 řádků: 3 buy + 3 sell + 2 dividendy + fee + interest; forex credit skip
    expect(result.transactions).toHaveLength(10);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]!.message).toContain('Forex credit');
  });

  it('BUY: kusy, cena, poplatek z Costs v měně transakce, datum DD-MM-YYYY', () => {
    const result = parseSwissquoteCsv(SWISSQUOTE_EN);

    const buy = result.transactions.find((t) => t.type === 'BUY' && t.isin === 'US8863645383');
    if (!buy || buy.type !== 'BUY') throw new Error('unreachable');
    expect(buy.quantity.toString()).toBe('200');
    expect(buy.pricePerShare.toString()).toBe('19.85');
    expect(buy.currency).toBe('USD');
    expect(buy.fee?.amount.toString()).toBe('5.96');
    expect(buy.fee?.currency).toBe('USD');
    expect(buy.tradeDate).toBe('2022-08-10'); // 10-08-2022 = den-měsíc-rok
    expect(buy.ticker).toBe('ORFN');
    expect(buy.name).toBe('CONSTRAINED CAPITAL ESG ORPHAN');
  });

  it('SELL a částečné exekuce téže objednávky: každý řádek samostatná transakce s vlastním id', () => {
    const result = parseSwissquoteCsv(SWISSQUOTE_EN);

    const sells = result.transactions.filter((t) => t.type === 'SELL' && t.isin === 'IE00BCBJG560');
    expect(sells).toHaveLength(2);
    const [big, small] = sells;
    if (big?.type !== 'SELL' || small?.type !== 'SELL') throw new Error('unreachable');
    expect(big.quantity.toString()).toBe('367');
    expect(small.quantity.toString()).toBe('6');
    expect(big.id).not.toBe(small.id); // id z obsahu řádku, NE z Order #
    expect(big.id.startsWith('sq-')).toBe(true);
  });

  it('dividenda bez srážky: Costs 0 → withholding 0', () => {
    const result = parseSwissquoteCsv(SWISSQUOTE_EN);

    const dividend = result.transactions.find(
      (t) => t.type === 'DIVIDEND' && t.isin === 'IE00B945VV12',
    );
    if (!dividend || dividend.type !== 'DIVIDEND') throw new Error('unreachable');
    expect(dividend.gross.toString()).toBe('486.58'); // Unit price = celá částka
    expect(dividend.withholdingTax.toString()).toBe('0');
    expect(dividend.currency).toBe('EUR');
    expect(dividend.date).toBe('2022-06-30');
  });

  it('dividenda se srážkou v Costs: |Net| = Unit price − Costs → withholding = Costs', () => {
    const result = parseSwissquoteCsv(SWISSQUOTE_EN);

    const dividend = result.transactions.find(
      (t) => t.type === 'DIVIDEND' && t.isin === 'US0378331005',
    );
    if (!dividend || dividend.type !== 'DIVIDEND') throw new Error('unreachable');
    expect(dividend.gross.toString()).toBe('100');
    expect(dividend.withholdingTax.toString()).toBe('15');
  });

  it('dividenda s Costs, které nesedí na brutto−netto → withholding 0 + warning', () => {
    const result = parseSwissquoteCsv(SWISSQUOTE_DIVIDEND_MISMATCH);

    expect(result.errors).toEqual([]);
    const dividend = result.transactions[0]!;
    if (dividend.type !== 'DIVIDEND') throw new Error('unreachable');
    expect(dividend.gross.toString()).toBe('100');
    expect(dividend.withholdingTax.toString()).toBe('0');
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]!.message).toContain('nesedí');
  });

  it('Custody Fees → FEE (|Net Amount|), Interests → INTEREST', () => {
    const result = parseSwissquoteCsv(SWISSQUOTE_EN);

    const fee = result.transactions.find((t) => t.type === 'FEE');
    if (!fee || fee.type !== 'FEE') throw new Error('unreachable');
    expect(fee.amount.toString()).toBe('53.85');
    expect(fee.currency).toBe('CHF');
    expect(fee.note).toBe('Custody Fees');

    const interest = result.transactions.find((t) => t.type === 'INTEREST');
    if (!interest || interest.type !== 'INTEREST') throw new Error('unreachable');
    expect(interest.amount.toString()).toBe('12.34');
    expect(interest.currency).toBe('CHF');
  });

  it('GBX = pence → GBP: cena/100 i poplatek/100', () => {
    const result = parseSwissquoteCsv(SWISSQUOTE_EN);

    const gbx = result.transactions.find((t) => t.type === 'BUY' && t.isin === 'GB0005405286');
    if (!gbx || gbx.type !== 'BUY') throw new Error('unreachable');
    expect(gbx.currency).toBe('GBP');
    expect(gbx.pricePerShare.toString()).toBe('7.005');
    expect(gbx.fee?.amount.toString()).toBe('0.07');
    expect(gbx.fee?.currency).toBe('GBP');
  });

  it('švýcarské tisícové apostrofy („1\'000.0“) se stripují', () => {
    const result = parseSwissquoteCsv(SWISSQUOTE_EN);

    const buy = result.transactions.find((t) => t.type === 'BUY' && t.isin === 'CH0012138530');
    if (!buy || buy.type !== 'BUY') throw new Error('unreachable');
    expect(buy.quantity.toString()).toBe('1000');
    expect(buy.pricePerShare.toString()).toBe('2.85');
  });
});

describe('Swissquote CSV parser (DE, 15 sloupců)', () => {
  it('happy path: měna transakce z „Währung Nettobetrag“, ne z „Währung“ (subúčet)', () => {
    const result = parseSwissquoteCsv(SWISSQUOTE_DE);

    expect(result.errors).toEqual([]);
    // Kauf, Verkauf, Dividende, Depotgebühren, Zinsen = 5 transakcí
    expect(result.transactions).toHaveLength(5);

    const buy = result.transactions.find((t) => t.type === 'BUY');
    if (!buy || buy.type !== 'BUY') throw new Error('unreachable');
    expect(buy.isin).toBe('IE00B3RBWM25');
    expect(buy.quantity.toString()).toBe('10');
    expect(buy.pricePerShare.toString()).toBe('95.5');
    expect(buy.currency).toBe('EUR'); // Währung Nettobetrag, NE CHF ze sloupce Währung
    expect(buy.fee?.amount.toString()).toBe('9.55');
    expect(buy.fee?.currency).toBe('EUR');
    expect(buy.tradeDate).toBe('2023-01-12');

    const sell = result.transactions.find((t) => t.type === 'SELL');
    if (!sell || sell.type !== 'SELL') throw new Error('unreachable');
    expect(sell.quantity.toString()).toBe('5');
    expect(sell.currency).toBe('EUR');
  });

  it('Dividende se srážkou v Kosten, Depotgebühren → FEE, Zinsen → INTEREST', () => {
    const result = parseSwissquoteCsv(SWISSQUOTE_DE);

    const dividend = result.transactions.find((t) => t.type === 'DIVIDEND');
    if (!dividend || dividend.type !== 'DIVIDEND') throw new Error('unreachable');
    expect(dividend.gross.toString()).toBe('100');
    expect(dividend.withholdingTax.toString()).toBe('35'); // |65| = 100 − 35
    expect(dividend.currency).toBe('CHF');

    const fee = result.transactions.find((t) => t.type === 'FEE');
    if (!fee || fee.type !== 'FEE') throw new Error('unreachable');
    expect(fee.amount.toString()).toBe('53.85');

    const interest = result.transactions.find((t) => t.type === 'INTEREST');
    if (!interest || interest.type !== 'INTEREST') throw new Error('unreachable');
    expect(interest.amount.toString()).toBe('10');
  });

  it('Zinsen auf Belastungen → skip s poznámkou; Forex/Vergütung → skip; Rückzahlung → warning', () => {
    const result = parseSwissquoteCsv(SWISSQUOTE_DE);

    expect(result.skipped).toHaveLength(3);
    expect(result.skipped.some((s) => s.message.includes('debetní úrok'))).toBe(true);
    expect(result.skipped.some((s) => s.message.includes('FX konverze'))).toBe(true);

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]!.message).toContain('Rückzahlung');
    expect(result.warnings[0]!.message).toContain('neumíme zaúčtovat automaticky');
  });

  it('varianta 13. sloupce „Nettobetrag in Kontowährung“ — mapování podle názvů funguje', () => {
    const result = parseSwissquoteCsv(SWISSQUOTE_DE_ALT);

    expect(result.errors).toEqual([]);
    expect(result.transactions).toHaveLength(1);
    const buy = result.transactions[0]!;
    if (buy.type !== 'BUY') throw new Error('unreachable');
    expect(buy.currency).toBe('EUR');
  });

  it('rozbité přehlásky z Latin-1 dekódování (StÃ¼ckpreis, WÃ¤hrung, DepotgebÃ¼hren) nevadí', () => {
    const result = parseSwissquoteCsv(SWISSQUOTE_DE_BROKEN_UMLAUTS);

    expect(result.errors).toEqual([]);
    expect(result.transactions).toHaveLength(2);
    const buy = result.transactions.find((t) => t.type === 'BUY');
    if (!buy || buy.type !== 'BUY') throw new Error('unreachable');
    expect(buy.pricePerShare.toString()).toBe('95.5'); // StÃ¼ckpreis namapovaný
    expect(buy.currency).toBe('EUR'); // WÃ¤hrung Nettobetrag namapovaný
    const fee = result.transactions.find((t) => t.type === 'FEE');
    expect(fee).toBeDefined(); // DepotgebÃ¼hren klasifikované jako poplatek
  });
});

describe('Swissquote CSV parser (chyby a okraje)', () => {
  it('neznámý typ transakce → error s doslovným zněním a číslem řádku', () => {
    const result = parseSwissquoteCsv(SWISSQUOTE_UNKNOWN_TYPE);

    expect(result.transactions).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.line).toBe(2);
    expect(result.errors[0]!.message).toContain('Mystery Op');
    expect(result.errors[0]!.message).toContain('nahlaš nám');
  });

  it('nesmyslné kalendářní datum → error s číslem řádku', () => {
    const result = parseSwissquoteCsv(SWISSQUOTE_BAD_DATE);

    expect(result.transactions).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.line).toBe(2);
    expect(result.errors[0]!.message).toContain('Neplatné datum');
  });

  it('prázdný soubor → prázdný výsledek, ne chyba', () => {
    const result = parseSwissquoteCsv('');

    expect(result.errors).toEqual([]);
    expect(result.transactions).toEqual([]);
    expect(result.skipped).toEqual([]);
  });

  it('soubor bez povinných sloupců → srozumitelný error na řádku 1', () => {
    const result = parseSwissquoteCsv('foo;bar;baz\n1;2;3');

    expect(result.transactions).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.line).toBe(1);
    expect(result.errors[0]!.message).toContain('nevypadá jako Swissquote export');
  });

  it('idempotentní ID: dva parse téhož = stejná ID; identické řádky rozliší suffix', () => {
    const first = parseSwissquoteCsv(SWISSQUOTE_IDENTICAL_ROWS);
    const second = parseSwissquoteCsv(SWISSQUOTE_IDENTICAL_ROWS);

    const firstIds = first.transactions.map((t) => t.id);
    expect(firstIds).toHaveLength(2);
    expect(new Set(firstIds).size).toBe(2); // suffix -2 pro identický řádek
    expect(second.transactions.map((t) => t.id)).toEqual(firstIds);
  });

  it('opakovaný import happy-path souboru je idempotentní (dedupe)', () => {
    const first = parseSwissquoteCsv(SWISSQUOTE_EN);
    const second = parseSwissquoteCsv(SWISSQUOTE_EN);

    const combined = dedupeTransactions(SWISSQUOTE_BROKER, [
      ...first.transactions,
      ...second.transactions,
    ]);
    expect(combined.fresh).toHaveLength(10);
    expect(combined.duplicates).toBe(10);
  });
});

describe('sniffSwissquoteCsv (autodetekce)', () => {
  it('pozná EN 13sloupcovou, DE 15sloupcovou i rozbitou DE hlavičku', () => {
    expect(sniffSwissquoteCsv(SWISSQUOTE_EN)).toBe(true);
    expect(sniffSwissquoteCsv(SWISSQUOTE_DE)).toBe(true);
    expect(sniffSwissquoteCsv(SWISSQUOTE_HEADER_EN)).toBe(true); // jen hlavička
    expect(sniffSwissquoteCsv(SWISSQUOTE_HEADER_DE)).toBe(true);
    expect(sniffSwissquoteCsv(SWISSQUOTE_DE_BROKEN_UMLAUTS)).toBe(true);
  });

  it('odmítne cizí formáty: Degiro CZ středníkovou hlavičku, univerzální šablonu, prázdno', () => {
    // Degiro má také středníky a ISIN, ale „ID objednávky“ místo „Order #“
    expect(sniffSwissquoteCsv(DEGIRO_TRANSACTIONS_HEADER_CZ)).toBe(false);
    expect(sniffSwissquoteCsv(UNIVERSAL_TEMPLATE_CSV)).toBe(false);
    expect(sniffSwissquoteCsv('')).toBe(false);
    expect(sniffSwissquoteCsv('foo;bar\n1;2')).toBe(false);
  });
});

describe('dividenda s cenou za kus (Quantity > 1) — křížové ověření přes Net Amount', () => {
  it('Unit price za kus × kusy se pozná podle Net Amount a brutto se nepodhodnotí', async () => {
    const { parseSwissquoteCsv } = await import('../src/swissquote/csv');
    const { SWISSQUOTE_HEADER_EN } = await import('./fixtures/swissquote');
    const csv = [
      SWISSQUOTE_HEADER_EN,
      // 100 ks × 0.50 = 50.00 brutto, srážka 7.50 → netto 42.50
      '30-06-2022 16:35:13;00000000;Dividend;VEUD;VANGUARD FTSE EUROPE UCITS ETF;IE00B945VV12;100.0;0.50;7.50;0.00;42.50;941.93;EUR',
    ].join('\n');
    const result = parseSwissquoteCsv(csv);
    const dividend = result.transactions.find((t) => t.type === 'DIVIDEND');
    expect(dividend).toBeDefined();
    if (dividend?.type === 'DIVIDEND') {
      expect(dividend.gross.toString()).toBe('50');
      expect(dividend.withholdingTax.toString()).toBe('7.5');
    }
  });

  it('nesedící částky → brutto = připsaná částka + warning (žádné tiché podhodnocení)', async () => {
    const { parseSwissquoteCsv } = await import('../src/swissquote/csv');
    const { SWISSQUOTE_HEADER_EN } = await import('./fixtures/swissquote');
    const csv = [
      SWISSQUOTE_HEADER_EN,
      '30-06-2022 16:35:13;00000000;Dividend;VEUD;VANGUARD FTSE EUROPE UCITS ETF;IE00B945VV12;3.0;0.50;0.30;0.00;123.45;941.93;EUR',
    ].join('\n');
    const result = parseSwissquoteCsv(csv);
    const dividend = result.transactions.find((t) => t.type === 'DIVIDEND');
    if (dividend?.type === 'DIVIDEND') {
      expect(dividend.gross.toString()).toBe('123.45');
      expect(dividend.withholdingTax.toString()).toBe('0');
    }
    expect(result.warnings.some((w) => w.message.includes('nejdou dohromady'))).toBe(true);
  });
});
