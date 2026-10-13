import { d, type Transaction } from '@danero/shared';
import { describe, expect, it } from 'vitest';
import { parseAnycoinCsv } from '../src/anycoin/csv';
import { parseCoinbaseCsv } from '../src/coinbase/csv';
import { parseCoinmateCsv } from '../src/coinmate/csv';
import { parseKrakenCsv } from '../src/kraken/csv';

/**
 * Krypto platformy — Anycoin, Coinmate, Coinbase, Kraken: tvary výpisů, jak
 * je platformy opravdu posílají (audit 13. 10. 2026). Komentáře u testů
 * popisují vadu, kterou test hlídá — tedy chování PŘED opravou z toho dne.
 * Rozložení řádků je převzaté z veřejných zdrojů
 * (otevřený parser everytrade-plugins, BittyTax, dokumentace API Coinmate
 * a Krakenu), všechna čísla, časy a identifikátory jsou smyšlené.
 */

type Trade = Extract<Transaction, { type: 'BUY' | 'SELL' }>;

const trades = (transactions: Transaction[], isin: string): Trade[] =>
  transactions.filter(
    (tx): tx is Trade => (tx.type === 'BUY' || tx.type === 'SELL') && tx.isin === isin,
  );

/** Čistá změna počtu kusů titulu: nákupy minus prodeje. */
const position = (transactions: Transaction[], isin: string) =>
  trades(transactions, isin).reduce(
    (sum, tx) => (tx.type === 'BUY' ? sum.plus(tx.quantity) : sum.minus(tx.quantity)),
    d(0),
  );

/** Hrubá částka obchodu (kusy × cena), bez poplatku. */
const gross = (tx: Trade) => tx.quantity.times(tx.pricePerShare);

/** Poplatek obchodu v měně obchodu, nula když chybí. */
const feeOf = (tx: Trade) => (tx.fee ? d(tx.fee.amount) : d(0));

const COINBASE_V4_HEADER =
  'ID,Timestamp,Transaction Type,Asset,Quantity Transacted,Price Currency,Price at Transaction,Subtotal,Total (inclusive of fees and/or spread),Fees and/or Spread,Notes';
const COINBASE_V3_HEADER =
  'Timestamp,Transaction Type,Asset,Quantity Transacted,Spot Price Currency,Spot Price at Transaction,Subtotal,Total (inclusive of fees and/or spread),Fees and/or Spread,Notes';

describe('audit krypto: Coinbase', () => {
  /**
   * Novější export zapisuje Convert DVĚMA řádky: zdrojovou nohu (záporné
   * množství) a cílovou nohu (kladné množství, Asset = cílové aktivum). Oba
   * nesou tutéž poznámku „Converted X A to Y B“. Zdroj: everytrade-plugins,
   * `CoinbaseBeanV1.validateConvert` a test `testConvertTwoRowFormatKeepsSingleSourceLeg`
   * (řádky z května 2026, oprava parseru z 22. 6. 2026).
   *
   * Parser bere každý řádek Convert jako celou směnu: z cílového řádku tak
   * vyrobí PRODEJ právě nabytého aktiva a druhý nákup téhož.
   */
  const CONVERT_TWO_ROWS = [
    COINBASE_V4_HEADER,
    'aud0000000000000000000a1,2026-04-14 08:05:12 UTC,Convert,ADA,40.500000123,CZK,5.20,210.60,217.00,6.40,Converted 10.35 USDC to 40.5 ADA',
    'aud0000000000000000000a2,2026-04-14 08:05:11 UTC,Convert,USDC,-10.35,CZK,20.96,216.94,216.94,0.00,Converted 10.35 USDC to 40.5 ADA',
  ].join('\n');

  it('Convert zapsaný dvěma řádky je jedna směna: prodej zdroje a jeden nákup cíle', () => {
    const result = parseCoinbaseCsv(CONVERT_TWO_ROWS);

    expect(result.errors).toEqual([]);
    const sells = result.transactions.filter((tx) => tx.type === 'SELL');
    // cílové aktivum se neprodalo — právě jsme ho dostali
    expect(trades(result.transactions, 'ADA').filter((tx) => tx.type === 'SELL')).toEqual([]);
    expect(sells).toHaveLength(1);
    expect(trades(result.transactions, 'USDC').map((tx) => tx.type)).toEqual(['SELL']);
    expect(position(result.transactions, 'USDC').toString()).toBe('-10.35');
    // jeden nákup cíle: 40,5 kusu (z poznámky, nebo přesněji ze sloupce), ne dvojnásobek
    const acquired = position(result.transactions, 'ADA');
    expect(acquired.gte('40.5') && acquired.lte('40.500000123')).toBe(true);
  });

  it('Convert zapsaný dvěma řádky nezdvojí tržbu, která vstupuje do limitů', () => {
    const result = parseCoinbaseCsv(CONVERT_TWO_ROWS);

    const proceeds = result.transactions
      .filter((tx): tx is Trade => tx.type === 'SELL')
      .reduce((sum, tx) => sum.plus(gross(tx)), d(0));
    // hodnota směny je kolem 217 Kč; dvojí započtení dává přes 427 Kč
    expect(proceeds.lte('217.00')).toBe(true);
  });

  /**
   * Starší jednořádkový Convert (generace V2/V3): `Total` = kusy × spot, tedy
   * hodnota toho, co odešlo, a `Subtotal` = `Total` − `Fees`, tedy hodnota
   * toho, co přišlo. Poplatek je v rozdílu už obsažený. Parser ale prodej
   * ocení Subtotalem A NAVÍC mu přidá poplatek jako výdaj, takže ho odečte
   * dvakrát. Rozložení dokládá vlastní fixtura `COINBASE_V3` (shodná s řádkem
   * v testu everytrade-plugins) a BittyTax, který obě strany oceňuje Totalem
   * bez poplatku.
   */
  it('jednořádkový Convert neodečte poplatek dvakrát: čistý výnos prodeje neklesne pod Subtotal', () => {
    const result = parseCoinbaseCsv(
      [
        COINBASE_V3_HEADER,
        // 0,01 × 50 000 = 500 (Total); Subtotal 495 = Total − poplatek 5
        '2021-05-05T10:00:00Z,Convert,BTC,0.01,EUR,50000.00,495.00,500.00,5.00,Converted 0.01 BTC to 590.5 USDC',
      ].join('\n'),
    );

    expect(result.errors).toEqual([]);
    const [sell] = trades(result.transactions, 'BTC');
    expect(sell?.type).toBe('SELL');
    const net = gross(sell!).minus(feeOf(sell!));
    // správně 495 (Subtotal bez poplatku), nebo 500 − 5 (Total s poplatkem); dnes 490
    expect(net.toString()).toBe('495');
    // nabývací cena cíle leží mezi tím, co přišlo, a tím, co odešlo
    const [buy] = trades(result.transactions, 'USDC');
    const cost = gross(buy!).plus(feeOf(buy!));
    expect(cost.gte('495') && cost.lte('500')).toBe(true);
  });

  /**
   * Starší tvar poznámky u Advanced Trade nese za slovem „for“ částku v MĚNĚ
   * ÚČTU, i když se obchodovalo na páru krypto–krypto: „Sold 1.3 ETH for
   * 4118.07 GBP on ETH-BTC“ (BittyTax issue 458, 26. 9. – 19. 10. 2025, příklad
   * od správce). Parser z toho usoudí, že protistrana jsou peníze, a nabytý
   * BTC zmizí beze slova — varování se píše jen u poznámky, která vzoru
   * neodpovídá vůbec.
   */
  it('Advanced Trade se starší poznámkou „for <měna účtu> on ETH-BTC“ neztratí druhou nohu potichu', () => {
    const result = parseCoinbaseCsv(
      [
        COINBASE_V4_HEADER,
        'aud0000000000000000000b1,2023-06-03 10:00:00 UTC,Advanced Trade Sell,ETH,-0.5,EUR,"€1,800.00",€900.00,€896.40,€3.60,Sold 0.5 ETH for 896.40 EUR on ETH-BTC',
      ].join('\n'),
    );

    expect(result.errors).toEqual([]);
    const boughtCounterAsset = trades(result.transactions, 'BTC').some((tx) => tx.type === 'BUY');
    const warned = result.warnings.some((warning) => warning.line === 2);
    // buď druhá noha, nebo aspoň varování, že na páru ETH-BTC chybí nabytý BTC
    expect(boughtCounterAsset || warned).toBe(true);
  });
});

const KRAKEN_HEADER =
  '"txid","refid","time","type","subtype","aclass","asset","wallet","amount","fee","balance"';

describe('audit krypto: Kraken', () => {
  /**
   * Poplatek na krypto noze se od částky odečítá ZVLÁŠŤ: zůstatek po řádku =
   * předchozí zůstatek + amount − fee. Ověřeno přepočtem sloupce `balance` na
   * řádcích z testů everytrade-plugins (`KrakenBeanV2Test`): u nákupu USDT za
   * USD s poplatkem na noze USDT a u dvou po sobě jdoucích řádků `earn` téhož
   * aktiva vyjde zůstatek přesně jako částka minus poplatek.
   *
   * Nákup v aplikaci Kraken (spend + receive) má poplatek právě na přijímané
   * noze (tamtéž, dvojice spend EUR + receive s nenulovým `fee`). Parser uloží hrubé
   * množství a poplatek jen ohlásí — v evidenci pak zůstanou kusy, které
   * uživatel nikdy neměl, a nabývací cena se rozpustí i do nich. Ocenění
   * přitom není potřeba: stačí množství o poplatek upravit.
   */
  const CRYPTO_LEG_FEE = [
    KRAKEN_HEADER,
    // nákup v aplikaci: −1000 EUR → +8 SOL, poplatek 0,12 SOL na přijaté noze
    '"LAUD01-AAAAA-BBBBB1","TAUD01-XYZKQ-CCCCC1","2025-03-12 16:22:08","spend","","currency","ZEUR","spot / main",-1000.0000,0.0000,0.0000',
    '"LAUD02-AAAAA-BBBBB2","TAUD01-XYZKQ-CCCCC1","2025-03-12 16:22:08","receive","","currency","SOL","spot / main",8.0000000000,0.1200000000,7.8800000000',
    // prodej na Kraken Pro: −5 SOL s poplatkem 0,013 SOL → +600 EUR
    '"LAUD03-AAAAA-BBBBB3","TAUD02-XYZKQ-CCCCC2","2025-06-11 09:30:00","trade","tradespot","currency","SOL","spot / main",-5.0000000000,0.0130000000,2.8670000000',
    '"LAUD04-AAAAA-BBBBB4","TAUD02-XYZKQ-CCCCC2","2025-06-11 09:30:00","trade","tradespot","currency","ZEUR","spot / main",600.0000,0.0000,600.0000',
  ].join('\n');

  it('poplatek na krypto noze: počet kusů v evidenci sedí se zůstatkem Krakenu', () => {
    const result = parseKrakenCsv(CRYPTO_LEG_FEE);

    expect(result.errors).toEqual([]);
    // 8 − 0,12 − 5 − 0,013 = 2,867 (sloupec balance posledního řádku SOL)
    expect(position(result.transactions, 'SOL').toString()).toBe('2.867');
  });

  it('poplatek na krypto noze: po nákupu v aplikaci je v evidenci čisté množství za celou zaplacenou částku', () => {
    // jen první dva řádky: −1000 EUR → +8 SOL s poplatkem 0,12 SOL
    const result = parseKrakenCsv(CRYPTO_LEG_FEE.split('\n').slice(0, 3).join('\n'));

    expect(result.errors).toEqual([]);
    // do účtu přišlo 7,88 SOL — ať už jako nákup 7,88, nebo nákup 8 a úbytek 0,12 na poplatek
    expect(position(result.transactions, 'SOL').toString()).toBe('7.88');
    // a zaplaceno bylo celých 1000 EUR
    const paid = trades(result.transactions, 'SOL')
      .filter((tx) => tx.type === 'BUY')
      .reduce((sum, tx) => sum.plus(gross(tx)), d(0));
    expect(paid.toFixed(4)).toBe('1000.0000');
  });

  /**
   * Řádky `earn` z první doby nového Earn (jaro 2024) mají sloupec `subtype`
   * PRÁZDNÝ: přesun je dvojice −X / +X ve stejný okamžik s refid „Unknown“,
   * odměna je kladný řádek s nenulovým poplatkem. Zdroj: test everytrade-plugins
   * (`KrakenBeanV2Test`, řádky z března 2024) a BittyTax `kraken.py`
   * („earn with a fee must be a reward“).
   *
   * Parser bere každý `earn` bez subtypu jako přesun v rámci Earn a zařadí ho
   * mezi tiše přeskočené — odměna s výslovným subtypem `reward` přitom varuje.
   */
  it('earn s prázdným subtypem a poplatkem je odměna: nesmí skončit mezi tiše přeskočenými', () => {
    const result = parseKrakenCsv(
      [
        KRAKEN_HEADER,
        '"LAUE01-AAAAA-BBBBB1","Unknown","2024-04-08 07:15:20","earn","","currency","DOT28.S","spot / main",-40.0000000000,0,0.0000000000',
        '"LAUE02-AAAAA-BBBBB2","Unknown","2024-04-08 07:15:20","earn","","currency","DOT","earn / bonded",40.0000000000,0,40.0000000000',
        '"LAUE03-AAAAA-BBBBB3","Unknown","2024-04-12 19:40:05","earn","","currency","DOT","earn / bonded",0.1500000000,0.0300000000,40.1200000000',
      ].join('\n'),
    );

    expect(result.errors).toEqual([]);
    // odměna (řádek 4): varování jako u subtypu reward, nebo rovnou transakce
    const rewardVisible =
      result.warnings.some((warning) => warning.line === 4) || result.transactions.length > 0;
    expect(rewardVisible).toBe(true);
    // přesun mezi peněženkami (řádky 2 a 3) zůstává tichý
    expect(result.warnings.filter((warning) => warning.line === 2 || warning.line === 3)).toEqual(
      [],
    );
  });
});

const ANYCOIN_HEADER = 'Date,Type,Amount,Currency,Order ID';

describe('audit krypto: Anycoin', () => {
  /**
   * Zrušená objednávka je v exportu dvojice `trade payment` + `trade refund`
   * se stejným Order ID a opačnou částkou (everytrade-plugins,
   * `AnycoinBeanV1Test.testTradeRefund`, řádky z června 2023). Parser
   * vrácení ohlásí varováním, ale platbu si nechá mezi obchody a ohlásí
   * CHYBU „nemá kompletní pár platba + plnění … zkontroluj, že export pokrývá
   * celé období“ — nad exportem, který kompletní je.
   */
  it('zrušená objednávka (trade payment + trade refund) není chyba neúplného exportu', () => {
    const result = parseAnycoinCsv(
      [
        ANYCOIN_HEADER,
        '2025-03-11T07:40:10.120Z,trade payment,-2000,CZK,930001',
        '2025-03-11T07:40:12.455Z,trade fill,0.00101,BTC,930001',
        '2025-06-17T09:12:30.200Z,trade payment,-0.0008,BTC,930002',
        '2025-06-18T06:01:44.910Z,trade refund,0.0008,BTC,930002',
      ].join('\n'),
    );

    expect(result.errors).toEqual([]);
    // uložil se jen skutečný obchod; vrácená objednávka nic nezměnila
    expect(result.transactions).toHaveLength(1);
    expect(position(result.transactions, 'BTC').toString()).toBe('0.00101');
  });

  /**
   * Anycoin vede dogecoin pod kódem XDG (everytrade-plugins,
   * `AnycoinCurrencySwitcher`: XDG → DOGE). Parser Krakenu tentýž kód na DOGE
   * překládá, parser Anycoinu ne — nákup na Anycoinu a prodej jinde se pak
   * nepotkají v jedné evidenci a XDG nemá ani tržní cenu.
   */
  // Symbol vstupuje do dedupe klíče: přejmenování XDG → DOGE potřebuje datovou
  // migraci, která přepočítá klíče už uložených řádků (vzor 0031). Do té doby
  // se dogecoin z Anycoinu vede pod XDG.
  it.todo('kód XDG se uloží jako DOGE, stejně jako u Krakenu');
});

const COINMATE_HEADER =
  'ID;Date;Type;Amount;Amount Currency;Price;Price Currency;Fee;Fee Currency;Total;Total Currency;Description;Status';

describe('audit krypto: Coinmate', () => {
  /**
   * Dokumentace API Coinmate (Transaction History, `transactionType`) vede
   * vedle BUY/SELL a QUICK_* i INSTANT_BUY, INSTANT_SELL, NEW_USER_REWARD,
   * CREATE_VOUCHER a USED_VOUCHER. Sloupec Type v CSV nese tytéž hodnoty
   * (BUY, QUICK_BUY, DEPOSIT, REFERRAL… se shodují). Otevřený konektor
   * everytrade-plugins (`CoinMateDataUtil.mapCoinMateType`) mapuje INSTANT_*
   * na nákup a prodej.
   *
   * ⚠️ Že se INSTANT_* objevuje i v CSV exportu, doložené skutečným výpisem
   * není — je to odvozeno z dokumentace API.
   */
  it('INSTANT_BUY a INSTANT_SELL jsou nákup a prodej, ne neznámý typ', () => {
    const result = parseCoinmateCsv(
      [
        COINMATE_HEADER,
        '99101;2025-04-01 09:15:00;INSTANT_BUY;0.01;BTC;2150000;CZK;75.25;CZK;-21575.25;CZK;;OK',
        '99102;2025-05-02 10:11:12;INSTANT_SELL;-0.004;BTC;2300000;CZK;32.2;CZK;9167.8;CZK;;OK',
      ].join('\n'),
    );

    expect(result.errors).toEqual([]);
    expect(result.transactions.map((tx) => tx.type)).toEqual(['BUY', 'SELL']);
    expect(position(result.transactions, 'BTC').toString()).toBe('0.006');
  });

  it('NEW_USER_REWARD je odměna jako REFERRAL: varování nebo transakce, ne chyba „neznámý typ“', () => {
    const result = parseCoinmateCsv(
      [
        COINMATE_HEADER,
        '99201;2025-04-01 09:15:00;NEW_USER_REWARD;0.0001;BTC; ; ; ; ;0.0001;BTC;;OK',
      ].join('\n'),
    );

    expect(result.errors).toEqual([]);
    expect(result.warnings.length + result.transactions.length).toBeGreaterThan(0);
  });
});
