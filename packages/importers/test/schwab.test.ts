import { describe, expect, it } from 'vitest';
import { dedupeTransactions, UNIVERSAL_TEMPLATE_CSV } from '../src';
import { parseSchwabCsv, parseUsDate, SCHWAB_BROKER, sniffSchwabCsv } from '../src/schwab/csv';
import {
  SCHWAB_BANK,
  SCHWAB_EMPTY_EXPORT,
  SCHWAB_HEADER,
  SCHWAB_INSTRUMENT_MAP,
  SCHWAB_JOURNALED,
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

  /**
   * B-3-9: „Journaled Shares“ přesouvá KUSY, ale končilo to ve `skipped`
   * s textem „peněžní převod — pro daňový výpočet není potřeba“. UI u skipped
   * ukazuje jen počet, takže se to uživatel nedozvěděl vůbec — a pozdější
   * prodej pak narazil na „prodáno víc, než je evidováno“ → nabývací cena 0 Kč
   * a bez časového testu, tedy maximálně nadhodnocený zisk.
   */
  it('„Journaled Shares“ s kusy → varování s návodem, peněžní „Journal“ zůstává tichý (B-3-9)', () => {
    const result = parseSchwabCsv(SCHWAB_JOURNALED, SCHWAB_INSTRUMENT_MAP);

    expect(result.errors).toEqual([]);
    // peněžní převod bez kusů se dál přeskakuje potichu
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]!.message).toContain('Journal');

    expect(result.warnings).toHaveLength(1);
    const warning = result.warnings[0]!.message;
    expect(warning).toContain('Journaled Shares');
    expect(warning).toContain('BND');
    expect(warning).toContain('10 ks');
    expect(warning).toContain('TRANSFER_IN');
  });

  /**
   * B-3-2: klíč se počítal z otisku SYROVÉHO řádku (`fnv1a64(row.join('|'))`),
   * takže tentýž obchod v jiném tvaru exportu vyrobil jiný klíč a uložil se
   * znovu — s hlášením „0 duplicit". A že se tvar mění, ví sám parser: nad
   * mapováním sloupců stojí „Pořadí sloupců se mezi exporty LIŠÍ".
   */
  it('týž obchod ve třech tvarech exportu je jedna transakce, ne tři (B-3-2)', () => {
    const prodej =
      '"11/05/2020","Sell","FB","FACEBOOK INC CLASS A","100","$261.50","$6.06","$26143.94"';
    const tvary = [
      // moderní export
      [SCHWAB_HEADER, prodej].join('\n'),
      // starší export: titulní řádek a koncová čárka (prázdný 9. sloupec)
      [
        '"Transactions  for account Individual XXXX-1234 as of 11/06/2020 22:00:00 ET"',
        `${SCHWAB_HEADER},`,
        `${prodej},`,
      ].join('\n'),
      // jiné pořadí sloupců
      [
        '"Action","Date","Amount","Symbol","Description","Quantity","Price","Fees & Comm"',
        '"Sell","11/05/2020","$26143.94","FB","FACEBOOK INC CLASS A","100","$261.50","$6.06"',
      ].join('\n'),
    ];

    // každý tvar je vlastní soubor, tedy vlastní import (jako v import-service)
    const klice = new Set<string>();
    let ulozeno = 0;
    let duplicit = 0;
    for (const csv of tvary) {
      const parsed = parseSchwabCsv(csv, SCHWAB_INSTRUMENT_MAP);
      expect(parsed.transactions).toHaveLength(1);
      const outcome = dedupeTransactions(SCHWAB_BROKER, parsed.transactions, klice);
      for (const row of outcome.fresh) klice.add(row.key);
      ulozeno += outcome.fresh.length;
      duplicit += outcome.duplicates;
    }

    expect(ulozeno).toBe(1);
    expect(duplicit).toBe(2);
  });
});

/**
 * B-3-11: kladný `NRA Tax Adj` je VRATKA přeplatku srážkové daně. Přes
 * `.abs()` se zaúčtovala jako další srážka, takže zápočet vyšel vyšší
 * a česká daň nižší — nejhorší směr chyby.
 */
describe('Schwab: vratka srážkové daně snižuje srážku, nezakládá novou', () => {
  const csv = (radky: string[]) => [SCHWAB_HEADER, ...radky].join('\n');

  it('kladná částka odečte z už zaúčtované srážky téhož symbolu', () => {
    const result = parseSchwabCsv(
      csv([
        '"02/01/2023","Cash Dividend","GIS","GENERAL MILLS","","","","$0.54"',
        '"02/03/2023","NRA Tax Adj","GIS","GENERAL MILLS","","","","-$0.15"',
        '"02/05/2023","NRA Tax Adj","GIS","GENERAL MILLS","","","","$0.08"',
      ]),
      SCHWAB_INSTRUMENT_MAP,
    );
    const dividend = result.transactions.find((t) => t.type === 'DIVIDEND');
    if (!dividend || dividend.type !== 'DIVIDEND') throw new Error('unreachable');
    expect(dividend.gross.toString()).toBe('0.54');
    // 0,15 sraženo − 0,08 vráceno = 0,07 (dřív vycházelo 0,08 jako druhá srážka)
    expect(dividend.withholdingTax.toString()).toBe('0.07');
    expect(result.errors).toHaveLength(0);
  });

  it('vratka bez odpovídající srážky se nezaúčtuje a upozorní', () => {
    const result = parseSchwabCsv(
      csv([
        '"02/01/2023","Cash Dividend","GIS","GENERAL MILLS","","","","$0.54"',
        '"02/03/2023","NRA Tax Adj","GIS","GENERAL MILLS","","","","$0.08"',
      ]),
      SCHWAB_INSTRUMENT_MAP,
    );
    const dividend = result.transactions.find((t) => t.type === 'DIVIDEND');
    if (!dividend || dividend.type !== 'DIVIDEND') throw new Error('unreachable');
    expect(dividend.withholdingTax.toString()).toBe('0');
    expect(result.warnings.some((w) => w.message.includes('Vratka srážkové daně'))).toBe(true);
  });

  it('vratka vyšší než srážka končí na nule, ne v záporu', () => {
    const result = parseSchwabCsv(
      csv([
        '"02/01/2023","Cash Dividend","GIS","GENERAL MILLS","","","","$0.54"',
        '"02/02/2023","NRA Tax Adj","GIS","GENERAL MILLS","","","","-$0.05"',
        '"02/03/2023","NRA Tax Adj","GIS","GENERAL MILLS","","","","$0.20"',
      ]),
      SCHWAB_INSTRUMENT_MAP,
    );
    const dividend = result.transactions.find((t) => t.type === 'DIVIDEND');
    if (!dividend || dividend.type !== 'DIVIDEND') throw new Error('unreachable');
    expect(dividend.withholdingTax.toString()).toBe('0');
    expect(result.warnings.some((w) => w.message.includes('vyšší než sražená daň'))).toBe(true);
  });
});
