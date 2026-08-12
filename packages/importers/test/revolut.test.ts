import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { parseCsv } from '../src/csv';
import { parseRevolutXlsx, sniffRevolutXlsx } from '../src/revolut/xlsx';
import { dedupeTransactions, UNIVERSAL_TEMPLATE_CSV } from '../src';
import {
  parseRevolutCryptoCsv,
  parseRevolutInvestCsv,
  parseRevolutMoney,
  REVOLUT_BROKER,
  sniffRevolutCryptoCsv,
  sniffRevolutInvestCsv,
} from '../src/revolut/csv';
import {
  REVOLUT_CRYPTO_EXCHANGE_PAIR_CSV,
  REVOLUT_CRYPTO_NEW_CSV,
  REVOLUT_CRYPTO_NEW_NO_CURRENCY_CSV,
  REVOLUT_CRYPTO_NEW_HEADER,
  REVOLUT_CRYPTO_NEW_UNKNOWN_TYPE_CSV,
  REVOLUT_CRYPTO_OLD_CSV,
  REVOLUT_CRYPTO_OLD_UNSUPPORTED_TYPE_CSV,
  REVOLUT_INSTRUMENT_MAP,
  REVOLUT_INVEST_CSV,
  REVOLUT_INVEST_EXTRAS_CSV,
  REVOLUT_INVEST_HEADER,
  REVOLUT_INVEST_UNKNOWN_TYPE_CSV,
  REVOLUT_INVEST_UNMAPPED_CSV,
} from './fixtures/revolut';

describe('parseRevolutMoney', () => {
  it('symbol měny uvnitř hodnoty, tisícové čárky, ISO kód před/za', () => {
    expect(parseRevolutMoney('$52.07')).toEqual({ amount: '52.07', currency: 'USD' });
    expect(parseRevolutMoney('€88.94')).toEqual({ amount: '88.94', currency: 'EUR' });
    expect(parseRevolutMoney('-$0.01')).toEqual({ amount: '-0.01', currency: 'USD' });
    expect(parseRevolutMoney('$0')).toEqual({ amount: '0', currency: 'USD' });
    expect(parseRevolutMoney('£48.00')).toEqual({ amount: '48.00', currency: 'GBP' });
    expect(parseRevolutMoney('USD 529.68')).toEqual({ amount: '529.68', currency: 'USD' });
    expect(parseRevolutMoney('137,211.36 SEK')).toEqual({ amount: '137211.36', currency: 'SEK' });
    expect(parseRevolutMoney('€5,837.33')).toEqual({ amount: '5837.33', currency: 'EUR' });
  });

  it('desetinná čárka: jediná čárka s jinou než trojcifernou skupinou', () => {
    expect(parseRevolutMoney('0,76672417')).toEqual({ amount: '0.76672417', currency: null });
    expect(parseRevolutMoney('0,5')).toEqual({ amount: '0.5', currency: null });
    // jediná čárka + přesně 3 číslice = tisícový oddělovač (US zápis)
    expect(parseRevolutMoney('1,234')).toEqual({ amount: '1234', currency: null });
    expect(parseRevolutMoney('12,345,678')).toEqual({ amount: '12345678', currency: null });
  });

  it('prázdno a nečísla → null', () => {
    expect(parseRevolutMoney('')).toBeNull();
    expect(parseRevolutMoney('   ')).toBeNull();
    expect(parseRevolutMoney('N/A')).toBeNull();
  });
});

describe('Revolut akcie (Account statement CSV)', () => {
  it('happy path: BUY/SELL/dividenda/custody fee; top-up, split a transfer mimo import', () => {
    const result = parseRevolutInvestCsv(REVOLUT_INVEST_CSV, REVOLUT_INSTRUMENT_MAP);

    expect(result.broker).toBe(REVOLUT_BROKER);
    expect(result.errors).toEqual([]);
    expect(result.unmappedSymbols).toEqual([]);
    expect(result.transactions).toHaveLength(6);
    expect(result.skipped).toHaveLength(2); // CASH TOP-UP + TRANSFER
    expect(result.warnings).toHaveLength(2); // dividenda netto + stock split
  });

  it('BUY: quantity, cena z Price per share, měna ze sloupce Currency, datum z prvních 10 znaků', () => {
    const result = parseRevolutInvestCsv(REVOLUT_INVEST_CSV, REVOLUT_INSTRUMENT_MAP);

    const buy = result.transactions[0]!;
    if (buy.type !== 'BUY') throw new Error('unreachable');
    expect(buy.id).toMatch(/^rev-[0-9a-f]{16}$/);
    expect(buy.isin).toBe('US7561091049');
    expect(buy.ticker).toBe('O');
    expect(buy.quantity.toString()).toBe('1.63453043');
    expect(buy.pricePerShare.toString()).toBe('52.07'); // Price per share, ne Total/Quantity
    expect(buy.currency).toBe('USD');
    expect(buy.tradeDate).toBe('2023-09-22');
    expect(buy.settlementDate).toBeUndefined(); // dopočítá engine
  });

  it('SELL a EUR obchod s desetinnou čárkou v Quantity', () => {
    const result = parseRevolutInvestCsv(REVOLUT_INVEST_CSV, REVOLUT_INSTRUMENT_MAP);

    const sell = result.transactions[1]!;
    if (sell.type !== 'SELL') throw new Error('unreachable');
    expect(sell.ticker).toBe('MA');
    expect(sell.quantity.toString()).toBe('0.1998348');
    expect(sell.pricePerShare.toString()).toBe('402.13');
    expect(sell.tradeDate).toBe('2023-07-14');

    // „0,76672417“ v uvozovkách = desetinná čárka
    const msft = result.transactions[5]!;
    if (msft.type !== 'BUY') throw new Error('unreachable');
    expect(msft.ticker).toBe('MSFT');
    expect(msft.quantity.toString()).toBe('0.76672417');
    expect(msft.pricePerShare.toString()).toBe('26.09');
    expect(msft.currency).toBe('EUR');
    expect(msft.tradeDate).toBe('2025-09-08');
  });

  it('dividenda: netto částka jako gross, srážka 0 + warning s vysvětlením', () => {
    const result = parseRevolutInvestCsv(REVOLUT_INVEST_CSV, REVOLUT_INSTRUMENT_MAP);

    const dividend = result.transactions.find((t) => t.type === 'DIVIDEND')!;
    if (dividend.type !== 'DIVIDEND') throw new Error('unreachable');
    expect(dividend.isin).toBe('US5949181045'); // z mapování
    expect(dividend.ticker).toBe('MSFT');
    expect(dividend.gross.toString()).toBe('0.08');
    expect(dividend.withholdingTax.toString()).toBe('0');
    expect(dividend.currency).toBe('USD');
    expect(dividend.date).toBe('2019-12-13');
    expect(result.warnings.some((w) => w.message.includes('netto po srážce'))).toBe(true);
  });

  it('custody fee: záporná částka ve výpisu → kladný FEE náklad', () => {
    const result = parseRevolutInvestCsv(REVOLUT_INVEST_CSV, REVOLUT_INSTRUMENT_MAP);

    const fee = result.transactions.find((t) => t.type === 'FEE')!;
    if (fee.type !== 'FEE') throw new Error('unreachable');
    expect(fee.amount.toString()).toBe('0.01');
    expect(fee.currency).toBe('USD');
    expect(fee.date).toBe('2021-09-01');
  });

  it('stock split → warning (výpis neuvádí poměr) a žádná transakce', () => {
    const result = parseRevolutInvestCsv(REVOLUT_INVEST_CSV, REVOLUT_INSTRUMENT_MAP);

    const splitWarning = result.warnings.find((w) => w.message.includes('poměr splitu'));
    expect(splitWarning).toBeDefined();
    expect(splitWarning!.line).toBe(7);
    // split se nesmí propsat do obchodů TSLA
    const tsla2022 = result.transactions.filter(
      (t) => (t.type === 'BUY' || t.type === 'SELL') && t.tradeDate === '2022-08-25',
    );
    expect(tsla2022).toEqual([]);
  });

  it('transfer mezi entitami Revolutu a cash top-up → skipped bez warningu', () => {
    const result = parseRevolutInvestCsv(REVOLUT_INVEST_CSV, REVOLUT_INSTRUMENT_MAP);

    expect(result.skipped.some((s) => s.message.includes('převod mezi entitami'))).toBe(true);
    expect(result.skipped.some((s) => s.message.includes('vklad hotovosti'))).toBe(true);
    expect(result.warnings.some((w) => w.message.includes('TRANSFER'))).toBe(false);
  });

  it('extras: LIMIT/STOP typy, cena fallbackem z Total/Quantity, „USD 0.51“, CUSTODY_FEE, reversal', () => {
    const result = parseRevolutInvestCsv(REVOLUT_INVEST_EXTRAS_CSV, REVOLUT_INSTRUMENT_MAP);

    expect(result.errors).toEqual([]);
    expect(result.transactions).toHaveLength(4);

    // SELL - LIMIT bez Price per share → 110.50 / 2 = 55.25
    const sell = result.transactions[0]!;
    if (sell.type !== 'SELL') throw new Error('unreachable');
    expect(sell.pricePerShare.toString()).toBe('55.25');

    const buy = result.transactions[1]!;
    if (buy.type !== 'BUY') throw new Error('unreachable');
    expect(buy.pricePerShare.toString()).toBe('401');

    // peněžní hodnota s ISO kódem („USD 0.51“)
    const dividend = result.transactions.find((t) => t.type === 'DIVIDEND')!;
    if (dividend.type !== 'DIVIDEND') throw new Error('unreachable');
    expect(dividend.gross.toString()).toBe('0.51');

    // starší zápis CUSTODY_FEE s podtržítkem
    const fee = result.transactions.find((t) => t.type === 'FEE')!;
    if (fee.type !== 'FEE') throw new Error('unreachable');
    expect(fee.amount.toString()).toBe('0.02');

    // reversal + výběr = skipped
    expect(result.skipped).toHaveLength(2);
    expect(result.skipped.some((s) => s.message.includes('vratka poplatku'))).toBe(true);
  });

  it('nezmapovaný ticker: BUY se neimportuje (unmappedSymbols + error), dividenda projde bez ISIN', () => {
    const result = parseRevolutInvestCsv(REVOLUT_INVEST_UNMAPPED_CSV);

    expect(result.unmappedSymbols).toEqual(['NVDA']);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toBe(
      'Symbol NVDA: doplň ISIN instrumentu (Revolut ho neexportuje).',
    );

    expect(result.transactions).toHaveLength(1);
    const dividend = result.transactions[0]!;
    if (dividend.type !== 'DIVIDEND') throw new Error('unreachable');
    expect(dividend.isin).toBeUndefined();
    expect(dividend.ticker).toBe('NVDA');
    expect(dividend.gross.toString()).toBe('0.04');
  });

  it('neznámý typ řádku → error s číslem řádku a výzvou „nahlaš nám ho“', () => {
    const result = parseRevolutInvestCsv(REVOLUT_INVEST_UNKNOWN_TYPE_CSV, REVOLUT_INSTRUMENT_MAP);

    expect(result.transactions).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.line).toBe(2);
    expect(result.errors[0]!.message).toContain('LENDING INCOME');
    expect(result.errors[0]!.message).toContain('nahlaš nám ho');
  });

  it('nesmyslné datum → error řádku', () => {
    const csv = [
      REVOLUT_INVEST_HEADER,
      '2024-13-40T10:00:00.000Z,O,BUY - MARKET,1,$50.00,$50.00,USD,1.0800',
    ].join('\n');
    const result = parseRevolutInvestCsv(csv, REVOLUT_INSTRUMENT_MAP);

    expect(result.transactions).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.line).toBe(2);
    expect(result.errors[0]!.message).toContain('Neplatné datum');
  });

  it('prázdný soubor → prázdný výsledek, ne chyba; cizí soubor → error se sloupci', () => {
    const empty = parseRevolutInvestCsv('');
    expect(empty.errors).toEqual([]);
    expect(empty.transactions).toEqual([]);
    expect(empty.unmappedSymbols).toEqual([]);

    const foreign = parseRevolutInvestCsv('foo,bar\n1,2');
    expect(foreign.errors).toHaveLength(1);
    expect(foreign.errors[0]!.message).toContain('nevypadá jako akciový výpis Revolutu');
  });

  it('sniff: akciový výpis ano; krypto, univerzální šablona a prázdno ne', () => {
    expect(sniffRevolutInvestCsv(REVOLUT_INVEST_CSV)).toBe(true);
    expect(sniffRevolutInvestCsv(REVOLUT_CRYPTO_NEW_CSV)).toBe(false);
    expect(sniffRevolutInvestCsv(REVOLUT_CRYPTO_OLD_CSV)).toBe(false);
    expect(sniffRevolutInvestCsv(UNIVERSAL_TEMPLATE_CSV)).toBe(false);
    expect(sniffRevolutInvestCsv('')).toBe(false);
  });

  it('idempotentní id: dva parse téhož souboru → stejná id; identické řádky rozliší suffix', () => {
    const duplicated = [
      REVOLUT_INVEST_HEADER,
      '2024-01-05T10:00:00.000Z,O,BUY - MARKET,1,$50.00,$50.00,USD,1.0800',
      '2024-01-05T10:00:00.000Z,O,BUY - MARKET,1,$50.00,$50.00,USD,1.0800',
    ].join('\n');
    const first = parseRevolutInvestCsv(duplicated, REVOLUT_INSTRUMENT_MAP);
    const second = parseRevolutInvestCsv(duplicated, REVOLUT_INSTRUMENT_MAP);

    const firstIds = first.transactions.map((t) => t.id);
    expect(firstIds).toHaveLength(2);
    expect(new Set(firstIds).size).toBe(2); // suffix -2 pro identický řádek
    expect(second.transactions.map((t) => t.id)).toEqual(firstIds);

    const combined = dedupeTransactions(REVOLUT_BROKER, [
      ...first.transactions,
      ...second.transactions,
    ]);
    expect(combined.fresh).toHaveLength(2);
    expect(combined.duplicates).toBe(2);
  });

  it('opakovaný import happy-path souboru je idempotentní', () => {
    const first = parseRevolutInvestCsv(REVOLUT_INVEST_CSV, REVOLUT_INSTRUMENT_MAP);
    const second = parseRevolutInvestCsv(REVOLUT_INVEST_CSV, REVOLUT_INSTRUMENT_MAP);
    const combined = dedupeTransactions(REVOLUT_BROKER, [
      ...first.transactions,
      ...second.transactions,
    ]);
    expect(combined.fresh).toHaveLength(6);
    expect(combined.duplicates).toBe(6);
  });
});

describe('Revolut krypto — nový formát (Symbol,Type,Quantity,Price,Value,Fees,Date)', () => {
  it('happy path: Buy/Sell/Payment jako obchody; Send a Stake skipped; Staking reward warning', () => {
    const result = parseRevolutCryptoCsv(REVOLUT_CRYPTO_NEW_CSV);

    expect(result.broker).toBe(REVOLUT_BROKER);
    expect(result.errors).toEqual([]);
    expect(result.transactions).toHaveLength(5);
    expect(result.skipped).toHaveLength(2); // Send + Stake
    expect(result.warnings).toHaveLength(1); // Staking reward
  });

  it('Buy: assetClass CRYPTO, isin = symbol, cena z Price, měna ze symbolu €, anglické datum', () => {
    const result = parseRevolutCryptoCsv(REVOLUT_CRYPTO_NEW_CSV);

    const buy = result.transactions[0]!;
    if (buy.type !== 'BUY') throw new Error('unreachable');
    expect(buy.id).toMatch(/^rev-[0-9a-f]{16}$/);
    expect(buy.isin).toBe('BTC');
    expect(buy.ticker).toBe('BTC');
    expect(buy.assetClass).toBe('CRYPTO');
    expect(buy.quantity.toString()).toBe('0.01713112');
    expect(buy.pricePerShare.toString()).toBe('5837.33'); // tisícová čárka odstraněná
    expect(buy.currency).toBe('EUR');
    expect(buy.fee).toBeUndefined(); // nulový poplatek se neukládá
    expect(buy.tradeDate).toBe('2018-06-12'); // „Jun 12, 2018, 4:16:32 PM“
  });

  it('Payment → SELL s poznámkou o platbě kryptem; měna z $', () => {
    const result = parseRevolutCryptoCsv(REVOLUT_CRYPTO_NEW_CSV);

    const payment = result.transactions[2]!;
    if (payment.type !== 'SELL') throw new Error('unreachable');
    expect(payment.isin).toBe('BTC');
    expect(payment.quantity.toString()).toBe('0.00893541');
    expect(payment.pricePerShare.toString()).toBe('7252.05');
    expect(payment.currency).toBe('USD');
    expect(payment.note).toBe('platba kryptem = úplatný převod (zdanitelný)');
    expect(payment.tradeDate).toBe('2018-07-20');
  });

  it('měny £ a sufixový kód SEK; nenulový poplatek zvlášť', () => {
    const result = parseRevolutCryptoCsv(REVOLUT_CRYPTO_NEW_CSV);

    const ltc = result.transactions.find((t) => t.type === 'BUY' && t.isin === 'LTC')!;
    if (ltc.type !== 'BUY') throw new Error('unreachable');
    expect(ltc.currency).toBe('GBP');
    expect(ltc.pricePerShare.toString()).toBe('48');
    expect(ltc.fee?.amount.toString()).toBe('0.99');
    expect(ltc.fee?.currency).toBe('GBP');

    const doge = result.transactions.find((t) => t.type === 'BUY' && t.isin === 'DOGE')!;
    if (doge.type !== 'BUY') throw new Error('unreachable');
    expect(doge.currency).toBe('SEK');
    expect(doge.quantity.toString()).toBe('100');
    expect(doge.pricePerShare.toString()).toBe('0.5');
  });

  it('Send/Stake → skipped s vysvětlením; Staking reward → warning + skip', () => {
    const result = parseRevolutCryptoCsv(REVOLUT_CRYPTO_NEW_CSV);

    expect(result.skipped.some((s) => s.message.includes('vlastní peněženky'))).toBe(true);
    expect(result.skipped.some((s) => s.message.includes('stakingu'))).toBe(true);
    expect(result.warnings[0]!.message).toContain('odměn');
    // reward řádek se nesmí propsat do transakcí
    expect(result.transactions.some((t) => t.type === 'BUY' && t.isin === 'ETH')).toBe(false);
  });

  it('krypto↔krypto směna: pár Sell+Buy projde jako dva samostatné obchody se stejnou fiat hodnotou', () => {
    const result = parseRevolutCryptoCsv(REVOLUT_CRYPTO_EXCHANGE_PAIR_CSV);

    expect(result.errors).toEqual([]);
    expect(result.transactions).toHaveLength(2);

    const sell = result.transactions[0]!;
    if (sell.type !== 'SELL') throw new Error('unreachable');
    expect(sell.isin).toBe('BTC');
    expect(sell.quantity.toString()).toBe('0.005');
    expect(sell.pricePerShare.toString()).toBe('60000');
    expect(sell.currency).toBe('EUR');

    const buy = result.transactions[1]!;
    if (buy.type !== 'BUY') throw new Error('unreachable');
    expect(buy.isin).toBe('ETH');
    expect(buy.quantity.toString()).toBe('0.12');
    expect(buy.pricePerShare.toString()).toBe('2500');
    expect(buy.tradeDate).toBe(sell.tradeDate); // stejný okamžik směny

    // prodej i nákup jsou oceněné stejným fiat protiplněním (300 EUR)
    expect(sell.quantity.mul(sell.pricePerShare).toString()).toBe('300');
    expect(buy.quantity.mul(buy.pricePerShare).toString()).toBe('300');
  });

  it('neznámý typ → error; neurčitelná měna → error', () => {
    const unknown = parseRevolutCryptoCsv(REVOLUT_CRYPTO_NEW_UNKNOWN_TYPE_CSV);
    expect(unknown.transactions).toEqual([]);
    expect(unknown.errors).toHaveLength(1);
    expect(unknown.errors[0]!.line).toBe(2);
    expect(unknown.errors[0]!.message).toContain('Airdrop');

    const noCurrency = parseRevolutCryptoCsv(REVOLUT_CRYPTO_NEW_NO_CURRENCY_CSV);
    expect(noCurrency.transactions).toEqual([]);
    expect(noCurrency.errors).toHaveLength(1);
    expect(noCurrency.errors[0]!.message).toContain('určit měnu');
  });
});

describe('Revolut krypto — starý formát (13 sloupců)', () => {
  it('happy path: EXCHANGE ±Amount → BUY/SELL, CARD_PAYMENT → SELL; migrace, closing a REVERTED skipped', () => {
    const result = parseRevolutCryptoCsv(REVOLUT_CRYPTO_OLD_CSV);

    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.transactions).toHaveLength(3);
    expect(result.skipped).toHaveLength(3);
    expect(result.skipped.some((s) => s.message.includes('migrace zůstatku'))).toBe(true);
    expect(result.skipped.some((s) => s.message.includes('uzavírací'))).toBe(true);
    expect(result.skipped.some((s) => s.message.includes('REVERTED'))).toBe(true);
  });

  it('EXCHANGE nákup: quantity = Amount, cena = Fiat/Amount Decimalem, fee v Base currency', () => {
    const result = parseRevolutCryptoCsv(REVOLUT_CRYPTO_OLD_CSV);

    const buy = result.transactions[0]!;
    if (buy.type !== 'BUY') throw new Error('unreachable');
    expect(buy.isin).toBe('MATIC');
    expect(buy.assetClass).toBe('CRYPTO');
    expect(buy.quantity.toString()).toBe('0.310358');
    expect(buy.currency).toBe('EUR');
    expect(buy.fee?.amount.toString()).toBe('0.02');
    expect(buy.fee?.currency).toBe('EUR');
    expect(buy.tradeDate).toBe('2021-06-04');
    // celková cena = |Fiat amount| (0.41 EUR, bez poplatku)
    expect(buy.quantity.mul(buy.pricePerShare).toDecimalPlaces(2).toString()).toBe('0.41');
  });

  it('EXCHANGE se záporným Amount → SELL s kladným množstvím', () => {
    const result = parseRevolutCryptoCsv(REVOLUT_CRYPTO_OLD_CSV);

    const sell = result.transactions[1]!;
    if (sell.type !== 'SELL') throw new Error('unreachable');
    expect(sell.isin).toBe('MATIC');
    expect(sell.quantity.toString()).toBe('0.15');
    expect(sell.currency).toBe('EUR');
    expect(sell.fee?.amount.toString()).toBe('0.01');
    expect(sell.tradeDate).toBe('2022-01-10');
    expect(sell.quantity.mul(sell.pricePerShare).toDecimalPlaces(2).toString()).toBe('0.35');
  });

  it('CARD_PAYMENT → SELL s poznámkou o platbě kryptem, fiat v Base currency (SEK)', () => {
    const result = parseRevolutCryptoCsv(REVOLUT_CRYPTO_OLD_CSV);

    const payment = result.transactions[2]!;
    if (payment.type !== 'SELL') throw new Error('unreachable');
    expect(payment.isin).toBe('EOS');
    expect(payment.quantity.toString()).toBe('25');
    expect(payment.pricePerShare.toString()).toBe('20'); // 500 / 25
    expect(payment.currency).toBe('SEK');
    expect(payment.fee?.amount.toString()).toBe('4.25');
    expect(payment.fee?.currency).toBe('SEK');
    expect(payment.note).toBe('platba kryptem = úplatný převod (zdanitelný)');
    expect(payment.tradeDate).toBe('2023-05-06');
  });

  it('nepodporovaný Type → warning + skip, ne error', () => {
    const result = parseRevolutCryptoCsv(REVOLUT_CRYPTO_OLD_UNSUPPORTED_TYPE_CSV);

    expect(result.transactions).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]!.message).toContain('REWARD');
    expect(result.warnings[0]!.message).toContain('nepodporujeme');
  });

  it('idempotentní id: opakovaný import starého formátu se deduplikuje', () => {
    const first = parseRevolutCryptoCsv(REVOLUT_CRYPTO_OLD_CSV);
    const second = parseRevolutCryptoCsv(REVOLUT_CRYPTO_OLD_CSV);
    const combined = dedupeTransactions(REVOLUT_BROKER, [
      ...first.transactions,
      ...second.transactions,
    ]);
    expect(combined.fresh).toHaveLength(3);
    expect(combined.duplicates).toBe(3);
  });
});

describe('Revolut krypto — společné', () => {
  it('prázdný soubor → prázdný výsledek; cizí soubor → error s vysvětlením', () => {
    const empty = parseRevolutCryptoCsv('');
    expect(empty.errors).toEqual([]);
    expect(empty.transactions).toEqual([]);

    const foreign = parseRevolutCryptoCsv('foo,bar\n1,2');
    expect(foreign.transactions).toEqual([]);
    expect(foreign.errors).toHaveLength(1);
    expect(foreign.errors[0]!.line).toBe(1);
    expect(foreign.errors[0]!.message).toContain('nevypadá jako krypto výpis Revolutu');
  });

  it('sniff: nový i starý formát ano; akciový výpis, univerzální šablona a prázdno ne', () => {
    expect(sniffRevolutCryptoCsv(REVOLUT_CRYPTO_NEW_CSV)).toBe(true);
    expect(sniffRevolutCryptoCsv(REVOLUT_CRYPTO_OLD_CSV)).toBe(true);
    expect(sniffRevolutCryptoCsv(REVOLUT_INVEST_CSV)).toBe(false);
    expect(sniffRevolutCryptoCsv(UNIVERSAL_TEMPLATE_CSV)).toBe(false);
    expect(sniffRevolutCryptoCsv('')).toBe(false);
  });

  it('id nového formátu jsou stabilní mezi dvěma parse', () => {
    const first = parseRevolutCryptoCsv(REVOLUT_CRYPTO_NEW_CSV);
    const second = parseRevolutCryptoCsv(REVOLUT_CRYPTO_NEW_CSV);
    expect(second.transactions.map((t) => t.id)).toEqual(first.transactions.map((t) => t.id));

    const combined = dedupeTransactions(REVOLUT_BROKER, [
      ...first.transactions,
      ...second.transactions,
    ]);
    expect(combined.fresh).toHaveLength(5);
    expect(combined.duplicates).toBe(5);
  });
});

describe('lokalizovaná čísla: tisíce vs. desetinná místa (B-3-12)', () => {
  it('evropský výpis: „0,125“ je 0,125 BTC, ne 125 BTC', () => {
    // Do 12. 8. 2026 vyhrávaly u trojčíslí vždycky tisíce, takže se z nákupu
    // 0,125 BTC stal nákup 125 BTC — mlčky, bez chyby i bez varování.
    const csv = [
      REVOLUT_CRYPTO_NEW_HEADER,
      'BTC,Buy,"0,125","60000,50 EUR","7500,06 EUR","0,00 EUR","Jun 12, 2018, 4:16:32 PM"',
      'ETH,Buy,"0,76672417","2000,25 EUR","1533,66 EUR","0,00 EUR","Jun 13, 2018, 4:16:32 PM"',
    ].join('\n');
    const result = parseRevolutCryptoCsv(csv);
    expect(result.errors).toEqual([]);
    const buy = result.transactions[0]!;
    if (buy.type !== 'BUY') throw new Error('čekáme nákup');
    expect(buy.quantity.toString()).toBe('0.125');
  });

  it('anglický výpis: „1,500“ kusů je patnáct set kusů', () => {
    const csv = [
      REVOLUT_INVEST_HEADER,
      '2023-09-22T13:30:10.514Z,MSFT,BUY - MARKET,"1,500",$26.09,"$39,135.00",USD,1.0665',
    ].join('\n');
    const result = parseRevolutInvestCsv(csv, { MSFT: { isin: 'US5949181045' } });
    expect(result.errors).toEqual([]);
    const buy = result.transactions[0]!;
    if (buy.type !== 'BUY') throw new Error('čekáme nákup');
    expect(buy.quantity.toString()).toBe('1500');
    expect(result.warnings).toEqual([]);
  });

  it('bez rozhodujícího čísla se nehádá tiše — varuje', () => {
    const csv = [
      REVOLUT_INVEST_HEADER,
      '2023-09-22T13:30:10.514Z,MSFT,BUY - MARKET,"1,500",$26,"$39135",USD,1',
    ].join('\n');
    const result = parseRevolutInvestCsv(csv, { MSFT: { isin: 'US5949181045' } });
    expect(result.errors).toEqual([]);
    expect(result.warnings.map((w) => w.message).join(' ')).toContain('tisíckrát');
  });
});

describe('Revolut jako XLSX (volba „Excel“ nevrací vždycky CSV)', () => {
  const buildXlsx = async (headers: string[], rows: string[][]): Promise<Buffer> => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Statement');
    sheet.addRow(headers);
    for (const row of rows) sheet.addRow(row);
    const raw = await workbook.xlsx.writeBuffer();
    return Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer);
  };

  const asTable = (csv: string): { headers: string[]; rows: string[][] } => {
    const parsed = parseCsv(csv);
    return { headers: parsed.headers, rows: parsed.rows };
  };

  it('akciový sešit dá tytéž transakce jako totéž CSV', async () => {
    const { headers, rows } = asTable(REVOLUT_INVEST_CSV);
    const buffer = await buildXlsx(headers, rows);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    expect(sniffRevolutXlsx(workbook)).toBe(true);

    const zeSesitu = await parseRevolutXlsx(buffer, REVOLUT_INSTRUMENT_MAP);
    const zCsv = parseRevolutInvestCsv(REVOLUT_INVEST_CSV, REVOLUT_INSTRUMENT_MAP);
    expect(zeSesitu.errors).toEqual(zCsv.errors);
    expect(zeSesitu.transactions).toEqual(zCsv.transactions);
  });

  it('krypto sešit dá tytéž transakce jako totéž CSV', async () => {
    const { headers, rows } = asTable(REVOLUT_CRYPTO_NEW_CSV);
    const buffer = await buildXlsx(headers, rows);
    const zeSesitu = await parseRevolutXlsx(buffer);
    const zCsv = parseRevolutCryptoCsv(REVOLUT_CRYPTO_NEW_CSV);
    expect(zeSesitu.errors).toEqual(zCsv.errors);
    expect(zeSesitu.transactions).toEqual(zCsv.transactions);
  });

  it('cizí sešit se nevydává za Revolut a hláška vypíše nalezené sloupce', async () => {
    const buffer = await buildXlsx(['ID', 'Type', 'Time', 'Symbol'], [['1', 'buy', '2026', 'X']]);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    expect(sniffRevolutXlsx(workbook)).toBe(false);
    const result = await parseRevolutXlsx(buffer);
    expect(result.transactions).toEqual([]);
    expect(result.errors[0]!.message).toContain('V prvním řádku jsme našli');
  });
});

describe('sešit s preambulí (číslo účtu a období nad tabulkou)', () => {
  it('hlavička se najde i pod pár řádky metadat', async () => {
    // Reálný „Account statement“ z Revolutu začíná blokem o účtu a období —
    // brát první řádek jako hlavičku by uživatele vrátilo k „XLSX nepoznáváme“.
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Statement');
    sheet.addRow(['Account statement']);
    sheet.addRow(['Jan Novák']);
    sheet.addRow(['Period', '1 Jan 2026 - 31 Dec 2026']);
    sheet.addRow([]);
    const { headers, rows } = parseCsv(REVOLUT_INVEST_CSV);
    sheet.addRow(headers);
    for (const row of rows) sheet.addRow(row);
    const raw = await workbook.xlsx.writeBuffer();
    const buffer = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer);

    const nacteny = new ExcelJS.Workbook();
    await nacteny.xlsx.load(buffer as unknown as ArrayBuffer);
    expect(sniffRevolutXlsx(nacteny)).toBe(true);

    const zeSesitu = await parseRevolutXlsx(buffer, REVOLUT_INSTRUMENT_MAP);
    const zCsv = parseRevolutInvestCsv(REVOLUT_INVEST_CSV, REVOLUT_INSTRUMENT_MAP);
    expect(zeSesitu.errors).toEqual(zCsv.errors);
    expect(zeSesitu.transactions).toEqual(zCsv.transactions);
  });
});
