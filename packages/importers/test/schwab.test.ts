import { describe, expect, it } from 'vitest';
import { dedupeTransactions, UNIVERSAL_TEMPLATE_CSV } from '../src';
import { parseSchwabCsv, parseUsDate, SCHWAB_BROKER, sniffSchwabCsv } from '../src/schwab/csv';
import {
  SCHWAB_BANK,
  SCHWAB_EMPTY_EXPORT,
  SCHWAB_HEADER,
  SCHWAB_INSTRUMENT_MAP,
  SCHWAB_LEGACY,
  SCHWAB_MODERN,
  SCHWAB_OPTIONS,
  SCHWAB_REORDERED,
  SCHWAB_UNMAPPED,
} from './fixtures/schwab';

describe('parseUsDate', () => {
  it('čte MM/DD/YYYY jako měsíc/den (US), ne den/měsíc', () => {
    expect(parseUsDate('11/05/2020')).toBe('2020-11-05');
    expect(parseUsDate('04/27/2023')).toBe('2023-04-27');
  });

  it('„as of“ tvar → druhé (efektivní) datum', () => {
    expect(parseUsDate('07/15/2024 as of 07/12/2024')).toBe('2024-07-12');
    expect(parseUsDate('04/01/2020 as of 03/31/2020')).toBe('2020-03-31');
  });

  it('nesmyslné kalendářní datum → null', () => {
    expect(parseUsDate('13/45/2024')).toBeNull();
    expect(parseUsDate('02/30/2024')).toBeNull();
    expect(parseUsDate('31.12.2024')).toBeNull();
  });
});

describe('sniffSchwabCsv (autodetekce)', () => {
  it('pozná moderní export (hlavička na 1. řádku) i starší s titulním řádkem', () => {
    expect(sniffSchwabCsv(SCHWAB_MODERN)).toBe(true);
    expect(sniffSchwabCsv(SCHWAB_LEGACY)).toBe(true);
    expect(sniffSchwabCsv(SCHWAB_REORDERED)).toBe(true);
  });

  it('odmítne bankovní CSV, prázdný text a cizí formáty', () => {
    expect(sniffSchwabCsv(SCHWAB_BANK)).toBe(false);
    expect(sniffSchwabCsv('')).toBe(false);
    expect(sniffSchwabCsv(UNIVERSAL_TEMPLATE_CSV)).toBe(false);
    expect(sniffSchwabCsv('Datum;Typ;Částka\n1;2;3')).toBe(false);
  });
});

describe('parseSchwabCsv — moderní export', () => {
  const result = parseSchwabCsv(SCHWAB_MODERN, SCHWAB_INSTRUMENT_MAP);

  it('happy path: 9 transakcí, bez chyb; převody a margin vědomě přeskočené', () => {
    expect(result.broker).toBe(SCHWAB_BROKER);
    expect(result.errors).toEqual([]);
    expect(result.unmappedSymbols).toEqual([]);
    expect(result.transactions).toHaveLength(9);
    expect(result.skipped).toHaveLength(2); // Margin Interest + Journal
    expect(result.skipped.some((s) => s.message.includes('Margin Interest'))).toBe(true);
    expect(result.skipped.some((s) => s.message.includes('Journal'))).toBe(true);
  });

  it('BUY: kusy, cena bez $, ISIN z mapování, USD, MM/DD/YYYY → ISO', () => {
    const buy = result.transactions.find(
      (t) => t.type === 'BUY' && t.tradeDate === '2023-04-27',
    );
    if (!buy || buy.type !== 'BUY') throw new Error('unreachable');
    expect(buy.isin).toBe('US9219378356');
    expect(buy.ticker).toBe('BND');
    expect(buy.quantity.toString()).toBe('45');
    expect(buy.pricePerShare.toString()).toBe('73.7789');
    expect(buy.currency).toBe('USD');
    expect(buy.fee).toBeUndefined(); // Fees & Comm prázdné
    expect(buy.id).toMatch(/^schwab-[0-9a-f]{16}$/);
  });

  it('Reinvest Shares → BUY zlomku kusu s poznámkou o reinvestici', () => {
    const reinvest = result.transactions.find(
      (t) => t.type === 'BUY' && t.tradeDate === '2023-04-10',
    );
    if (!reinvest || reinvest.type !== 'BUY') throw new Error('unreachable');
    expect(reinvest.quantity.toString()).toBe('0.0249');
    expect(reinvest.pricePerShare.toString()).toBe('73.8993');
    expect(reinvest.note).toContain('reinvestice');
  });

  it('SELL: kladná částka s $, poplatek z Fees & Comm', () => {
    const sell = result.transactions.find((t) => t.type === 'SELL');
    if (!sell || sell.type !== 'SELL') throw new Error('unreachable');
    expect(sell.isin).toBe('US30303M1027');
    expect(sell.quantity.toString()).toBe('100');
    expect(sell.pricePerShare.toString()).toBe('261.5');
    expect(sell.fee?.amount.toString()).toBe('6.06');
    expect(sell.tradeDate).toBe('2020-11-05');
  });

  it('dividendy: NRA Tax Adj se páruje k NEJBLIŽŠÍ dividendě stejného symbolu (±5 dní)', () => {
    const dividends = result.transactions.filter((t) => t.type === 'DIVIDEND');
    expect(dividends).toHaveLength(3);

    // GIS 02/01 dostane srážku z 02/05 (4 dny), GIS 05/01 zůstane bez srážky
    const gisWithTax = dividends.find((t) => t.type === 'DIVIDEND' && t.date === '2023-02-01');
    if (!gisWithTax || gisWithTax.type !== 'DIVIDEND') throw new Error('unreachable');
    expect(gisWithTax.gross.toString()).toBe('0.54');
    expect(gisWithTax.withholdingTax.toString()).toBe('0.08');

    const gisNoTax = dividends.find((t) => t.type === 'DIVIDEND' && t.date === '2023-05-01');
    if (!gisNoTax || gisNoTax.type !== 'DIVIDEND') throw new Error('unreachable');
    expect(gisNoTax.withholdingTax.toString()).toBe('0');

    // Qual Div Reinvest je taky dividenda (reinvestici nese samostatný BUY řádek)
    const bnd = dividends.find((t) => t.type === 'DIVIDEND' && t.date === '2023-04-10');
    if (!bnd || bnd.type !== 'DIVIDEND') throw new Error('unreachable');
    expect(bnd.gross.toString()).toBe('1.84');
    expect(bnd.isin).toBe('US9219378356'); // z mapování, u dividend jen bonus
  });

  it('nespárovaná srážka (Foreign Tax Paid bez dividendy) → warning, ne tiché zahození', () => {
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]!.message).toContain('nemá dohledatelnou dividendu');
    expect(result.warnings[0]!.message).toContain('NOVN');
  });

  it('Bank Interest → INTEREST, Service Fee → FEE (abs), oba v USD', () => {
    const interest = result.transactions.find((t) => t.type === 'INTEREST');
    if (!interest || interest.type !== 'INTEREST') throw new Error('unreachable');
    expect(interest.amount.toString()).toBe('0.11');
    expect(interest.currency).toBe('USD');
    expect(interest.date).toBe('2020-12-31');

    const fee = result.transactions.find((t) => t.type === 'FEE');
    if (!fee || fee.type !== 'FEE') throw new Error('unreachable');
    expect(fee.amount.toString()).toBe('25');
    expect(fee.date).toBe('2021-06-30');
  });

  it('Spin-off → BUY připsaných kusů za 0 s poznámkou', () => {
    const spinoff = result.transactions.find(
      (t) => t.type === 'BUY' && t.tradeDate === '2024-04-03',
    );
    if (!spinoff || spinoff.type !== 'BUY') throw new Error('unreachable');
    expect(spinoff.isin).toBe('US36828A1016');
    expect(spinoff.quantity.toString()).toBe('25');
    expect(spinoff.pricePerShare.toString()).toBe('0');
    expect(spinoff.note).toContain('spin-off');
  });
});

describe('parseSchwabCsv — starší export (titulní řádek, koncová čárka, footer)', () => {
  const result = parseSchwabCsv(SCHWAB_LEGACY, SCHWAB_INSTRUMENT_MAP);

  it('titulní řádek a footer „Transactions Total“ se přeskočí bez chyb', () => {
    expect(result.errors).toEqual([]);
    expect(result.transactions).toHaveLength(4);
  });

  it('Stock Split → warning s vysvětlením (poměr splitu výpis neuvádí)', () => {
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]!.message).toContain('Stock Split');
    expect(result.warnings[0]!.message).toContain('poměr splitu');
    expect(result.warnings[0]!.line).toBe(3);
  });

  it('Expired se záporným počtem → SELL |q| @ 0, datum z „as of“ (druhé)', () => {
    const expired = result.transactions.find(
      (t) => t.type === 'SELL' && t.tradeDate === '2020-03-31',
    );
    if (!expired || expired.type !== 'SELL') throw new Error('unreachable');
    expect(expired.isin).toBe('OPT:SPY-03/31/2020-284.00-P');
    expect(expired.assetClass).toBe('DERIVATIVE');
    expect(expired.settlementStyle).toBe('PREMIUM');
    expect(expired.quantity.toString()).toBe('1');
    expect(expired.pricePerShare.toString()).toBe('0');
    expect(expired.note).toContain('Expirace');
  });

  it('Buy to Open opce → prémie za KONTRAKT (Price × 100), mapování se nevyžaduje', () => {
    const buy = result.transactions.find((t) => t.type === 'BUY');
    if (!buy || buy.type !== 'BUY') throw new Error('unreachable');
    expect(buy.isin).toBe('OPT:SPY-03/31/2020-284.00-P');
    expect(buy.pricePerShare.toString()).toBe('530');
    expect(buy.fee?.amount.toString()).toBe('0.65');
    expect(buy.ticker).toBe('SPY');
  });

  it('dividenda nezmapovaného symbolu se importuje bez ISIN', () => {
    const dividend = result.transactions.find((t) => t.type === 'DIVIDEND');
    if (!dividend || dividend.type !== 'DIVIDEND') throw new Error('unreachable');
    expect(dividend.isin).toBeUndefined();
    expect(dividend.ticker).toBe('ARKK');
    expect(dividend.gross.toString()).toBe('0.09');
  });
});

describe('parseSchwabCsv — opce', () => {
  const result = parseSchwabCsv(SCHWAB_OPTIONS);

  it('Sell to Open / Buy to Close → SELL/BUY s prémií za kontrakt', () => {
    expect(result.errors).toEqual([]);
    const sell = result.transactions.find(
      (t) => t.type === 'SELL' && t.isin === 'OPT:SPY-03/31/2020-284.00-P',
    );
    if (!sell || sell.type !== 'SELL') throw new Error('unreachable');
    expect(sell.quantity.toString()).toBe('2');
    expect(sell.pricePerShare.toString()).toBe('530');
    expect(sell.fee?.amount.toString()).toBe('1.3');

    const close = result.transactions.find(
      (t) => t.type === 'BUY' && t.isin === 'OPT:SPY-03/31/2020-284.00-P',
    );
    if (!close || close.type !== 'BUY') throw new Error('unreachable');
    expect(close.pricePerShare.toString()).toBe('210');
  });

  it('Expired s kladným počtem (short pozice) → BUY q @ 0', () => {
    const expired = result.transactions.find(
      (t) => t.type === 'BUY' && t.isin === 'OPT:QQQ-03/31/2020-300.00-C',
    );
    if (!expired || expired.type !== 'BUY') throw new Error('unreachable');
    expect(expired.quantity.toString()).toBe('1');
    expect(expired.pricePerShare.toString()).toBe('0');
    expect(expired.tradeDate).toBe('2020-03-31'); // „as of“
  });
});

describe('parseSchwabCsv — edge cases', () => {
  it('jiné pořadí sloupců → mapování podle názvů funguje', () => {
    const result = parseSchwabCsv(SCHWAB_REORDERED, SCHWAB_INSTRUMENT_MAP);
    expect(result.errors).toEqual([]);
    expect(result.transactions).toHaveLength(1);
    const buy = result.transactions[0]!;
    if (buy.type !== 'BUY') throw new Error('unreachable');
    expect(buy.isin).toBe('US9219378356');
    expect(buy.quantity.toString()).toBe('10');
    expect(buy.pricePerShare.toString()).toBe('50');
    expect(buy.tradeDate).toBe('2024-01-10');
  });

  it('nezmapovaný symbol → JEDEN error, symbol v unmappedSymbols; dividenda projde', () => {
    const result = parseSchwabCsv(SCHWAB_UNMAPPED);
    expect(result.unmappedSymbols).toEqual(['XYZ']);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toBe('Symbol XYZ: doplň ISIN instrumentu (Schwab ho neexportuje).');
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0]!.type).toBe('DIVIDEND');
  });

  it('neznámá Action → error s doslovným zněním a číslem řádku', () => {
    const csv = [SCHWAB_HEADER, '"01/02/2024","Totally Unknown","","X","","","","$1.00"'].join('\n');
    const result = parseSchwabCsv(csv);
    expect(result.transactions).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.line).toBe(2);
    expect(result.errors[0]!.message).toContain('„Totally Unknown“');
    expect(result.errors[0]!.message).toContain('nahlaš nám ho');
  });

  it('nesmyslné datum → error, řádek se nezpracuje', () => {
    const csv = [SCHWAB_HEADER, '"13/45/2024","Buy","BND","X","1","$1.00","","-$1.00"'].join('\n');
    const result = parseSchwabCsv(csv, SCHWAB_INSTRUMENT_MAP);
    expect(result.transactions).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toContain('Neplatné datum');
  });

  it('prázdný soubor i prázdný export (titul + hlavička + „“) → prázdný výsledek bez chyb', () => {
    const empty = parseSchwabCsv('');
    expect(empty.transactions).toEqual([]);
    expect(empty.errors).toEqual([]);

    const emptyExport = parseSchwabCsv(SCHWAB_EMPTY_EXPORT);
    expect(emptyExport.transactions).toEqual([]);
    expect(emptyExport.errors).toEqual([]);
    expect(emptyExport.warnings).toEqual([]);
  });

  it('bankovní CSV → srozumitelný error o bankovním účtu', () => {
    const result = parseSchwabCsv(SCHWAB_BANK);
    expect(result.transactions).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toContain('bankovního');
  });

  it('opakovaný parse téhož souboru → stejná id (dedupe je idempotentní)', () => {
    const first = parseSchwabCsv(SCHWAB_MODERN, SCHWAB_INSTRUMENT_MAP);
    const second = parseSchwabCsv(SCHWAB_MODERN, SCHWAB_INSTRUMENT_MAP);
    expect(second.transactions.map((t) => t.id)).toEqual(first.transactions.map((t) => t.id));

    const combined = dedupeTransactions(SCHWAB_BROKER, [
      ...first.transactions,
      ...second.transactions,
    ]);
    expect(combined.fresh).toHaveLength(9);
    expect(combined.duplicates).toBe(9);
  });
});
