import { describe, expect, it } from 'vitest';
import { dedupeKey, dedupeTransactions } from '../src';
import {
  KRAKEN_BROKER,
  normalizeKrakenAsset,
  parseKrakenCsv,
  sniffKrakenCsv,
} from '../src/kraken/csv';
import { COINBASE_V4 } from './fixtures/coinbase';
import {
  KRAKEN_AIRDROPS,
  KRAKEN_BAD_DATE,
  KRAKEN_CRYPTO_CRYPTO,
  KRAKEN_CRYPTO_FEE,
  KRAKEN_FIAT_FIAT,
  KRAKEN_FIAT_TRANSFERS,
  KRAKEN_INTERNAL_CODES_NEW,
  KRAKEN_INTERNAL_CODES_OLD,
  KRAKEN_INTERNAL_FIAT_CODES,
  KRAKEN_KFEE_TRADE,
  KRAKEN_KFEE_TRADE_FEE_FIRST,
  KRAKEN_LEDGERS_NEW,
  KRAKEN_LEDGERS_OLD,
  KRAKEN_MARGIN,
  KRAKEN_MISC_TYPES,
  KRAKEN_STAKING_NO_SUBTYPE_COLUMN,
  KRAKEN_TINY_AMOUNTS,
  KRAKEN_TRADES_CSV,
  KRAKEN_TRANSFERS_NOT_CANCELLING,
  KRAKEN_UNPAIRED,
  KRAKEN_WALLET_TRANSFERS,
  KRAKEN_ZERO_LEG_WITHOUT_FEE,
  T212_HEADER_SAMPLE,
} from './fixtures/kraken';

describe('Kraken ledgers.csv parser', () => {
  it('happy path (nová hlavička s wallet): BUY + SELL + karta, vklad/výběr skipped, staking warning', () => {
    const result = parseKrakenCsv(KRAKEN_LEDGERS_NEW);

    expect(result.broker).toBe(KRAKEN_BROKER);
    expect(result.errors).toEqual([]);
    expect(result.transactions).toHaveLength(3);
    expect(result.transactions.map((t) => t.type)).toEqual(['BUY', 'SELL', 'BUY']);
    // vklad + výběr = převody, vědomě přeskočeno
    expect(result.skipped).toHaveLength(2);
    expect(result.skipped[0]!.line).toBe(2);
    expect(result.skipped[1]!.line).toBe(10);
    // staking odměna = warning (zatím daňově nezařazujeme)
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]!.line).toBe(9);
    expect(result.warnings[0]!.message).toContain('staking');
  });

  it('BUY z páru trade řádků: kusy z krypto nohy, cena |fiat|/qty Decimalem, fee z fiat nohy', () => {
    const result = parseKrakenCsv(KRAKEN_LEDGERS_NEW);

    const buy = result.transactions[0]!;
    if (buy.type !== 'BUY') throw new Error('unreachable');
    expect(buy.id).toBe('kraken-LS4N2A-5DK5R-DRB7ZL'); // txid krypto nohy
    expect(buy.isin).toBe('BTC'); // XXBT → BTC
    expect(buy.assetClass).toBe('CRYPTO');
    expect(buy.quantity.toString()).toBe('0.002');
    expect(buy.pricePerShare.toString()).toBe('50000'); // 100 EUR / 0.002 BTC
    expect(buy.currency).toBe('EUR'); // ZEUR → EUR
    expect(buy.fee?.amount.toString()).toBe('0.18');
    expect(buy.fee?.currency).toBe('EUR');
    expect(buy.tradeDate).toBe('2024-03-19');
  });

  it('SELL z páru trade řádků: krypto −, fiat + → prodej oceněný fiat protihodnotou', () => {
    const result = parseKrakenCsv(KRAKEN_LEDGERS_NEW);

    const sell = result.transactions[1]!;
    if (sell.type !== 'SELL') throw new Error('unreachable');
    expect(sell.id).toBe('kraken-LWXHDF-MB4N7-DPQXVJ');
    expect(sell.isin).toBe('LTC'); // XLTC → LTC
    expect(sell.quantity.toString()).toBe('1');
    expect(sell.pricePerShare.toString()).toBe('80');
    expect(sell.currency).toBe('EUR');
    expect(sell.fee?.amount.toString()).toBe('0.2'); // fee z fiat nohy
    expect(sell.tradeDate).toBe('2024-04-02');
  });

  it('pár spend+receive (nákup kartou) se zpracuje jako BUY', () => {
    const result = parseKrakenCsv(KRAKEN_LEDGERS_NEW);

    const cardBuy = result.transactions[2]!;
    if (cardBuy.type !== 'BUY') throw new Error('unreachable');
    expect(cardBuy.id).toBe('kraken-LPO9I8-ASDFG-HJKLM2');
    expect(cardBuy.isin).toBe('BTC');
    expect(cardBuy.quantity.toString()).toBe('0.001');
    expect(cardBuy.pricePerShare.toString()).toBe('50000');
    expect(cardBuy.fee).toBeUndefined();
  });

  it('stará hlavička bez wallet, assety bez prefixů, čas se zlomky sekund', () => {
    const result = parseKrakenCsv(KRAKEN_LEDGERS_OLD);

    expect(result.errors).toEqual([]);
    expect(result.transactions).toHaveLength(1);
    const buy = result.transactions[0]!;
    if (buy.type !== 'BUY') throw new Error('unreachable');
    expect(buy.isin).toBe('BTC');
    expect(buy.currency).toBe('EUR');
    expect(buy.quantity.toString()).toBe('0.01');
    expect(buy.pricePerShare.toString()).toBe('20000');
    expect(buy.fee?.amount.toString()).toBe('0.32');
    expect(buy.tradeDate).toBe('2023-01-15');
  });

  it('normalizace assetů: X/Z prefixy, XXBT→BTC, XXDG→DOGE, sufix .S, neznámé kódy beze změny', () => {
    expect(normalizeKrakenAsset('XXBT')).toBe('BTC');
    expect(normalizeKrakenAsset('XBT')).toBe('BTC');
    expect(normalizeKrakenAsset('XETH')).toBe('ETH');
    expect(normalizeKrakenAsset('XXDG')).toBe('DOGE');
    expect(normalizeKrakenAsset('ZEUR')).toBe('EUR');
    expect(normalizeKrakenAsset('ZCZK')).toBe('CZK');
    expect(normalizeKrakenAsset('ADA.S')).toBe('ADA');
    expect(normalizeKrakenAsset('XXBT.S')).toBe('BTC'); // sufix + alias zároveň
    expect(normalizeKrakenAsset('SOL')).toBe('SOL');
    expect(normalizeKrakenAsset('EUR')).toBe('EUR');
  });

  it('směna krypto–krypto → warning + skip obou řádků (bez transakce)', () => {
    const result = parseKrakenCsv(KRAKEN_CRYPTO_CRYPTO);

    expect(result.transactions).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]!.message).toContain('krypto–krypto');
    expect(result.warnings[0]!.message).toContain('BTC → ETH');
    expect(result.warnings[0]!.message).toContain('univerzální šablonu');
  });

  it('poplatek v kryptoměně → warning, obchod se zpracuje bez poplatku', () => {
    const result = parseKrakenCsv(KRAKEN_CRYPTO_FEE);

    expect(result.errors).toEqual([]);
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0]!.type).toBe('BUY');
    if (result.transactions[0]!.type !== 'BUY') throw new Error('unreachable');
    expect(result.transactions[0]!.fee).toBeUndefined();
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]!.message).toContain('kryptoměně');
    expect(result.warnings[0]!.message).toContain('nebyl odečten');
  });

  it('fiat–fiat pár (FX konverze) → skipped, ne obchod', () => {
    const result = parseKrakenCsv(KRAKEN_FIAT_FIAT);

    expect(result.transactions).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]!.message).toContain('EUR');
    expect(result.skipped[0]!.message).toContain('USD');
  });

  it('nespárovaný trade řádek → error s číslem řádku', () => {
    const result = parseKrakenCsv(KRAKEN_UNPAIRED);

    expect(result.transactions).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.line).toBe(2);
    expect(result.errors[0]!.message).toContain('párový řádek');
  });

  it('margin trade a rollover → warning + skip (zatím nepodporujeme)', () => {
    const result = parseKrakenCsv(KRAKEN_MARGIN);

    expect(result.transactions).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings.every((w) => w.message.includes('margin'))).toBe(true);
  });

  it('earn reward → warning; earn allocation a transfer → skipped bez varování; neznámý typ → warning', () => {
    const result = parseKrakenCsv(KRAKEN_MISC_TYPES);

    expect(result.transactions).toEqual([]);
    expect(result.errors).toEqual([]);
    // earn/reward + adjustment = warningy
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings[0]!.line).toBe(2);
    expect(result.warnings[0]!.message).toContain('nezařazujeme');
    expect(result.warnings[1]!.line).toBe(5);
    expect(result.warnings[1]!.message).toContain('adjustment');
    // allocation + transfer = tiché přesuny
    expect(result.skipped).toHaveLength(2);
    expect(result.skipped.map((s) => s.line)).toEqual([3, 4]);
  });

  it('nesmyslné kalendářní datum → error na obou nohách páru', () => {
    const result = parseKrakenCsv(KRAKEN_BAD_DATE);

    expect(result.transactions).toEqual([]);
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0]!.message).toContain('Neplatný čas');
    expect(result.errors.map((e) => e.line)).toEqual([2, 3]);
  });

  it('trades.csv se odmítne s vysvětlením (dvojí započtení)', () => {
    const result = parseKrakenCsv(KRAKEN_TRADES_CSV);

    expect(result.transactions).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.line).toBe(1);
    expect(result.errors[0]!.message).toBe(
      'Nahraj prosím export Ledgers (ledgers.csv) — obsahuje kompletní historii včetně vkladů; trades.csv by vedl ke dvojímu započtení.',
    );
  });

  it('prázdný soubor = prázdný výsledek, ne chyba', () => {
    const result = parseKrakenCsv('');

    expect(result.transactions).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.skipped).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('cizí formát bez ledger sloupců → error na hlavičce', () => {
    const result = parseKrakenCsv(`${T212_HEADER_SAMPLE}\nMarket buy,2024-01-02 10:00:00`);

    expect(result.transactions).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.line).toBe(1);
    expect(result.errors[0]!.message).toContain('nevypadá jako Kraken ledgers.csv');
  });

  it('sniff: true na obě generace ledgers i na trades.csv (to parser odmítne s návodem), false na T212 a Coinbase', () => {
    expect(sniffKrakenCsv(KRAKEN_LEDGERS_NEW)).toBe(true);
    expect(sniffKrakenCsv(KRAKEN_LEDGERS_OLD)).toBe(true);
    expect(sniffKrakenCsv(KRAKEN_TRADES_CSV)).toBe(true);
    expect(sniffKrakenCsv(T212_HEADER_SAMPLE)).toBe(false);
    expect(sniffKrakenCsv(COINBASE_V4)).toBe(false);
    expect(sniffKrakenCsv('')).toBe(false);
  });

  it('dedupe-stabilita: dva parse téhož souboru → stejná id, opakovaný import = samé duplicity', () => {
    const first = parseKrakenCsv(KRAKEN_LEDGERS_NEW);
    const second = parseKrakenCsv(KRAKEN_LEDGERS_NEW);

    const firstIds = first.transactions.map((t) => t.id);
    expect(firstIds.every((id) => id.startsWith('kraken-'))).toBe(true);
    expect(new Set(firstIds).size).toBe(firstIds.length);
    expect(second.transactions.map((t) => t.id)).toEqual(firstIds);

    const combined = dedupeTransactions(KRAKEN_BROKER, [
      ...first.transactions,
      ...second.transactions,
    ]);
    expect(combined.fresh).toHaveLength(3);
    expect(combined.duplicates).toBe(3);
  });
});

/**
 * L2d-02: přírůstek aktiva bez protistrany není „interní přesun“. Kdo dostal
 * airdrop a kusy později prodal, viděl jen chybu o neúplné historii — řádek
 * skončil mezi přeskočenými, u kterých UI ukazuje jen počet.
 */
describe('airdrop a fork nejsou interní přesun (L2d-02)', () => {
  const result = parseKrakenCsv(KRAKEN_AIRDROPS);
  const warningAt = (line: number): string =>
    result.warnings.find((w) => w.line === line)?.message ?? '';

  it('transfer bez subtypu s kladnou částkou → podmíněné varování s návodem', () => {
    expect(result.errors).toEqual([]);
    expect(result.transactions).toEqual([]);
    expect(warningAt(2)).toContain('150 FLR');
    expect(warningAt(2)).toContain('Pokud jde o airdrop nebo fork');
    expect(warningAt(2)).toContain('univerzální šablonu');
    expect(warningAt(2)).not.toContain('ne daňová událost');
  });

  it('subtyp airdrop varuje u transfer i u earn', () => {
    expect(warningAt(3)).toContain('40 SGB');
    expect(warningAt(3)).toContain('airdrop');
    expect(warningAt(4)).toContain('12 SGB');
    expect(warningAt(4)).toContain('univerzální šablonu');
  });

  it('delistingconversion varuje u přírůstku i úbytku', () => {
    expect(warningAt(5)).toContain('-30 NANO');
    expect(warningAt(5)).toContain('stažení aktiva z nabídky');
    expect(warningAt(6)).toContain('0.0004 BTC');
    expect(warningAt(6)).toContain('univerzální šablonu');
  });

  it('neznámý subtyp přesunu varuje — ticho je jen pro vyjmenované', () => {
    expect(warningAt(11)).toContain('vaultmove');
    expect(warningAt(11)).toContain('univerzální šablonu');
  });

  it('skutečné přesuny (spot ↔ staking, spot ↔ futures, Earn) zůstávají tiché', () => {
    expect(result.warnings.map((w) => w.line)).toEqual([2, 3, 4, 5, 6, 11]);
    expect(result.skipped.map((s) => s.line)).toEqual([7, 8, 9, 10, 12]);
  });

  it('každý ze šesti vyjmenovaných přesunů mezi peněženkami je tichý i sám o sobě (A06-R1-03)', () => {
    const transfers = parseKrakenCsv(KRAKEN_WALLET_TRANSFERS);

    expect(transfers.errors).toEqual([]);
    expect(transfers.warnings).toEqual([]);
    expect(transfers.skipped.map((s) => s.line)).toEqual([2, 3, 4, 5, 6, 7]);
  });
});

/**
 * A06-R1-01: varování „připsání bez protistrany“ musí platit. Kdo stakoval
 * a nahrál export bez sloupce `subtype` (nebo s prázdným subtypem), četl u kusů,
 * které řádně nakoupil, že jim hrozí nulová nabývací cena — a kdo radu poslechl
 * a doplnil je šablonou, zdvojil si pozici. Protistrana přitom ležela o řádek
 * výš: stejný refid, stejně velký úbytek téhož aktiva.
 */
describe('přesun, který se ve stejném refid vyruší, není připsání bez protistrany (A06-R1-01)', () => {
  it('export bez sloupce subtype: přesun do stakingu i zpět je tichý', () => {
    expect(sniffKrakenCsv(KRAKEN_STAKING_NO_SUBTYPE_COLUMN)).toBe(true);
    const result = parseKrakenCsv(KRAKEN_STAKING_NO_SUBTYPE_COLUMN);

    expect(result.errors).toEqual([]);
    expect(result.transactions).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.skipped.map((s) => s.line)).toEqual([2, 3, 4, 5]);
    expect(result.skipped[1]!.message).toContain('Interní přesun');
    expect(result.skipped[1]!.message).toContain('DOT');
  });

  it('totéž s prázdným subtypem v plné hlavičce', () => {
    const [, ...rows] = KRAKEN_STAKING_NO_SUBTYPE_COLUMN.split('\n');
    const withEmptySubtype = [
      '"txid","refid","time","type","subtype","aclass","asset","amount","fee","balance"',
      ...rows.map((row) => row.replace('"transfer",', '"transfer","",')),
    ].join('\n');
    const result = parseKrakenCsv(withEmptySubtype);

    expect(result.warnings).toEqual([]);
    expect(result.skipped.map((s) => s.line)).toEqual([2, 3, 4, 5]);
  });

  it('co se nevyruší, varuje dál: jiná velikost, jiné aktivum, prázdný refid, nečitelná částka, osamocený řádek', () => {
    const result = parseKrakenCsv(KRAKEN_TRANSFERS_NOT_CANCELLING);

    expect(result.errors).toEqual([]);
    // úbytky bez subtypu jsou tiché jako dřív, přírůstky protistranu nemají
    expect(result.skipped.map((s) => s.line)).toEqual([2, 4, 6, 10]);
    expect(result.warnings.map((w) => w.line)).toEqual([3, 5, 7, 8, 9, 11]);
    expect(result.warnings[0]!.message).toContain('Připsání 120 ADA bez protistrany');
    expect(result.warnings[1]!.message).toContain('Připsání 5 KSM bez protistrany');
    expect(result.warnings[2]!.message).toContain('Připsání 8 XTZ bez protistrany');
    expect(result.warnings[4]!.message).toContain('Připsání 30 ALGO bez protistrany');
  });
});

/**
 * A06-R1-02: příchozí převod eur dostal varování o airdropu a „prodeji těchto
 * kusů“. Fiat měna airdrop ani fork být nemůže a evidenci kusů pro ni nevedeme —
 * vklad eur končí tiše mezi přeskočenými a fiat přesun má skončit stejně.
 */
describe('přesun ve fiat měně není airdrop (A06-R1-02)', () => {
  const result = parseKrakenCsv(KRAKEN_FIAT_TRANSFERS);

  it('transfer ve fiat měně je tichý bez ohledu na subtyp a znaménko', () => {
    expect(result.errors).toEqual([]);
    expect(result.skipped.map((s) => s.line)).toEqual([2, 3, 4]);
    expect(result.skipped[0]!.message).toContain('EUR');
    expect(result.skipped[0]!.message).toContain('ne zdanitelná událost');
    expect(result.warnings.map((w) => w.message).join('\n')).not.toContain('airdrop nebo fork');
  });

  it('delistingconversion ve fiat měně varuje dál — částka je výnos z nuceného převodu pozice', () => {
    expect(result.warnings.map((w) => w.line)).toEqual([5]);
    expect(result.warnings[0]!.message).toContain('42 EUR');
    expect(result.warnings[0]!.message).toContain('stažení aktiva z nabídky');
  });
});

/**
 * A06-R1-04: množství má uživatel podle rady opsat do univerzální šablony —
 * „2e-7 BTC“ tam neopíše nikdo.
 */
describe('množství v hláškách je v desetinném zápisu (A06-R1-04)', () => {
  const messages = parseKrakenCsv(KRAKEN_TINY_AMOUNTS)
    .warnings.map((w) => w.message)
    .join('\n');

  it('airdrop pod 0,000001 kusu', () => {
    expect(messages).toContain('Připsání 0.0000002 BTC');
  });

  it('poplatek na samostatném řádku pod 0,000001 kusu', () => {
    expect(messages).toContain('poplatek 0.0000005 ETH');
  });

  it('žádná hláška neobsahuje vědecký zápis', () => {
    expect(messages).not.toMatch(/\de-\d/);
  });
});

/**
 * L2d-04: mapa aliasů neznala XETC, XREP, XMLN, ZPLN, ZSEK a ZDKK. Tentýž
 * obchod měl podle generace exportu jiný symbol i dedupe klíč (zdvojení při
 * nahrání staršího a novějšího exportu) a nákup za zloté vypadal jako směna
 * krypto–krypto.
 */
describe('interní kódy aktiv Krakenu (L2d-04)', () => {
  it('doložené interní kódy se přeloží na běžný symbol', () => {
    expect(normalizeKrakenAsset('XETC')).toBe('ETC');
    expect(normalizeKrakenAsset('XREP')).toBe('REP');
    expect(normalizeKrakenAsset('XMLN')).toBe('MLN');
    expect(normalizeKrakenAsset('ZPLN')).toBe('PLN');
    expect(normalizeKrakenAsset('ZSEK')).toBe('SEK');
    expect(normalizeKrakenAsset('ZDKK')).toBe('DKK');
  });

  it('prefix se neodřezává: ZCHF je jiné aktivum než CHF', () => {
    expect(normalizeKrakenAsset('ZCHF')).toBe('ZCHF');
    expect(normalizeKrakenAsset('XTZ')).toBe('XTZ');
    expect(normalizeKrakenAsset('ZRX')).toBe('ZRX');
  });

  it('starý i nový zápis téhož obchodu dá stejný symbol i dedupe klíč', () => {
    const oldCodes = parseKrakenCsv(KRAKEN_INTERNAL_CODES_OLD);
    const newCodes = parseKrakenCsv(KRAKEN_INTERNAL_CODES_NEW);

    expect(oldCodes.errors).toEqual([]);
    expect(oldCodes.transactions.map((t) => ('isin' in t ? t.isin : ''))).toEqual([
      'ETC',
      'REP',
      'MLN',
    ]);
    expect(oldCodes.transactions.map((t) => dedupeKey(KRAKEN_BROKER, t))).toEqual(
      newCodes.transactions.map((t) => dedupeKey(KRAKEN_BROKER, t)),
    );

    // starší export a po něm novější: druhé nahrání jsou samé duplicity
    const combined = dedupeTransactions(KRAKEN_BROKER, [
      ...oldCodes.transactions,
      ...newCodes.transactions,
    ]);
    expect(combined.fresh).toHaveLength(3);
    expect(combined.duplicates).toBe(3);
  });

  it('nákup za ZPLN, ZSEK a ZDKK je obyčejný BUY, ne směna krypto–krypto', () => {
    const result = parseKrakenCsv(KRAKEN_INTERNAL_FIAT_CODES);

    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.transactions.map((t) => t.type)).toEqual(['BUY', 'BUY', 'BUY']);
    expect(result.transactions.map((t) => ('currency' in t ? t.currency : ''))).toEqual([
      'PLN',
      'SEK',
      'DKK',
    ]);
    const first = result.transactions[0]!;
    if (first.type !== 'BUY') throw new Error('unreachable');
    expect(first.pricePerShare.toString()).toBe('200000'); // 2000 PLN / 0.01 BTC
    expect(first.fee?.currency).toBe('PLN');
  });
});

/**
 * L2d-06: poplatek z kreditů KFEE je třetí řádek se stejným refid a nulovou
 * částkou. Kontrola „právě dvě nohy“ kvůli němu odmítla celý obchod s radou
 * stáhnout kompletní export — který kompletní byl.
 */
describe('obchod s poplatkem na samostatném řádku (L2d-06)', () => {
  it.each([
    ['řádek poplatku na konci', KRAKEN_KFEE_TRADE, 4],
    ['řádek poplatku jako první', KRAKEN_KFEE_TRADE_FEE_FIRST, 2],
  ])('%s → 1 obchod a 1 varování', (_label, csv, feeLine) => {
    const result = parseKrakenCsv(csv);

    expect(result.errors).toEqual([]);
    expect(result.transactions).toHaveLength(1);
    const buy = result.transactions[0]!;
    if (buy.type !== 'BUY') throw new Error('unreachable');
    expect(buy.isin).toBe('BTC');
    expect(buy.quantity.toString()).toBe('0.03');
    expect(buy.pricePerShare.toString()).toBe('20000'); // 600 EUR / 0.03 BTC
    expect(buy.fee).toBeUndefined();

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]!.line).toBe(feeLine);
    expect(result.warnings[0]!.message).toContain('156 KFEE');
    expect(result.warnings[0]!.message).toContain('nebyl odečten');
  });

  it('řádek poplatku nenahradí chybějící nohu — osamocená noha je dál chyba', () => {
    const withoutCryptoLeg = KRAKEN_KFEE_TRADE.split('\n')
      .filter((line) => !line.includes('"XXBT"'))
      .join('\n');
    const result = parseKrakenCsv(withoutCryptoLeg);

    expect(result.transactions).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.line).toBe(2);
    expect(result.errors[0]!.message).toContain('párový řádek');
    expect(result.warnings).toHaveLength(1);
  });

  it('řádek s nulovou částkou BEZ poplatku nohou zůstává — tři nohy nespárujeme (A06-R1-03)', () => {
    const result = parseKrakenCsv(KRAKEN_ZERO_LEG_WITHOUT_FEE);

    expect(result.transactions).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.errors.map((e) => e.line)).toEqual([2, 3, 4]);
    expect(result.errors[2]!.message).toContain('párový řádek');
  });
});

describe('sniff pozná i trades.csv (routing na vysvětlující odmítnutí)', () => {
  it('trades.csv → sniff true a parse vrátí návod na ledgers.csv', async () => {
    const { sniffKrakenCsv, parseKrakenCsv } = await import('../src/kraken/csv');
    const { KRAKEN_TRADES_CSV } = await import('./fixtures/kraken');
    expect(sniffKrakenCsv(KRAKEN_TRADES_CSV)).toBe(true);
    const result = parseKrakenCsv(KRAKEN_TRADES_CSV);
    expect(result.transactions).toHaveLength(0);
    expect(result.errors[0]?.message).toContain('ledgers.csv');
  });
});

/**
 * K7b-01: sniffer musí být PODMNOŽINOU toho, co vyžaduje parser.
 *
 * `sniffKrakenCsv` chtěl `aclass` a `balance`, která parser NIKDY nečte —
 * všechny tři výskyty byly ve snifferu. Export bez nich se dal přečíst, ale
 * sniffer ho odmítl; a protože Kraken má sloupec doslova `type`, propadl až
 * na univerzální šablonu a uživatel četl hlášku cizího parseru o sloupci,
 * který jeho broker nikdy nemá.
 */
describe('sniffer nesmí být přísnější než parser (K7b-01)', () => {
  const bezAclassABalance = [
    '"txid","refid","time","type","subtype","asset","amount","fee"',
    '"L1","R1","2024-03-01 10:00:00","trade","","ZEUR","-1001.60","1.60"',
    '"L2","R1","2024-03-01 10:00:00","trade","","XXBT","0.02","0"',
  ].join('\n');

  it('ledgers bez aclass a balance sniffer pozná a parser přečte', async () => {
    const { sniffKrakenCsv, parseKrakenCsv } = await import('../src/kraken/csv');
    expect(sniffKrakenCsv(bezAclassABalance)).toBe(true);

    const result = parseKrakenCsv(bezAclassABalance);
    expect(result.errors).toEqual([]);
    expect(result.transactions).toHaveLength(1);
  });

  it('soubor, kterému chybí sloupec vyžadovaný parserem, sniffer nepozná', async () => {
    const { sniffKrakenCsv } = await import('../src/kraken/csv');
    // bez `amount` parser skončí chybou → propustit ho k němu nemá smysl
    const bezAmount = bezAclassABalance
      .split('\n')
      .map((line) => line.replace(',"amount"', '').replace(/,"-?[\d.]+","[\d.]+"$/, ',"0"'))
      .join('\n');
    expect(sniffKrakenCsv(bezAmount)).toBe(false);
  });
});
