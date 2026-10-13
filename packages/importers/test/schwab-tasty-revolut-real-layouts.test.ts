import { d } from '@danero/shared';
import { describe, expect, it } from 'vitest';
import { parseRevolutCryptoCsv, parseRevolutInvestCsv } from '../src/revolut/csv';
import { parseSchwabCsv } from '../src/schwab/csv';
import { parseTastytradeCsv } from '../src/tastytrade/csv';
import type { ImportResult, RowIssue } from '../src/types';

/**
 * Charles Schwab, Tastytrade a Revolut: tvary výpisů, jak je platformy
 * opravdu posílají (audit 13. 10. 2026).
 *
 * Komentáře u testů popisují vadu, kterou test hlídá — tedy chování PŘED
 * opravou z toho dne. Rozložení řádků je převzaté
 * z veřejných zdrojů uvedených u každého testu; čísla, tituly, časy a účty jsou
 * smyšlené. Kde je správných řešení víc (zaúčtovat × srozumitelně odmítnout),
 * test přijme obě.
 */

const TASTY_V2_HEADER =
  'Date,Type,Sub Type,Action,Symbol,Instrument Type,Description,Value,Quantity,Average Price,Commissions,Fees,Multiplier,Root Symbol,Underlying Symbol,Expiration Date,Strike Price,Call or Put,Order #,Currency';
const TASTY_V2_TOTAL_HEADER = TASTY_V2_HEADER.replace(',Currency', ',Total,Currency');
const TASTY_LEGACY_HEADER =
  'Date/Time,Transaction Code,Transaction Subcode,Symbol,Buy/Sell,Open/Close,Quantity,Expiration Date,Strike,Call/Put,Price,Fees,Amount,Description,Account Reference';

const SCHWAB_HEADER = '"Date","Action","Symbol","Description","Quantity","Price","Fees & Comm","Amount"';
const REVOLUT_INVEST_HEADER = 'Date,Ticker,Type,Quantity,Price per share,Total Amount,Currency,FX Rate';
const REVOLUT_CRYPTO_HEADER = 'Symbol,Type,Quantity,Price,Value,Fees,Date';

/** Chyby a varování dohromady — obojí uživatel vidí; `skipped` ne (UI ukazuje jen počet). */
const visibleIssues = (result: ImportResult): RowIssue[] => [...result.errors, ...result.warnings];

const isTrade = (tx: ImportResult['transactions'][number]) => tx.type === 'BUY' || tx.type === 'SELL';

describe('Tastytrade: korporátní akce v „Receive Deliver“ nejsou obchody', () => {
  /**
   * Zdroj rozložení (v2, 21 sloupců): testovací export projektu
   * elch78/tastyworks-tax-calculator, `src/test/resources/stockTrade.csv`
   * (řádky „Receive Deliver,Reverse Split,BUY_TO_OPEN“ / „SELL_TO_CLOSE“
   * s vyplněnou Average Price). Totéž potvrzuje laroche/tastyworks-pnl
   * (`tw-pnl.py`: „Forward Split“ rozlišuje podle Buy/Sell a jeho částku nuluje,
   * „splits are tax neutral“).
   *
   * Parser se dnes rozhoduje nejdřív podle sloupce Action, takže se k větvi
   * `RD_WARN_SKIP` („výpis neuvádí poměr splitu“) vůbec nedostane a split uloží
   * jako prodej celé pozice a nový nákup — bez chyby i bez varování.
   */
  const reverseSplitV2 = [
    TASTY_V2_TOTAL_HEADER,
    '2025-03-10T12:47:02+0100,Receive Deliver,Reverse Split,BUY_TO_OPEN,ABCD,Equity,Reverse split: Open 15.0 ABCD,"-1,350.00",15,-90.00,--,0.00,,,,,,,,"-1,350.00",USD',
    '2025-03-10T12:47:02+0100,Receive Deliver,Reverse Split,SELL_TO_CLOSE,ABCD,Equity,Reverse split: Close 300.0 ABCD,"1,350.00",300,4.50,--,0.00,,,,,,,,"1,350.00",USD',
    '2021-02-03T15:30:27+0100,Trade,Buy to Open,BUY_TO_OPEN,ABCD,Equity,Bought 300 ABCD @ 4.50,"-1,350.00",300,-4.50,0.00,-0.24,,,,,,,206781608,"-1,350.24",USD',
  ].join('\n');

  /**
   * Zdroj rozložení (legacy): README projektu laroche/tastyworks-pnl, oddíl
   * „Stock splits example“ — Buy/Sell vyplněné, Price prázdná, Amount ± hodnota.
   */
  const forwardSplitLegacy = [
    TASTY_LEGACY_HEADER,
    '03/15/2021 11:00 PM,Receive Deliver,Forward Split,ABCD,Buy,Open,90,,,,,0.00,-8100.00,Forward split: Open 90.0 ABCD,Individual XXX39',
    '03/15/2021 11:00 PM,Receive Deliver,Forward Split,ABCD,Sell,Close,45,,,,,0.00,8100.00,Forward split: Close 45.0 ABCD,Individual XXX39',
    '01/11/2021 10:30 AM,Trade,Buy to Open,ABCD,Buy,Open,45,,,,180.00,0.08,-8100.00,Bought 45 ABCD @ 180.00,Individual XXX39',
  ].join('\n');

  it.each([
    ['nový export: Reverse Split', reverseSplitV2, '2025-03-10', '2021-02-03'],
    ['starý export: Forward Split', forwardSplitLegacy, '2021-03-15', '2021-01-11'],
  ])('%s se neuloží jako prodej a nový nákup a uživatel se o splitu dozví', (_label, csv, splitDay, buyDay) => {
    const result = parseTastytradeCsv(csv, { ABCD: { isin: 'US0000000001' } });

    // split není zdanitelný prodej a neruší časový test (R-04) — žádný obchod v den splitu
    const tradesOnSplitDay = result.transactions.filter(
      (tx) => isTrade(tx) && 'tradeDate' in tx && tx.tradeDate === splitDay,
    );
    expect(tradesOnSplitDay).toEqual([]);

    // skutečný nákup zůstává
    expect(
      result.transactions.filter((tx) => tx.type === 'BUY' && tx.tradeDate === buyDay),
    ).toHaveLength(1);

    // a split buď vznikne jako korporátní akce, nebo se o něm řekne nahlas
    const asCorporateAction = result.transactions.some((tx) => tx.type === 'CORPORATE_ACTION');
    const saidAloud = visibleIssues(result).some(
      (issue) => (issue.line === 2 || issue.line === 3) && /split/i.test(issue.message),
    );
    expect(asCorporateAction || saidAloud).toBe(true);
  });
});

describe('Tastytrade: opce vypořádané v hotovosti (SPX, VIX)', () => {
  /**
   * Zdroj: laroche/tastyworks-pnl, `tw-pnl.py` — u titulů vypořádaných
   * v hotovosti (`is_symbol_cash_settled`: SPX, SPXW, VIXW) posílá Tastytrade
   * DVA řádky: „Assignment“/„Exercise“ bez hodnoty (ten nástroj zahazuje)
   * a „Cash Settled Assignment“/„Cash Settled Exercise“, jehož Amount nese
   * vypořádanou částku (`price_usd = abs((amount - fees) / quantity)`). Směr
   * řádek nenese, určuje se z držené pozice.
   *
   * ⚠️ Doloženo je, ŽE dvojice existuje a kde je částka; přesný tvar řádku
   * v novém exportu (prázdná Action, Value místo Amount) je odvozený z převodu
   * v2 → legacy v témže nástroji, ne ze skutečného výpisu.
   *
   * Dnes: jeden z řádků zavře opci za 0 a druhý skončí varováním „ve výpisu
   * nevidíme otevření pozice“ — vypořádaných 1 200 USD se ztratí a z prohrané
   * pozice je v daňovém základu čistá prémie.
   */
  const v2 = [
    TASTY_V2_HEADER,
    '2025-03-21T21:00:00+0100,Receive Deliver,Cash Settled Assignment,,SPXW  250321P05600000,Equity Option,Cash settlement of assignment,"-1,200.00",1,,--,0.00,100,SPXW,SPX,3/21/25,5600,PUT,,USD',
    '2025-03-21T21:00:00+0100,Receive Deliver,Assignment,,SPXW  250321P05600000,Equity Option,Removal of option due to assignment,0.00,1,0.00,--,0.00,100,SPXW,SPX,3/21/25,5600,PUT,,USD',
    '2025-03-18T16:30:00+0100,Trade,Sell to Open,SELL_TO_OPEN,SPXW  250321P05600000,Equity Option,Sold 1 SPXW 03/21/25 Put 5600.00 @ 5.00,500.00,1,500.00,-1.00,-0.72,100,SPXW,SPX,3/21/25,5600,PUT,351200417,USD',
  ].join('\n');
  const legacy = [
    TASTY_LEGACY_HEADER,
    '03/21/2025 9:00 PM,Receive Deliver,Cash Settled Assignment,SPXW,,,1,03/21/2025,5600,P,,0.00,-1200.00,Cash settlement of assignment,Individual XXX39',
    '03/21/2025 9:00 PM,Receive Deliver,Assignment,SPXW,,,1,03/21/2025,5600,P,,0.00,0.00,Removal of option due to assignment,Individual XXX39',
    '03/18/2025 4:30 PM,Trade,Sell to Open,SPXW,Sell,Open,1,03/21/2025,5600,P,5.00,1.72,500.00,Sold 1 SPXW 03/21/25 Put 5600.00 @ 5.00,Individual XXX39',
  ].join('\n');

  it.each([
    ['nový export', v2],
    ['starý export', legacy],
  ])('%s: vypořádaná částka se neztratí v „uzavření za 0“', (_label, csv) => {
    const result = parseTastytradeCsv(csv);
    const closings = result.transactions.filter(
      (tx) => isTrade(tx) && 'tradeDate' in tx && tx.tradeDate === '2025-03-21',
    );

    // uzavření za nulu by z pozice se ztrátou 700 USD udělalo zisk 500 USD
    expect(closings.filter((tx) => 'pricePerShare' in tx && d(tx.pricePerShare).isZero())).toEqual([]);

    if (closings.length > 0) {
      // zaúčtováno: short put se zavírá nákupem za vypořádanou částku
      const settled = closings.reduce(
        (sum, tx) => ('pricePerShare' in tx ? sum.plus(d(tx.quantity).mul(tx.pricePerShare)) : sum),
        d('0'),
      );
      expect(closings.every((tx) => tx.type === 'BUY')).toBe(true);
      expect(settled.toString()).toBe('1200');
    } else {
      // nebo odmítnuto — ale s větou, která řekne, že jde o vypořádání v hotovosti
      expect(
        visibleIssues(result).some((issue) => /hotovost|cash|vypořád/i.test(issue.message)),
      ).toBe(true);
    }
  });
});

describe('Tastytrade: příjmy, které dnes končí chybou nebo tiše mizí', () => {
  /**
   * Zdroj: avion23/tastyworksTaxes, `test/test_tasty.py`
   * (`test_money_movement_special_dividend_uses_fund_classification`, řádek
   * datovaný 17. 12. 2025) a `tasty.py` (`case "Special Dividend"` v peněžních
   * pohybech). Řádek v testu toho projektu je syntetický — podtyp je doložený,
   * skutečný export jsme neviděli.
   */
  it('mimořádná dividenda v penězích („Money Movement / Special Dividend“) není neznámý typ', () => {
    const csv = [
      TASTY_V2_HEADER,
      '2025-12-17T20:00:00+0100,Money Movement,Special Dividend,,SCHG,Equity,Cash special dividend,41.00,0,,--,0.00,,,,,,,,USD',
    ].join('\n');
    const result = parseTastytradeCsv(csv, { SCHG: { isin: 'US8085247976' } });

    expect(result.errors.filter((issue) => /Neznámý typ/.test(issue.message))).toEqual([]);
    const dividend = result.transactions.find((tx) => tx.type === 'DIVIDEND');
    const warned = result.warnings.some((issue) => issue.line === 2);
    expect(dividend !== undefined || warned).toBe(true);
    if (dividend?.type === 'DIVIDEND') expect(dividend.gross.toString()).toBe('41');
  });

  /**
   * Zdroj: laroche/tastyworks-pnl, `tw-pnl.py` — u podtypu „Deposit“ rozlišuje
   * `ACH DEPOSIT` / `Wire Funds Received` (vklad) od ostatních: bez symbolu je
   * to úrok, se symbolem dividenda (kladná částka) nebo srážková daň (záporná).
   * Shodně avion23/tastyworksTaxes (`case "Deposit": if desc == "INTEREST ON
   * CREDIT BALANCE"` → úrok). Týká se starších let (éra tastyworks); dnešní
   * export pro tytéž události používá podtypy „Dividend“ a „Credit Interest“.
   *
   * Dnes: všechny tři řádky skončí ve `skipped` jako „peněžní převod“, a ten
   * uživatel v aplikaci nevidí (ukazuje se jen počet přeskočených).
   */
  it('starší export: dividenda a úrok zapsané jako „Deposit“ nejsou peněžní převod', () => {
    const csv = [
      TASTY_LEGACY_HEADER,
      '02/12/2021 9:00 AM,Money Movement,Deposit,KO,,,0,,,,,0.00,-1.80,COCA COLA CO,Individual XXX39',
      '02/12/2021 9:00 AM,Money Movement,Deposit,KO,,,0,,,,,0.00,12.00,COCA COLA CO,Individual XXX39',
      '02/01/2021 9:00 AM,Money Movement,Deposit,,,,0,,,,,0.00,0.42,INTEREST ON CREDIT BALANCE,Individual XXX39',
      '01/04/2021 9:00 AM,Money Movement,Deposit,,,,0,,,,,0.00,"1,200.00",ACH DEPOSIT,Individual XXX39',
    ].join('\n');
    const result = parseTastytradeCsv(csv, { KO: { isin: 'US1912161007' } });

    // skutečný vklad se dál přeskakuje beze slova
    expect(result.skipped.map((issue) => issue.line)).toEqual([5]);

    const dividend = result.transactions.find((tx) => tx.type === 'DIVIDEND');
    const dividendSaid = visibleIssues(result).some((issue) => issue.line === 2 || issue.line === 3);
    expect(dividend !== undefined || dividendSaid).toBe(true);
    if (dividend?.type === 'DIVIDEND') {
      expect(dividend.gross.toString()).toBe('12');
      expect(dividend.withholdingTax.toString()).toBe('1.8');
    }

    const interest = result.transactions.find((tx) => tx.type === 'INTEREST');
    const interestSaid = visibleIssues(result).some((issue) => issue.line === 4);
    expect(interest !== undefined || interestSaid).toBe(true);
    if (interest?.type === 'INTEREST') expect(interest.amount.toString()).toBe('0.42');
  });
});

describe('Převod kusů nesmí zmizet ve „skipped“ (stejné pravidlo jako Schwab, B-3-9)', () => {
  /**
   * `skipped` se uživateli neukazuje (v historii importů je jen počet), takže
   * rada „doplň jako TRANSFER_IN“ v něm zapadne. Pozdější prodej přijatých kusů
   * pak narazí na nulovou nabývací cenu a chybějící časový test. Schwab to má
   * od 12. 8. 2026 jako varování (`Journaled Shares` s kusy); Tastytrade
   * a Revolut krypto ne.
   *
   * Podtyp „Transfer“ v „Receive Deliver“ dokládá laroche/tastyworks-pnl
   * (`check_tcode`); přesný tvar řádku je odvozený, ne opsaný ze skutečného
   * výpisu.
   */
  it('Tastytrade: „Receive Deliver / Transfer“ s kusy je varování, ne tichý skip', () => {
    const csv = [
      TASTY_V2_HEADER,
      '2025-04-02T15:00:00+0200,Receive Deliver,Transfer,,ABCD,Equity,Position transfer,0.00,40,,--,0.00,,,,,,,,USD',
    ].join('\n');
    const result = parseTastytradeCsv(csv, { ABCD: { isin: 'US0000000001' } });

    const handled = result.transactions.some((tx) => tx.type === 'TRANSFER_IN' || tx.type === 'TRANSFER_OUT');
    const warned = visibleIssues(result).some((issue) => issue.line === 2);
    expect(handled || warned).toBe(true);
  });

  /**
   * Typ „Receive“ je v ukázkovém exportu projektu dickwolff/Export-To-Ghostfolio
   * (`samples/revolut-crypto-export.csv`).
   */
  it('Revolut krypto: přijaté mince („Receive“) jsou varování, ne tichý skip', () => {
    const csv = [
      REVOLUT_CRYPTO_HEADER,
      'BTC,Receive,0.0125,"€61,000.00",€762.50,€0.00,"Feb 3, 2025, 3:50:00 AM"',
    ].join('\n');
    const result = parseRevolutCryptoCsv(csv);

    const handled = result.transactions.some((tx) => tx.type === 'TRANSFER_IN');
    const warned = visibleIssues(result).some((issue) => issue.line === 2);
    expect(handled || warned).toBe(true);
  });
});

describe('Schwab: dluhopisy pod CUSIP mají cenu za 100 USD jmenovité hodnoty', () => {
  /**
   * Zdroj: KapJI/capital-gains-calculator (cgt-calc),
   * `cgt_calc/parsers/schwab_cusip_bonds.py` („Schwab reports bond prices per
   * $100 face value“) a `docs/brokers/schwab.md`, oddíl „Bonds and Treasury
   * securities“: u devítimístného CUSIP je Quantity jmenovitá hodnota a Price
   * cena za 100 USD.
   *
   * Dnes: parser vynásobí 20 000 × 99,8125 a nákup za ~20 tis. USD uloží jako
   * nákup za ~2 mil. USD. Stačí k tomu doplnit ISIN, o který si aplikace sama
   * řekne — pak už žádná chyba ani varování.
   */
  it('nákup a prodej státního dluhopisu nevyjde stokrát dražší, než kolik odešlo z účtu', () => {
    const csv = [
      SCHWAB_HEADER,
      '"05/14/2025","Sell","91282CJL6","US TREASURY NOTE 4.875% 11/30/2025","20,000","$100.4375","","$20,512.31"',
      '"02/11/2025","Buy","91282CJL6","US TREASURY NOTE 4.875% 11/30/2025","20,000","$99.8125","","-$20,155.42"',
    ].join('\n');
    const result = parseSchwabCsv(csv, { '91282CJL6': { isin: 'US91282CJL63' } });

    const cash: Record<string, string> = { BUY: '20155.42', SELL: '20512.31' };
    const trades = result.transactions.filter(isTrade);
    for (const tx of trades) {
      if (!('pricePerShare' in tx)) continue;
      // hodnota obchodu smí od pohybu peněz uhnout o naběhlý úrok, ne o dva řády
      const ratio = d(tx.quantity).mul(tx.pricePerShare).div(cash[tx.type]!);
      expect(ratio.gt('0.9') && ratio.lt('1.1')).toBe(true);
    }
    // a když se dluhopis nezaúčtuje, musí to zaznít
    if (trades.length < 2) {
      expect(
        visibleIssues(result).some((issue) => issue.line === 2 || issue.line === 3),
      ).toBe(true);
    }
  });
});

describe('Revolut akcie: počet kusů s desetinnou čárkou ve výpisu s tečkovými cenami', () => {
  /**
   * Zdroj: ukázkový export projektu dickwolff/Export-To-Ghostfolio
   * (`samples/revolut-invest-export.csv`, řádek z 8. 9. 2025:
   * `"0,76672417",€26.09,€20`) a commit „Revolut invest: fix comma separator“
   * z 1. 10. 2025 — Quantity píše desetinnou ČÁRKU, ceny v témže řádku tečku.
   *
   * Lokalizace se dnes hlasuje přes celý soubor naráz, takže ceny a kurzy
   * přehlasují sloupec Quantity a `1,125` kusu se uloží jako 1 125 kusů. Přitom
   * sloupec Quantity sám dokazuje čárku (`0,76672417`) a Total Amount dává
   * kontrolu (1,125 × 26,08 = 29,34).
   */
  it('„1,125“ kusu není 1 125 kusů, když Quantity jinde ve výpisu píše desetinnou čárku', () => {
    const csv = [
      REVOLUT_INVEST_HEADER,
      '2025-09-08T07:29:03.333Z,MSFT,BUY - MARKET,"0,76672417",€26.09,€20,EUR,1',
      '2025-09-09T07:31:10.120Z,MSFT,BUY - MARKET,"1,125",€26.08,€29.34,EUR,1',
    ].join('\n');
    const result = parseRevolutInvestCsv(csv, { MSFT: { isin: 'US5949181045' } });

    const second = result.transactions.find((tx) => tx.type === 'BUY' && tx.tradeDate === '2025-09-09');
    const flagged = visibleIssues(result).some((issue) => issue.line === 3);
    if (second?.type === 'BUY') {
      // buď správně 1,125 kusu, nebo aspoň varování u toho řádku
      expect(second.quantity.toString() === '1.125' || flagged).toBe(true);
      expect(second.quantity.toString()).not.toBe('1125');
    } else {
      expect(flagged).toBe(true);
    }
  });
});

describe('Revolut akcie: „DIVIDEND TAX (CORRECTION)“', () => {
  /**
   * Zdroj: cgt-calc, `cgt_calc/parsers/revolut.py` (slovník typů),
   * `docs/brokers/revolut.md`, oddíl „Tax corrections“, a testovací výpis
   * `tests/revolut/data/transactions.csv` (dvojice řádků z prosince 2025):
   * opravy chodí většinou v páru stejné částky s opačným znaménkem během
   * vteřiny a nic nemění; osamocená záporná oprava je daň sražená dodatečně
   * z dividendy vyplacené v plné výši.
   */
  const dividendRow = '2025-12-11T09:14:02.511Z,QCOM,DIVIDEND,,,USD 31.10,USD,1.0843';

  it('pár oprav, který se vyruší, není chyba „neznámý typ“', () => {
    const csv = [
      REVOLUT_INVEST_HEADER,
      dividendRow,
      '2025-12-18T12:50:46.123456Z,QCOM,DIVIDEND TAX (CORRECTION),,,USD -4.66,USD,1.0791',
      '2025-12-18T12:50:47.123456Z,QCOM,DIVIDEND TAX (CORRECTION),,,USD 4.66,USD,1.0791',
    ].join('\n');
    const result = parseRevolutInvestCsv(csv, { QCOM: { isin: 'US7475251036' } });

    expect(result.errors).toEqual([]);
    const dividend = result.transactions.find((tx) => tx.type === 'DIVIDEND');
    expect(dividend?.type === 'DIVIDEND' && dividend.withholdingTax.toString()).toBe('0');
  });

  it('osamocená oprava se započte jako srážka, nebo se o ní řekne varováním — ne chybou typu', () => {
    const csv = [
      REVOLUT_INVEST_HEADER,
      dividendRow,
      '2025-12-18T12:50:46.123456Z,QCOM,DIVIDEND TAX (CORRECTION),,,USD -4.66,USD,1.0791',
    ].join('\n');
    const result = parseRevolutInvestCsv(csv, { QCOM: { isin: 'US7475251036' } });

    expect(result.errors.filter((issue) => /Neznámý typ/.test(issue.message))).toEqual([]);
    const dividend = result.transactions.find((tx) => tx.type === 'DIVIDEND');
    const credited = dividend?.type === 'DIVIDEND' && dividend.withholdingTax.toString() === '4.66';
    const warned = result.warnings.some((issue) => issue.line === 3);
    expect(credited || warned).toBe(true);
  });
});
