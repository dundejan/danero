import { describe, expect, it } from 'vitest';
import { dedupeTransactions, UNIVERSAL_TEMPLATE_CSV } from '../src';
import { parseSchwabCsv, parseUsDate, SCHWAB_BROKER, sniffSchwabCsv } from '../src/schwab/csv';
import {
  SCHWAB_BANK,
  SCHWAB_EMPTY_EXPORT,
  SCHWAB_FICTIONAL_MAP,
  SCHWAB_HEADER,
  SCHWAB_INSTRUMENT_MAP,
  SCHWAB_INTEREST_TAX,
  SCHWAB_JOURNALED,
  SCHWAB_LEGACY,
  SCHWAB_MODERN,
  SCHWAB_NRA_WITHHOLD,
  SCHWAB_OPTIONS,
  SCHWAB_REORDERED,
  SCHWAB_STOCK_PLAN,
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

/**
 * L2b-01: Schwab vede tutéž srážku z dividendy i pod akcí „NRA Withhold“.
 * Slovník ji neznal, takže řádek skončil „neznámým typem“ a dividenda se
 * uložila se srážkou 0 — zápočet podle R-07c pak chyběl celý.
 */
describe('Schwab: srážka pod akcí „NRA Withhold“ (L2b-01, R-07c)', () => {
  const result = parseSchwabCsv(SCHWAB_NRA_WITHHOLD, SCHWAB_FICTIONAL_MAP);
  const dividendOn = (date: string) => {
    const dividend = result.transactions.find((t) => t.type === 'DIVIDEND' && t.date === date);
    if (!dividend || dividend.type !== 'DIVIDEND') throw new Error('unreachable');
    return dividend;
  };

  it('spáruje se s dividendou stejně jako „NRA Withholding“, bez chyby řádku', () => {
    expect(result.errors).toEqual([]);
    const dividend = dividendOn('2026-06-17');
    expect(dividend.gross.toString()).toBe('42');
    expect(dividend.withholdingTax.toString()).toBe('6.3');
  });

  it('kladná částka pod touž akcí je vratka a srážku snižuje (B-3-11)', () => {
    // 4,50 sraženo − 0,90 vráceno = 3,60
    expect(dividendOn('2026-09-15').withholdingTax.toString()).toBe('3.6');
    expect(result.warnings).toEqual([]);
  });
});

/**
 * L2b-02: „Stock Plan Activity“ s kusy je nabytí akcií ze zaměstnaneckého
 * plánu. Obecné „řádek neumíme zařadit — pokud je daňově relevantní…“
 * nechávalo na uživateli, aby si domyslel, že právě kvůli němu se pozdější
 * prodej spočítá s nulovou nabývací cenou.
 */
describe('Schwab: „Stock Plan Activity“ s kusy (L2b-02)', () => {
  const result = parseSchwabCsv(SCHWAB_STOCK_PLAN, SCHWAB_FICTIONAL_MAP);
  const warningAt = (line: number): string =>
    result.warnings.find((w) => w.line === line)?.message ?? '';

  it('řekne, kolik kusů čeho bylo připsáno, co se stane bez doplnění a kde je doplnit', () => {
    expect(result.errors).toEqual([]);
    const warning = warningAt(3);
    expect(warning).toContain('Stock Plan Activity');
    expect(warning).toContain('QXLT');
    expect(warning).toContain('11 ks');
    expect(warning).toContain('nulovou nabývací cenou');
    expect(warning).toContain('bez časového testu');
    expect(warning).toContain('univerzální šablonu');
    expect(warning).not.toContain('pokud je daňově relevantní');
  });

  it('nepředepisuje, jakou nabývací cenu zadat — pravidlo pro ni v docs/02 není', () => {
    const warning = warningAt(3);
    expect(warning).not.toBe('');
    expect(warning).not.toMatch(/tržní|kurz|cenou nákupu|\$|USD|73/);
  });

  it('prodej se uloží dál, řádek bez kusů si nechá obecné varování', () => {
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0]!.type).toBe('SELL');
    expect(result.warnings).toHaveLength(2);
    expect(warningAt(4)).toContain('zatím neumíme automaticky zařadit');
    expect(warningAt(4)).not.toContain(' ks');
  });
});

/**
 * L2b-07: daň sražená z úroku chodí jako srážkový řádek BEZ symbolu s popisem
 * „SCHWAB1 INT …“. Párovala se jen na dividendy, takže vždy skončila radou
 * hledat dividendu, která ve výpisu není, a úrok se uložil bez srážky (R-07f).
 */
describe('Schwab: srážka z úroku se páruje na úrok téhož dne (L2b-07, R-07f)', () => {
  const result = parseSchwabCsv(SCHWAB_INTEREST_TAX);

  it('úrok nese sraženou daň v poli withholdingTax, částka zůstává hrubá', () => {
    expect(result.errors).toEqual([]);
    const interests = result.transactions.filter((t) => t.type === 'INTEREST');
    expect(interests).toHaveLength(1);
    const interest = interests[0]!;
    if (interest.type !== 'INTEREST') throw new Error('unreachable');
    expect(interest.date).toBe('2026-06-16');
    expect(interest.amount.toString()).toBe('4.1');
    expect(interest.withholdingTax.toString()).toBe('1.23');
  });

  it('srážka bez úroku téhož dne dostane varování o dani z úroku, ne o dividendě', () => {
    expect(result.warnings).toHaveLength(1);
    const warning = result.warnings[0]!;
    expect(warning.line).toBe(4);
    expect(warning.message).toContain('z úroku');
    expect(warning.message).toContain('0.87');
    expect(warning.message).not.toContain('dividend');
  });

  it('vratka snižuje srážku u úroku a otisk pro dedupe se srážkou nemění', () => {
    const rows = [
      SCHWAB_HEADER,
      '"06/16/2026","NRA Tax Adj","","SCHWAB1 INT 05/16-06/15","","","","$0.23"',
      '"06/16/2026","NRA Tax Adj","","SCHWAB1 INT 05/16-06/15","","","","-$1.23"',
      '"06/16/2026","Credit Interest","","SCHWAB1 INT 05/16-06/15","","","","$4.10"',
    ];
    const refunded = parseSchwabCsv(rows.join('\n'));
    expect(refunded.errors).toEqual([]);
    expect(refunded.warnings).toEqual([]);
    const interest = refunded.transactions[0]!;
    if (interest.type !== 'INTEREST') throw new Error('unreachable');
    expect(interest.withholdingTax.toString()).toBe('1');

    // úrok uložený dřív bez srážky a tentýž úrok se srážkou jsou jedna transakce
    const plain = parseSchwabCsv([rows[0]!, rows[3]!].join('\n'));
    const known = new Set(
      dedupeTransactions(SCHWAB_BROKER, plain.transactions, new Set()).fresh.map((row) => row.key),
    );
    const again = dedupeTransactions(SCHWAB_BROKER, refunded.transactions, known);
    expect(again.fresh).toHaveLength(0);
    expect(again.duplicates).toBe(1);
  });
});

/**
 * A03-R1-01: k jednomu úroku může přijít víc srážkových řádků (srážka a její
 * doúčtování, opravná trojice srážka + vratka + nová srážka). Druhý řádek se
 * zahazoval s hláškou, že úrok toho dne ve výpisu chybí — a přitom stál hned
 * vedle. Sražená daň z úroku se eviduje celá (R-07f).
 */
describe('Schwab: víc srážek k úroku a víc úroků v jednom dni (A03-R1-01, R-07f)', () => {
  const PERIOD = 'SCHWAB1 INT 05/16-06/15';
  const taxRow = (amount: string, description = PERIOD, action = 'NRA Tax Adj') =>
    `"06/16/2026","${action}","","${description}","","","","${amount}"`;
  const creditInterest = (amount: string, description = PERIOD) =>
    `"06/16/2026","Credit Interest","","${description}","","","","${amount}"`;
  const bankInterest = (amount: string) =>
    `"06/16/2026","Bank Interest","","BANK INT 051626-061526","","","","${amount}"`;
  const parse = (rows: string[]) => parseSchwabCsv([SCHWAB_HEADER, ...rows].join('\n'));
  /** Úroky v pořadí výpisu jako „částka:srážka“. */
  const withheld = (result: ReturnType<typeof parseSchwabCsv>): string[] =>
    result.transactions.map((t) =>
      t.type === 'INTEREST' ? `${t.amount.toString()}:${t.withholdingTax.toString()}` : t.type,
    );

  it('dvě srážky k jednomu úroku se sečtou a žádná nezůstane osiřelá', () => {
    const result = parse([
      taxRow('-$0.23'),
      taxRow('-$1.00', PERIOD, 'NRA Withholding'),
      creditInterest('$4.10'),
    ]);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(withheld(result)).toEqual(['4.1:1.23']);
  });

  it('opravná trojice srážka + vratka + nová srážka dá čistou srážku bez varování', () => {
    // 0,61 + 1,23 sraženo − 1,23 vráceno = 0,61
    const result = parse([taxRow('-$0.61'), taxRow('$1.23'), taxRow('-$1.23'), creditInterest('$4.10')]);
    expect(result.warnings).toEqual([]);
    expect(withheld(result)).toEqual(['4.1:0.61']);
  });

  it('dva shodné úroky téhož dne se dvěma srážkami — každý dostane svou', () => {
    const result = parse([
      taxRow('-$1.23'),
      creditInterest('$4.10'),
      taxRow('-$1.23'),
      creditInterest('$4.10'),
    ]);
    expect(result.warnings).toEqual([]);
    expect(withheld(result)).toEqual(['4.1:1.23', '4.1:1.23']);
  });

  it('u dvou úroků téhož dne dostane srážku ten se shodným popisem', () => {
    const result = parse([bankInterest('$0.50'), creditInterest('$4.10'), taxRow('-$1.23')]);
    expect(result.warnings).toEqual([]);
    expect(withheld(result)).toEqual(['0.5:0', '4.1:1.23']);
  });

  it('druhá srážka se shodným popisem se přičte k témuž úroku, ne k jinému úroku toho dne', () => {
    const result = parse([
      bankInterest('$0.50'),
      creditInterest('$4.10'),
      taxRow('-$0.23'),
      taxRow('-$1.00'),
    ]);
    expect(result.warnings).toEqual([]);
    expect(withheld(result)).toEqual(['0.5:0', '4.1:1.23']);
  });

  it('jediný úrok dne dostane srážku, i když se popis období liší', () => {
    const result = parse([taxRow('-$1.23', 'SCHWAB1 INT 05/16-06/15 ADJ'), creditInterest('$4.10')]);
    expect(result.warnings).toEqual([]);
    expect(withheld(result)).toEqual(['4.1:1.23']);
  });

  it('varování o chybějícím úroku padne jen tehdy, když úrok toho dne ve výpisu opravdu není', () => {
    const result = parse([
      taxRow('-$1.23'),
      creditInterest('$4.10'),
      '"05/18/2026","NRA Tax Adj","","SCHWAB1 INT 04/16-05/15","","","","-$0.87"',
      '"05/18/2026","NRA Tax Adj","","SCHWAB1 INT 04/16-05/15","","","","-$0.13"',
    ]);
    expect(result.warnings.map((w) => w.line)).toEqual([4, 5]);
    for (const warning of result.warnings) {
      expect(warning.message).toContain('nemá ve výpisu úrok ze stejného dne');
    }
    expect(withheld(result)).toEqual(['4.1:1.23']);
  });

  it('vratka bez srážky u úroku se nezaúčtuje a mluví o úroku, ne o dividendě (A03-R1-02)', () => {
    const result = parse([taxRow('$0.23'), creditInterest('$4.10')]);
    expect(withheld(result)).toEqual(['4.1:0']);
    expect(result.warnings).toHaveLength(1);
    const warning = result.warnings[0]!;
    expect(warning.line).toBe(2);
    expect(warning.message).toContain('Vratka srážkové daně z úroku 0.23 USD (2026-06-16)');
    expect(warning.message).toContain('u úroku ze stejného dne žádnou sraženou daň neevidujeme');
    expect(warning.message).not.toContain('dividend');
  });

  it('vratka vyšší než srážka u úroku končí na nule a řekne obě částky (A03-R1-02)', () => {
    const result = parse([taxRow('$0.50'), taxRow('-$0.20'), creditInterest('$4.10')]);
    expect(withheld(result)).toEqual(['4.1:0']);
    expect(result.warnings).toHaveLength(1);
    const warning = result.warnings[0]!;
    expect(warning.line).toBe(2);
    expect(warning.message).toContain('Vratka srážkové daně z úroku 0.5 USD (2026-06-16)');
    expect(warning.message).toContain('vyšší než sražená daň 0.2 USD u úroku ze stejného dne');
    expect(warning.message).not.toContain('dividend');
  });
});

/**
 * A03-R1-02: větve z oprav L2b-02 a L2b-07, které neměly test — jejich změna
 * prošla celou sadou.
 */
describe('Schwab: hranice větví srážky z úroku a připsání kusů (A03-R1-02)', () => {
  it('srážkový řádek SE symbolem patří k dividendě, i když popis zní jako úrok', () => {
    const result = parseSchwabCsv(
      [
        SCHWAB_HEADER,
        '"06/16/2026","NRA Tax Adj","QXLT","QUELLTAL SCHWAB1 INT FUND","","","","-$6.30"',
        '"06/16/2026","Cash Dividend","QXLT","QUELLTAL SCHWAB1 INT FUND","","","","$42.00"',
        '"06/16/2026","Credit Interest","","SCHWAB1 INT 05/16-06/15","","","","$4.10"',
      ].join('\n'),
      SCHWAB_FICTIONAL_MAP,
    );
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    const summary = result.transactions.map((t) =>
      t.type === 'DIVIDEND' || t.type === 'INTEREST' ? `${t.type}:${t.withholdingTax.toString()}` : t.type,
    );
    expect(summary).toEqual(['INTEREST:0', 'DIVIDEND:6.3']);
  });

  it('u dividend se srážky nesčítají: dvě výplaty téhož titulu v okně dostanou každá svou', () => {
    // obě srážky jsou zaúčtované v den druhé výplaty; sečtené by skončily u ní
    // a první výplata by zůstala bez zápočtu
    const result = parseSchwabCsv(
      [
        SCHWAB_HEADER,
        '"09/17/2026","NRA Withhold","QXLT","QUELLTAL HOLDINGS INC","","","","-$4.50"',
        '"09/17/2026","NRA Withhold","QXLT","QUELLTAL HOLDINGS INC","","","","-$6.30"',
        '"09/17/2026","Cash Dividend","QXLT","QUELLTAL HOLDINGS INC","","","","$30.00"',
        '"09/15/2026","Cash Dividend","QXLT","QUELLTAL HOLDINGS INC","","","","$42.00"',
      ].join('\n'),
      SCHWAB_FICTIONAL_MAP,
    );
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    const summary = result.transactions.map((t) =>
      t.type === 'DIVIDEND' ? `${t.date}:${t.gross.toString()}:${t.withholdingTax.toString()}` : t.type,
    );
    expect(summary).toEqual(['2026-09-17:30:4.5', '2026-09-15:42:6.3']);
  });

  it('„Stock Plan Activity“ se zápornými kusy není připsání — zůstane obecné varování', () => {
    const result = parseSchwabCsv(
      [
        SCHWAB_HEADER,
        '"03/11/2026","Stock Plan Activity","QXLT","QUELLTAL HOLDINGS INC","-4","","",""',
      ].join('\n'),
      SCHWAB_FICTIONAL_MAP,
    );
    expect(result.errors).toEqual([]);
    expect(result.transactions).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    const warning = result.warnings[0]!.message;
    expect(warning).toContain('zatím neumíme automaticky zařadit');
    expect(warning).not.toContain('připsání');
    expect(warning).not.toContain(' ks');
  });
});

describe('opce uplatněním a prodej nakrátko', () => {
  const rows = (...lines: string[]): string => [SCHWAB_HEADER, ...lines].join('\n');

  it('Assigned a Exercised zavřou opci za 0 (dřív „neznámý typ“)', () => {
    // U assignmentu se akciová noha naimportovala, ale uzavření opce nikdy —
    // short opce tak zůstala v enginu otevřená napořád.
    const csv = rows(
      '"03/15/2024","Sell to Open","SPY 03/31/2024 500.00 P","PUT SPY","-2","$3.10","$1.30","$618.70"',
      '"03/31/2024","Assigned","SPY 03/31/2024 500.00 P","PUT SPY","2","","",""',
      '"04/05/2024","Buy to Open","SPY 04/30/2024 480.00 C","CALL SPY","1","$2.00","","-$200.00"',
      '"04/30/2024","Exercised","SPY 04/30/2024 480.00 C","CALL SPY","-1","","",""',
    );
    const result = parseSchwabCsv(csv);
    expect(result.errors).toEqual([]);
    const zaniky = result.transactions.filter(
      (tx) => (tx.type === 'BUY' || tx.type === 'SELL') && tx.pricePerShare.eq(0),
    );
    expect(zaniky).toHaveLength(2);
    // kladný počet u short pozice = pokrytí (BUY), záporný u long = odpis (SELL)
    expect(zaniky.map((tx) => tx.type).sort()).toEqual(['BUY', 'SELL']);
    expect(zaniky.every((tx) => 'assetClass' in tx && tx.assetClass === 'DERIVATIVE')).toBe(true);
  });

  it('Sell Short a Buy to Cover se neimportují, ale řekne se proč', () => {
    const csv = rows(
      '"05/02/2024","Sell Short","AAPL","APPLE INC","10","$180.00","$1.00","$1799.00"',
      '"05/20/2024","Buy to Cover","AAPL","APPLE INC","10","$170.00","$1.00","-$1701.00"',
    );
    // Naimportovat je jako běžný prodej/nákup by dalo ŠPATNÉ číslo: engine
    // ocení prodej bez lotu nulou a zdanil by celý výnos shortu.
    const result = parseSchwabCsv(csv, { AAPL: { isin: 'US0378331005' } });
    expect(result.errors).toEqual([]);
    expect(result.transactions).toEqual([]);
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings[0]!.message).toContain('nakrátko');
    expect(result.warnings[0]!.message).toContain('univerzální šablonu');
  });

  /**
   * K6a-06: skip je vědomý a zůstává, ale zdůvodnění bylo nepravdivé —
   * hláška tvrdila, že pravidlo pro shorty zatím nemáme, ačkoli R-13 v docs/02
   * existuje a engine ho počítá. Skutečný důvod je nerozpoznatelnost z dat:
   * Schwab uzavírá short obyčejným „Buy“.
   */
  it('důvodem skipu je nerozpoznatelnost z dat, ne chybějící daňové pravidlo', () => {
    const csv = rows('"05/02/2024","Sell Short","AAPL","APPLE INC","10","$180.00","$1.00","$1799.00"');
    const result = parseSchwabCsv(csv, { AAPL: { isin: 'US0378331005' } });
    const message = result.warnings[0]!.message;
    expect(message).toContain('počítat umíme');
    expect(message).toContain('Buy');
    expect(message).toContain('position_effect');
    expect(message).not.toMatch(/bez pravidla|zatím neumíme/);
  });
});
