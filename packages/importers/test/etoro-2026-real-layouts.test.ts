import { describe, expect, it } from 'vitest';
import type { Transaction } from '@danero/shared';
import { parseEtoroXlsx, sniffEtoroXlsx } from '../src/etoro/xlsx';
import { loadXlsxWorkbook } from '../src/xlsx';
import {
  buildEtoroXlsx,
  ETORO_ACTIVITY_HEADERS_2026,
  ETORO_CLOSED_HEADERS_2026,
  ETORO_DIVIDEND_HEADERS_2026,
  ETORO_ACTIVITY_HEADERS_CS,
  ETORO_CLOSED_HEADERS_CS,
  ETORO_DIVIDEND_HEADERS_CS,
  ETORO_HOLDINGS_HEADERS,
  ETORO_SHEETS_CS,
  type EtoroCellValue,
} from './fixtures/etoro';
import { withNamespacePrefixes } from './fixtures/xlsx-shapes';

/**
 * eToro Account Statement z listopadu 2026 — rozložení podle prvního
 * skutečného výpisu v tomhle tvaru (případ z 9. 11. 2026). Opsané jsou jen
 * názvy listů, hlavičky a znění typů řádků; tituly, ISINy, částky, kusy,
 * data i Position ID jsou smyšlené.
 *
 * Co se proti dřívějším výpisům změnilo a na čem import padal:
 *  - Closed Positions: pole Action nese jen „Název (TICKER)“ bez „Buy/Sell“,
 *    směr je jen ve sloupci Long / Short — každá uzavřená pozice byla chyba;
 *  - Account Activity: nové typy „Opening and Closing Spread“ (poplatek
 *    při otevření i zavření, ubírá ze zůstatku), „Index price adjustment“
 *    (úprava indexového CFD za dividendy) a „Account balance to mirror“
 *    (převod do kopírovaného portfolia) — „Neznámý typ operace“;
 *  - nový list Holdings se snímky držených pozic a ISIN — otevřená pozice
 *    z Account Activity ISIN nemá a končila na „doplň ISIN“.
 */

const rowOf =
  (headers: string[]) =>
  (values: Record<string, EtoroCellValue>): EtoroCellValue[] =>
    headers.map((header) => values[header] ?? '');
const closedRow = rowOf(ETORO_CLOSED_HEADERS_2026);
const activityRow = rowOf(ETORO_ACTIVITY_HEADERS_2026);
const dividendRow = rowOf(ETORO_DIVIDEND_HEADERS_2026);
const holdingRow = rowOf(ETORO_HOLDINGS_HEADERS);

const build = (spec: {
  closed?: EtoroCellValue[][];
  activity?: EtoroCellValue[][];
  dividends?: EtoroCellValue[][];
  holdings?: EtoroCellValue[][];
}): Promise<Buffer> =>
  buildEtoroXlsx({
    closed: { headers: ETORO_CLOSED_HEADERS_2026, rows: spec.closed ?? [] },
    activity: { headers: ETORO_ACTIVITY_HEADERS_2026, rows: spec.activity ?? [] },
    dividends: { headers: ETORO_DIVIDEND_HEADERS_2026, rows: spec.dividends ?? [] },
    ...(spec.holdings ? { holdings: { rows: spec.holdings } } : {}),
  });

const legs = (transactions: Transaction[], pid: string): Transaction[] =>
  transactions.filter((tx) => tx.id.startsWith(`etoro-${pid}-`));

const closedStock = (pid: string, overrides: Record<string, EtoroCellValue> = {}): EtoroCellValue[] =>
  closedRow({
    'Position ID': pid,
    Action: 'Smyšlená Strojírna (SMS.L)',
    'Long / Short': 'Long',
    Amount: '40.00',
    'Units / Contracts': '2.5',
    'Open Date': '03/02/2026 10:15:00',
    'Close Date': '17/03/2026 14:40:00',
    Leverage: '1',
    'Spread Fees (USD)': '0',
    'Market Spread (USD)': '0.00',
    'Profit(USD)': '5.00',
    'Open Rate': '1200.5',
    'Close Rate': '1350.25',
    'Overnight Fees and Dividends': '0',
    'Copied From': '-',
    Type: 'Stocks',
    ISIN: 'GB0000000017',
    ...overrides,
  });

const openPosition = (pid: string, details: string, assetType = 'Stocks'): EtoroCellValue[] =>
  activityRow({
    Date: '12/05/2026 16:20:00',
    Type: 'Open Position',
    Details: details,
    Amount: '90.00',
    'Units / Contracts': '3',
    'Realized Equity Change': '0',
    'Realized Equity': '1000',
    Balance: '500',
    'Position ID': pid,
    'Asset type': assetType,
    NWA: '0',
  });

const activity = (type: string, details: string, amount: string, pid: string, assetType = 'Stocks') =>
  activityRow({
    Date: '20/05/2026 09:00:00',
    Type: type,
    Details: details,
    Amount: amount,
    'Units / Contracts': '-',
    'Realized Equity Change': amount,
    'Realized Equity': '1000',
    Balance: '500',
    'Position ID': pid,
    'Asset type': assetType,
    NWA: '0',
  });

describe('eToro 2026: Action bez „Buy/Sell“, směr ve sloupci Long / Short', () => {
  it('long pozice dá pár nákup/prodej s tickerem ze závorky', async () => {
    const result = await parseEtoroXlsx(await build({ closed: [closedStock('2000000001')] }));
    expect(result.errors).toEqual([]);
    const [buy, sell] = legs(result.transactions, '2000000001');
    expect(buy).toMatchObject({ type: 'BUY', ticker: 'SMS.L', isin: 'GB0000000017' });
    expect(sell).toMatchObject({ type: 'SELL', ticker: 'SMS.L' });
    // ceny v USD z Amount a Profit, ne z kurzů v pencích
    if (buy?.type !== 'BUY' || sell?.type !== 'SELL') throw new Error('čekal jsem pár');
    expect(buy.pricePerShare.toString()).toBe('16');
    expect(sell.pricePerShare.toString()).toBe('18');
  });

  it('short pozice je derivát s výsledkem ze sloupce Profit(USD)', async () => {
    const result = await parseEtoroXlsx(
      await build({
        closed: [
          closedStock('2000000002', {
            Action: 'Smyšlený Index Fond (SMIF)',
            'Long / Short': 'Short',
            Type: 'CFD',
            'Profit(USD)': '-3.20',
          }),
        ],
      }),
    );
    expect(result.errors).toEqual([]);
    const pair = legs(result.transactions, '2000000002');
    expect(pair.map((tx) => (tx.type === 'BUY' || tx.type === 'SELL' ? tx.assetClass : tx.type))).toEqual([
      'DERIVATIVE',
      'DERIVATIVE',
    ]);
    expect(pair[0]).toMatchObject({ type: 'BUY', isin: 'CFD:SMIF#2000000002' });
  });

  it('bez „Long“ nebo „Short“ směr nehádáme — řádek je chyba', async () => {
    const result = await parseEtoroXlsx(
      await build({ closed: [closedStock('2000000003', { 'Long / Short': '' })] }),
    );
    expect(result.transactions).toEqual([]);
    expect(result.errors).toEqual([
      expect.objectContaining({ message: expect.stringMatching(/se nepodařilo přečíst směr a instrument/) }),
    ]);
  });

  it('pozice s Amount 0 je nákup za nulu, ne kurz v měně kotace vydávaný za USD', async () => {
    const result = await parseEtoroXlsx(
      await build({ closed: [closedStock('2000000004', { Amount: '0', 'Profit(USD)': '1.25' })] }),
    );
    expect(result.errors).toEqual([]);
    const [buy, sell] = legs(result.transactions, '2000000004');
    if (buy?.type !== 'BUY' || sell?.type !== 'SELL') throw new Error('čekal jsem pár');
    expect(buy.pricePerShare.toString()).toBe('0');
    expect(sell.pricePerShare.times(sell.quantity).toString()).toBe('1.25');
  });
});

describe('eToro 2026: nové typy řádků v Account Activity', () => {
  it('„Opening and Closing Spread“ je poplatek', async () => {
    const result = await parseEtoroXlsx(
      await build({
        activity: [
          activity('Opening and Closing Spread', 'On Open', '-0.85', '2000000010'),
          activity('Opening and Closing Spread', 'On Close', '-2.35', '2000000011', 'CFD'),
        ],
      }),
    );
    expect(result.errors).toEqual([]);
    expect(result.transactions.map((tx) => (tx.type === 'FEE' ? tx.amount.toString() : tx.type))).toEqual([
      '0.85',
      '2.35',
    ]);
  });

  it('kladný spread (vratka) se nezaúčtuje jako náklad', async () => {
    const result = await parseEtoroXlsx(
      await build({ activity: [activity('Opening and Closing Spread', 'On Close', '0.65', '2000000014')] }),
    );
    expect(result.transactions).toEqual([]);
    expect(result.skipped).toEqual([expect.objectContaining({ message: expect.stringMatching(/Vratka poplatku za spread/) })]);
  });

  it('„Index price adjustment“ je plnění z derivátu (R-12t), ne dividenda', async () => {
    const result = await parseEtoroXlsx(
      await build({ activity: [activity('Index price adjustment', 'SMIDX/USD', '0.37', '2000000012', 'CFD')] }),
    );
    expect(result.errors).toEqual([]);
    expect(result.transactions).toHaveLength(2);
    const [open, close] = result.transactions;
    expect(open).toMatchObject({ type: 'BUY', assetClass: 'DERIVATIVE', ticker: 'SMIDX' });
    expect(close).toMatchObject({ type: 'SELL', assetClass: 'DERIVATIVE' });
    if (close?.type !== 'SELL') throw new Error('čekal jsem SELL');
    expect(close.isin).toMatch(/^CFD:SMIDX#/);
    expect(close.pricePerShare.toString()).toBe('0.37');
    expect(result.transactions.some((tx) => tx.type === 'DIVIDEND')).toBe(false);
  });

  it('„Account balance to mirror“ se přeskočí s vysvětlením', async () => {
    const result = await parseEtoroXlsx(
      await build({ activity: [activity('Account balance to mirror', 'smysleny_obchodnik', '0', '30000001', '-')] }),
    );
    expect(result.errors).toEqual([]);
    expect(result.skipped).toEqual([
      expect.objectContaining({ message: expect.stringMatching(/kopírovaného portfolia/) }),
    ]);
  });

  it('split u pozice CFD se přeskočí — výsledek CFD se bere ze zisku, rada s šablonou by mátla', async () => {
    const result = await parseEtoroXlsx(
      await build({ activity: [activity('corp action: Split', 'SMIF/USD 4:1', '0', '2000000013', 'CFD')] }),
    );
    expect(result.warnings).toEqual([]);
    expect(result.skipped).toEqual([expect.objectContaining({ message: expect.stringMatching(/u pozice CFD/) })]);
  });
});

describe('eToro 2026: ISIN otevřené pozice z listů Holdings a Dividends', () => {
  const holding = (pid: string, isin: string, type = 'Stocks') =>
    holdingRow({
      'Snapshot Date': '30/06/2026',
      Asset: 'Smyšlená firma',
      'Position ID': pid,
      Direction: 'Long',
      'Open Date': '12/05/2026 16:20:00',
      Leverage: 'X1',
      'Open Rate': '30',
      Units: '3',
      'Current Rate': '31',
      'Value in USD': '93',
      Type: type,
      ISIN: isin,
    });
  const dividend = (pid: string, isin: string) =>
    dividendRow({
      'Date of Payment': '15/06/2026',
      'Instrument Name': 'Smyšlená firma',
      'Net Dividend Received (USD)': '0.40',
      'Net dividends': '0.40',
      'Withholding Tax Rate (%)': '15 %',
      'Withholding Tax Amount (USD)': '0.07',
      'Position ID': pid,
      Type: 'Stocks',
      ISIN: isin,
    });

  it('z Holdings podle Position ID — bez dotazu na uživatele', async () => {
    const result = await parseEtoroXlsx(
      await build({ activity: [openPosition('2000000020', 'SMFA/USD')], holdings: [holding('2000000020', 'US0000000206')] }),
    );
    expect(result.errors).toEqual([]);
    expect(result.transactions).toEqual([expect.objectContaining({ type: 'BUY', isin: 'US0000000206' })]);
  });

  it('z Dividends, když pozice v žádném snímku Holdings není', async () => {
    const result = await parseEtoroXlsx(
      await build({
        activity: [
          openPosition('2000000021', 'SMFB/USD'),
          activity('Dividend', 'SMFB/USD', '0.40', '2000000021'),
        ],
        dividends: [dividend('2000000021', 'US0000000214')],
      }),
    );
    expect(result.errors).toEqual([]);
    expect(result.transactions).toContainEqual(expect.objectContaining({ type: 'BUY', isin: 'US0000000214' }));
  });

  it('dva různé ISIN u jedné pozice se nepoužijí — rozhodne číselník nebo uživatel', async () => {
    const result = await parseEtoroXlsx(
      await build({
        activity: [openPosition('2000000022', 'SMFC/USD'), activity('Dividend', 'SMFC/USD', '0.40', '2000000022')],
        holdings: [holding('2000000022', 'US0000000222')],
        dividends: [dividend('2000000022', 'US0000000230')],
      }),
    );
    expect(result.transactions.some((tx) => tx.type === 'BUY')).toBe(false);
    expect(result.unmappedSymbols).toEqual(['SMFC']);
  });

  it('pozice otevřená po posledním snímku dostane ISIN tickeru z jeho starší pozice', async () => {
    const later = activityRow({
      Date: '20/09/2026 11:00:00',
      Type: 'Open Position',
      Details: 'SMFE/USD',
      Amount: '45.00',
      'Units / Contracts': '1.5',
      'Position ID': '2000000025',
      'Asset type': 'Stocks',
    });
    const result = await parseEtoroXlsx(
      await build({
        activity: [openPosition('2000000024', 'SMFE/USD'), later],
        holdings: [holding('2000000024', 'US0000000263')],
      }),
    );
    expect(result.errors).toEqual([]);
    expect(result.transactions.map((tx) => (tx.type === 'BUY' ? tx.isin : tx.type))).toEqual([
      'US0000000263',
      'US0000000263',
    ]);
  });

  it('ticker, kterému pozice dávají dva různé ISIN, se z výpisu nedoplní', async () => {
    const later = activityRow({
      Date: '20/09/2026 11:00:00',
      Type: 'Open Position',
      Details: 'SMFF/USD',
      Amount: '45.00',
      'Units / Contracts': '1.5',
      'Position ID': '2000000028',
      'Asset type': 'Stocks',
    });
    const result = await parseEtoroXlsx(
      await build({
        activity: [openPosition('2000000026', 'SMFF/USD'), openPosition('2000000027', 'SMFF/USD'), later],
        holdings: [holding('2000000026', 'US0000000297'), holding('2000000027', 'US0000000305')],
      }),
    );
    // pozice se známým ISIN se uloží, ta bez něj čeká na uživatele
    expect(result.transactions.map((tx) => (tx.type === 'BUY' ? tx.isin : tx.type))).toEqual([
      'US0000000297',
      'US0000000305',
    ]);
    expect(result.unmappedSymbols).toEqual(['SMFF']);
  });

  it('uzavřená pozice bez ISIN ho vezme podle Position ID z listu Dividends', async () => {
    const result = await parseEtoroXlsx(
      await build({
        closed: [closedStock('2000000029', { ISIN: '-', Type: 'Stocks' })],
        dividends: [dividend('2000000029', 'GB0000000025')],
        activity: [activity('Dividend', 'SMS.L/GBX', '0.40', '2000000029')],
      }),
    );
    expect(result.errors).toEqual([]);
    expect(legs(result.transactions, '2000000029')).toEqual([
      expect.objectContaining({ type: 'BUY', isin: 'GB0000000025' }),
      expect.objectContaining({ type: 'SELL', isin: 'GB0000000025' }),
    ]);
  });

  it('měna tickeru z Details jde importu — londýnský titul bez přípony se hledá v Londýně', async () => {
    const result = await parseEtoroXlsx(
      await build({ activity: [openPosition('2000000032', 'SMLN/GBX'), openPosition('2000000033', 'SMUS/USD')] }),
    );
    expect([...result.symbolCurrencies].map(([symbol, seen]) => `${symbol}:${[...seen.keys()].join(',')}`)).toEqual([
      'SMLN:GBX',
      'SMUS:USD',
    ]);
  });

  it('krypto ze snímku Holdings ISIN nedostane — klíčuje se tickerem', async () => {
    const result = await parseEtoroXlsx(
      await build({
        activity: [openPosition('2000000023', 'SMC/USD', 'Crypto')],
        holdings: [holding('2000000023', 'US0000000248', 'Crypto Currencies')],
      }),
    );
    expect(result.errors).toEqual([]);
    expect(result.transactions).toEqual([expect.objectContaining({ type: 'BUY', isin: 'SMC' })]);
  });
});

describe('eToro 2026: celý sešit v tvaru, jak ho eToro opravdu ukládá', () => {
  it('prefixy jmenných prostorů a absolutní cíle vztahů nemění výsledek', async () => {
    const plain = await build({
      closed: [closedStock('2000000030')],
      activity: [
        openPosition('2000000031', 'SMFD/USD'),
        activity('Opening and Closing Spread', 'On Open', '-0.85', '2000000031'),
      ],
      holdings: [
        holdingRow({ 'Position ID': '2000000031', Type: 'Stocks', ISIN: 'US0000000255' }),
      ],
    });
    const expected = await parseEtoroXlsx(plain);
    const actual = await parseEtoroXlsx(await withNamespacePrefixes(plain));
    expect(expected.errors).toEqual([]);
    expect(actual.errors).toEqual([]);
    expect(expected.transactions).toHaveLength(4);
    expect(JSON.stringify(actual.transactions)).toBe(JSON.stringify(expected.transactions));
  });
});

describe('eToro 2026: česká verze výpisu', () => {
  /**
   * eToro sešit překládá do jazyka platformy — listy, sloupce i typy řádků.
   * Rozložení podle skutečného českého výpisu z 9. 11. 2026; data smyšlená.
   */
  const cs = (headers: string[]) => rowOf(headers);
  const closedCs = cs(ETORO_CLOSED_HEADERS_CS);
  const activityCs = cs(ETORO_ACTIVITY_HEADERS_CS);
  const dividendCs = cs(ETORO_DIVIDEND_HEADERS_CS);

  const czech = (): Promise<Buffer> =>
    buildEtoroXlsx({
      sheetNames: ETORO_SHEETS_CS,
      closed: {
        headers: ETORO_CLOSED_HEADERS_CS,
        rows: [
          closedCs({
            'ID pozice': '2000000040',
            Akce: 'Smyšlená Chemie (SMCH)',
            'Long / Short': 'Long',
            Částka: '50.00',
            Jednotky: '2',
            'Datum otevření': '04/02/2026 10:00:00',
            'Datum uzavření': '18/03/2026 15:00:00',
            'Pákový efekt': '1',
            'Zisk (USD)': '6.00',
            'Otevírací kurz': '25',
            'Uzavírací kurz': '28',
            'Zkopírováno z': '-',
            Napište: 'Cenné papíry',
            ISIN: 'US0000000271',
          }),
          closedCs({
            'ID pozice': '2000000041',
            Akce: 'Smyšlený Index Fond (SMIF)',
            'Long / Short': 'Long',
            Částka: '30.00',
            Jednotky: '1',
            'Datum otevření': '05/02/2026 10:00:00',
            'Datum uzavření': '19/03/2026 15:00:00',
            'Pákový efekt': '1',
            'Zisk (USD)': '-2.40',
            'Otevírací kurz': '30',
            'Uzavírací kurz': '27.6',
            Napište: 'CFD',
            ISIN: 'US0000000289',
          }),
        ],
      },
      activity: {
        headers: ETORO_ACTIVITY_HEADERS_CS,
        rows: [
          activityCs({
            Datum: '06/05/2026 12:00:00',
            Napište: 'Otevřená pozice',
            Podrobnosti: 'SMKR/USD',
            Částka: '20.00',
            Jednotky: '0.5',
            'ID pozice': '2000000042',
            'Typ aktiva': 'Krypto',
          }),
          activityCs({
            Datum: '07/05/2026 12:00:00',
            Napište: 'Spread při otevření a uzavření',
            Podrobnosti: 'Otevřít',
            Částka: '-0.45',
            Jednotky: '-',
            'ID pozice': '2000000042',
            'Typ aktiva': 'Krypto',
          }),
          activityCs({
            Datum: '01/02/2026 09:00:00',
            Napište: 'Vklad',
            Podrobnosti: 'Smyšlená platba',
            Částka: '500',
            Jednotky: '-',
            'ID pozice': '-',
            'Typ aktiva': '-',
          }),
          activityCs({
            Datum: '02/02/2026 09:00:00',
            Napište: 'Začít kopírovat',
            Podrobnosti: 'smysleny_obchodnik',
            Částka: '-200',
            Jednotky: '-',
            'ID pozice': '30000002',
            'Typ aktiva': '-',
          }),
          activityCs({
            Datum: '10/06/2026 09:00:00',
            Napište: 'Dividenda',
            Podrobnosti: 'SMCH/USD',
            Částka: '0.34',
            Jednotky: '-',
            'ID pozice': '2000000043',
            'Typ aktiva': 'Cenné papíry',
          }),
        ],
      },
      dividends: {
        headers: ETORO_DIVIDEND_HEADERS_CS,
        rows: [
          dividendCs({
            'Datum platby': '10/06/2026',
            'Název nástroje': 'Smyšlená Chemie',
            'Čistá přijatá dividenda (USD)': '0.34',
            'Net dividends': '0.34',
            'Sazba srážkové daně (%)': '15 %',
            'Částka srážkové daně (USD)': '0.06',
            'ID pozice': '2000000043',
            Napište: 'Stocks',
            ISIN: 'US0000000271',
          }),
        ],
      },
    });

  it('se pozná jako eToro a přečte se', async () => {
    const buffer = await czech();
    expect(sniffEtoroXlsx(await loadXlsxWorkbook(buffer))).toBe(true);
    const result = await parseEtoroXlsx(buffer);
    expect(result.errors).toEqual([]);

    // akcie: pár nákup/prodej s ISIN z řádku, ceny z Částka a Zisk (USD)
    const stock = legs(result.transactions, '2000000040');
    expect(stock).toEqual([
      expect.objectContaining({ type: 'BUY', isin: 'US0000000271', assetClass: 'STOCK' }),
      expect.objectContaining({ type: 'SELL', isin: 'US0000000271', assetClass: 'STOCK' }),
    ]);
    // CFD (Napište „CFD“): derivát s vlastním klíčem
    expect(legs(result.transactions, '2000000041')[0]).toMatchObject({ isin: 'CFD:SMIF#2000000041' });
    // otevřená krypto pozice („Krypto“) s tickerem jako klíčem
    expect(result.transactions).toContainEqual(
      expect.objectContaining({ type: 'BUY', isin: 'SMKR', assetClass: 'CRYPTO' }),
    );
    // spread je poplatek, dividenda z listu Dividendy se srážkou
    expect(result.transactions).toContainEqual(expect.objectContaining({ type: 'FEE' }));
    const dividend = result.transactions.find((tx) => tx.type === 'DIVIDEND');
    if (dividend?.type !== 'DIVIDEND') throw new Error('čekal jsem dividendu');
    expect(dividend.gross.toString()).toBe('0.4');
    expect(dividend.withholdingTax.toString()).toBe('0.06');
    // vklad a začátek kopírování se přeskočí s vysvětlením
    expect(result.skipped.map((item) => item.message)).toEqual([
      expect.stringMatching(/Vklad na účet/),
      expect.stringMatching(/Začátek kopírování/),
    ]);
  });

  it('neznámý český typ instrumentu je chyba, ne akcie', async () => {
    const result = await parseEtoroXlsx(
      await buildEtoroXlsx({
        sheetNames: ETORO_SHEETS_CS,
        closed: {
          headers: ETORO_CLOSED_HEADERS_CS,
          rows: [
            closedCs({
              'ID pozice': '2000000044',
              Akce: 'Smyšlená Komodita (SMKO)',
              'Long / Short': 'Long',
              Částka: '10',
              Jednotky: '1',
              'Datum otevření': '04/02/2026 10:00:00',
              'Datum uzavření': '18/03/2026 15:00:00',
              'Zisk (USD)': '1',
              'Otevírací kurz': '10',
              'Uzavírací kurz': '11',
              Napište: 'Komodity',
            }),
          ],
        },
        activity: {
          headers: ETORO_ACTIVITY_HEADERS_CS,
          rows: [
            activityCs({
              Datum: '06/05/2026 12:00:00',
              Napište: 'Otevřená pozice',
              Podrobnosti: 'SMKO/USD',
              Částka: '20.00',
              Jednotky: '2',
              'ID pozice': '2000000045',
              'Typ aktiva': 'Komodity',
            }),
          ],
        },
        dividends: { headers: ETORO_DIVIDEND_HEADERS_CS, rows: [] },
      }),
    );
    expect(result.transactions).toEqual([]);
    expect(result.errors.map((error) => error.message)).toEqual([
      expect.stringMatching(/neznámý typ instrumentu „Komodity“/),
      expect.stringMatching(/neznámý typ aktiva „Komodity“/),
    ]);
  });
});
