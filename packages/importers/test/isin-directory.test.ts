import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isValidIsin } from '@danero/shared';
import {
  candidatesFrom,
  diffRecords,
  isUsEquityIsin,
  ALLOWED_SECURITY_TYPES,
  sanityProblem,
  selectUnambiguous,
  verifyWithOpenFigi,
} from '../scripts/build-isin-directory';
import {
  listingsFromOpenFigi,
  MAX_ISINS_PER_ISSUER,
  prefilterIsins,
  recordsFromListings,
  uniqueTickers,
} from '../scripts/isin-directory-gleif';
import { builtinInstrument, isinDirectoryRecords, usTickerFor } from '../src/isin-directory';
import type { IsinDirectoryRecord } from '../src/isin-directory/data';
import { etoroListing, MARKETS, normalizeTicker } from '../src/isin-directory/markets';
import { ETORO_INSTRUMENT_MAP } from './fixtures/etoro';
import { FIO_SYMBOL_MAP } from './fixtures/fio';
import { REVOLUT_INSTRUMENT_MAP } from './fixtures/revolut';
import { SCHWAB_INSTRUMENT_MAP } from './fixtures/schwab';
import { TASTY_INSTRUMENT_MAP } from './fixtures/tastytrade';
import { XTB_INSTRUMENT_MAP } from './fixtures/xtb';

/**
 * Vestavěný číselník ISIN (`src/isin-directory`). ISIN je součást obsahového
 * otisku transakce, takže špatný záznam by se uživateli propsal do dedupe
 * i do pozic — proto se tu hlídá tvar všech záznamů, vybrané známé dvojice
 * a hlavně to, co v souboru být NESMÍ (nejednoznačné třídy akcií).
 */
describe('vestavěný číselník ISIN: data', () => {
  const records = isinDirectoryRecords();

  it('má rozumnou velikost, každý ISIN má platnou kontrolní číslici a americký je akcie', () => {
    expect(records.filter((record) => record.market === 'US').length).toBeGreaterThan(1000);
    const bad = records.filter(
      (record) =>
        !isValidIsin(record.isin) || (record.isin.startsWith('US') && !isUsEquityIsin(record.isin)),
    );
    expect(bad).toEqual([]);
  });

  it('ticker je na trhu nejvýš jednou a má tvar trhu', () => {
    // jeden ISIN pod víc tickery nevadí (ETF v librách i dolarech: VUSA, VUSD)
    const tickers = records.map((record) => `${record.market}|${record.ticker}`);
    expect(new Set(tickers).size).toBe(tickers.length);
    expect(
      records.filter((record) => !MARKETS[record.market].pattern.test(record.ticker)),
    ).toEqual([]);
    expect(
      records.every(
        (record) =>
          record.name !== '' && (record.source.startsWith('wikidata:Q') || record.source === 'gleif'),
      ),
    ).toBe(true);
  });

  it('známé dvojice sedí', () => {
    const isinOf = (ticker: string) =>
      records.find((record) => record.market === 'US' && record.ticker === ticker)?.isin;
    expect(isinOf('AAPL')).toBe('US0378331005');
    expect(isinOf('MSFT')).toBe('US5949181045');
    expect(isinOf('NVDA')).toBe('US67066G1040');
    expect(isinOf('KO')).toBe('US1912161007');
    expect(isinOf('META')).toBe('US30303M1027');
    expect(isinOf('JPM')).toBe('US46625H1005');
  });

  it('burzy mimo USA a zahraniční firmy kotované v USA: ověřené dvojice', () => {
    const isinOf = (market: string, ticker: string) =>
      records.find((record) => record.market === market && record.ticker === ticker)?.isin;
    // vzorky z vygenerovaného souboru, ověřené přes OpenFIGI
    expect(isinOf('XETR', 'ADS')).toBe('DE000A1EWWW0');
    expect(isinOf('XTKS', '1925')).toBe('JP3505000004');
    expect(isinOf('XLIS', 'GALP')).toBe('PTGAL0AM0009');
    expect(isinOf('LSE', 'BA')).toBe('GB0002634946');
    expect(isinOf('XHKG', '5')).toBe('GB0005405286');
    // Alcon kotuje v NY přímo švýcarskou akcii
    expect(isinOf('US', 'ALC')).toBe('CH0432492467');
    // ticker TSM je ADR, ne tchajwanská akcie
    expect(isinOf('US', 'TSM')).toBe('US8740391003');
    // z GLEIF: ETF a firmy, které Wikidata s tickerem nemají
    expect(isinOf('LSE', 'VUSA')).toBe('IE00B3XXRP09');
    expect(isinOf('US', 'QQQ')).toBe('US46090E1038');
    // americký ticker jen z burzy — mimoburzovní (OTC) tickery v číselníku nejsou
    expect(records.some((record) => record.market === 'US' && /^[A-Z]{4}[FY]$/.test(record.ticker) && record.source === 'gleif' && !record.isin.startsWith('US'))).toBe(false);
    // týž ticker na dvou trzích jsou dvě firmy
    expect(isinOf('US', 'BA')).toBe('US0970231058');
    expect(isinOf('LSE', 'BA')).not.toBe(isinOf('US', 'BA'));
  });

  it('třídy akcií z jedné položky (Alphabet: GOOG i GOOGL) jsou každá u svého ISIN', () => {
    // Wikidata mají u Alphabetu oba tickery i oba ISIN; přiřadí je až OpenFIGI
    const isinOf = (ticker: string) =>
      records.find((record) => record.market === 'US' && record.ticker === ticker)?.isin;
    expect([undefined, 'US02079K1079']).toContain(isinOf('GOOG'));
    expect([undefined, 'US02079K3059']).toContain(isinOf('GOOGL'));
    // ISIN dluhopisu u firmy (Paramount Global měl US124857AK99) se nebere
    expect(records.some((record) => record.isin === 'US124857AK99')).toBe(false);
  });

  it('neobsahuje ISIN jiného emitenta ani zastaralý ISIN (revize 15. 10. 2026)', () => {
    // Wikidata vedou u tickeru starou entitu nebo jinou firmu; ověření přes
    // OpenFIGI je musí vyřadit. Vzorky z revize dat: jiný emitent (TT je ISIN
    // Ingersoll Rand, CB stará Chubb Corp, AA stará Alcoa, recyklované LB,
    // TEN…) a zastaralý ISIN téže firmy (XOM, SHOP s neexistujícím US ISIN).
    const wrong = [
      ['AA', 'US0138171014'],
      ['BREW', 'US2241221017'],
      ['CB', 'US1712321017'],
      ['CECO', 'US71363P1066'],
      ['JIVE', 'US47760A1088'],
      ['LAZR', 'US5504243032'],
      ['LB', 'US5017971046'],
      ['NP', 'US6400791090'],
      ['OWL', 'US69121K1043'],
      ['PFLT', 'US7080621045'],
      ['RUBI', 'US55955D1000'],
      ['TACO', 'US2454961044'],
      ['TEN', 'US8803491054'],
      ['TINY', 'US68235B2088'],
      ['TT', 'US45687V1061'],
      ['VJET', 'US92912L1070'],
      ['XONE', 'US3021041047'],
      ['XOM', 'US30231G1022'],
    ];
    const present = wrong.filter(([ticker, isin]) =>
      records.some(
        (record) => record.market === 'US' && record.ticker === ticker && record.isin === isin,
      ),
    );
    expect(present).toEqual([]);
  });

  it('nerozchází se s ISIN, které používají fixtury brokerů', () => {
    const maps: Record<string, Record<string, { isin: string }>> = {
      etoro: ETORO_INSTRUMENT_MAP,
      fio: FIO_SYMBOL_MAP,
      revolut: REVOLUT_INSTRUMENT_MAP,
      schwab: SCHWAB_INSTRUMENT_MAP,
      tastytrade: TASTY_INSTRUMENT_MAP,
    };
    const mismatched = Object.entries(maps).flatMap(([broker, map]) =>
      Object.entries(map).flatMap(([symbol, instrument]) => {
        const found = builtinInstrument(broker, symbol, ['USD']);
        return found && found.isin !== instrument.isin
          ? [`${broker} ${symbol}: fixtura ${instrument.isin}, číselník ${found.isin}`]
          : [];
      }),
    );
    for (const [symbol, instrument] of Object.entries(XTB_INSTRUMENT_MAP)) {
      const found = builtinInstrument('xtb', symbol);
      if (found && found.isin !== instrument.isin) mismatched.push(`xtb ${symbol}`);
    }
    expect(mismatched).toEqual([]);
  });
});

describe('vestavěný číselník ISIN: který broker a symbol', () => {
  it('Schwab, Tastytrade a eToro: holý ticker je americký', () => {
    for (const broker of ['schwab', 'tastytrade', 'etoro']) {
      expect(builtinInstrument(broker, 'AAPL')).toEqual({
        symbol: 'AAPL',
        isin: 'US0378331005',
        name: 'Apple Inc.',
      });
    }
    expect(builtinInstrument('schwab', 'BRK/B')).toBeUndefined();
    // Schwab je americký broker: přípona burzy u něj nic neznamená
    expect(builtinInstrument('schwab', 'BARC.L')).toBeUndefined();
  });

  it('eToro: přípona určuje burzu, holý ticker v librách je londýnský', () => {
    expect(etoroListing('BARC.L', [])).toEqual({ market: 'LSE', ticker: 'BARC' });
    expect(etoroListing('BA.l', ['GBX'])).toEqual({ market: 'LSE', ticker: 'BA' });
    expect(etoroListing('ADS.DE', [])).toEqual({ market: 'XETR', ticker: 'ADS' });
    expect(etoroListing('BNP.PA', [])).toEqual({ market: 'XPAR', ticker: 'BNP' });
    expect(etoroListing('1925.T', [])).toEqual({ market: 'XTKS', ticker: '1925' });
    expect(etoroListing('GALP.LSB', [])).toEqual({ market: 'XLIS', ticker: 'GALP' });
    expect(etoroListing('0005.HK', [])).toEqual({ market: 'XHKG', ticker: '5' });
    // přípona, kterou výpis zatím nedoložil, se nehádá
    expect(etoroListing('ENI.MI', [])).toBeUndefined();
    // holý ticker: americký, jen když ho výpis nevede v jiné měně
    expect(etoroListing('AAPL', [])).toEqual({ market: 'US', ticker: 'AAPL' });
    expect(etoroListing('AAPL', ['USD'])).toEqual({ market: 'US', ticker: 'AAPL' });
    expect(etoroListing('TSCO', ['GBX'])).toEqual({ market: 'LSE', ticker: 'TSCO' });
    expect(etoroListing('SAP', ['EUR'])).toBeUndefined();
    expect(etoroListing('ABC', ['USD', 'GBX'])).toBeUndefined();
  });

  it('eToro: londýnský titul bez přípony nedostane ISIN americké firmy se stejným tickerem', () => {
    expect(builtinInstrument('etoro', 'AAPL', ['USD'])?.isin).toBe('US0378331005');
    expect(builtinInstrument('etoro', 'AAPL', ['GBX'])).toBeUndefined();
    // a ani ISIN z uživatelových amerických obchodů
    expect(usTickerFor('etoro', 'AAPL', ['GBX'])).toBeUndefined();
    expect(usTickerFor('etoro', 'BARC.L')).toBeUndefined();
  });

  it('Revolut a Fio: jen symbol obchodovaný výhradně v USD', () => {
    for (const broker of ['revolut', 'fio']) {
      expect(builtinInstrument(broker, 'AAPL', ['USD'])?.isin).toBe('US0378331005');
      expect(builtinInstrument(broker, 'AAPL', ['USD', 'EUR'])).toBeUndefined();
      expect(builtinInstrument(broker, 'AAPL', ['CZK'])).toBeUndefined();
      expect(builtinInstrument(broker, 'AAPL', [])).toBeUndefined();
    }
  });

  it('XTB: jen přípona .US, a pak i s měnou USD', () => {
    expect(builtinInstrument('xtb', 'AAPL.US')).toEqual({
      symbol: 'AAPL.US',
      isin: 'US0378331005',
      name: 'Apple Inc.',
      currency: 'USD',
    });
    expect(builtinInstrument('xtb', 'AAPL')).toBeUndefined();
    expect(builtinInstrument('xtb', 'IWDA.UK')).toBeUndefined();
  });

  it('ostatní brokeři a neznámé symboly nic nedostanou', () => {
    expect(builtinInstrument('trading212', 'AAPL')).toBeUndefined();
    expect(builtinInstrument('schwab', 'ZZQXA')).toBeUndefined();
    expect(builtinInstrument('schwab', 'constructor')).toBeUndefined();
    expect(builtinInstrument('schwab', 'aapl')).toBeUndefined();
  });
});

describe('generátor číselníku', () => {
  const NORMAL = 'http://wikiba.se/ontology#NormalRank';
  const DEPRECATED = 'http://wikiba.se/ontology#DeprecatedRank';
  const NYSE = 'http://www.wikidata.org/entity/Q13677';
  const LSE = 'http://www.wikidata.org/entity/Q171240';
  const HKEX = 'http://www.wikidata.org/entity/Q496672';
  const row = (qid: string, ticker: string, isin: string, extra: Record<string, unknown> = {}) => ({
    item: { value: `http://www.wikidata.org/entity/${qid}` },
    label: { value: `Firma ${qid}` },
    exchange: { value: NYSE },
    ticker: { value: ticker },
    listingRank: { value: NORMAL },
    isin: { value: isin },
    isinRank: { value: NORMAL },
    ...extra,
  });
  const pairs = (records: IsinDirectoryRecord[]) =>
    records.map((record) => `${record.market}:${record.ticker}=${record.isin}`);

  it('kandidáti: každý ticker položky se všemi jejími platnými ISIN akcií', () => {
    const { records, excluded } = candidatesFrom([
      row('Q1', 'AAPL', 'US0378331005'),
      // dvě třídy na jedné položce (Alphabet): rozhodne až OpenFIGI
      row('Q2', 'GOOG', 'US02079K1079'),
      row('Q2', 'GOOGL', 'US02079K3059'),
      // ISIN dluhopisu vedle akcie: dluhopis se nepočítá
      row('Q3', 'KO', 'US1912161007'),
      row('Q3', 'KO', 'US191216AK62'),
      // ukončený výpis, zastaralý ISIN, ticker s tečkou
      row('Q4', 'OLD', 'US5949181045', { listingEnd: { value: '2020-01-01' } }),
      row('Q5', 'MA', 'US57636Q1040', { isinRank: { value: DEPRECATED } }),
      row('Q7', 'BRK.B', 'US0846707026'),
      // zaniklá nebo převzatá firma — její ticker burza časem přidělí jiné
      row('Q10', 'VMW', 'US9285634021', { ended: { value: 'true' } }),
      // ADR i domácí akcie téže položky (TSMC) se zkouší oba — rozhodne OpenFIGI
      row('Q12', 'TSM', 'US8740391003'),
      row('Q12', 'TSM', 'TW0002330008'),
      // burzy mimo USA: tickery v jednotném tvaru trhu
      row('Q13', 'BA.', 'GB0002634946', { exchange: { value: LSE } }),
      row('Q14', '0005', 'GB0005405286', { exchange: { value: HKEX } }),
      // burza, kterou číselník nevede, se ignoruje
      row('Q15', 'XYZ', 'US0378331005', { exchange: { value: 'http://www.wikidata.org/entity/Q1' } }),
    ]);

    expect(pairs(records)).toEqual([
      'US:AAPL=US0378331005',
      'US:GOOG=US02079K1079',
      'US:GOOG=US02079K3059',
      'US:GOOGL=US02079K1079',
      'US:GOOGL=US02079K3059',
      'US:KO=US1912161007',
      'US:TSM=US8740391003',
      'US:TSM=TW0002330008',
      'LSE:BA=GB0002634946',
      'XHKG:5=GB0005405286',
    ]);
    expect(excluded['firma zanikla, byla nahrazena nebo převzata']).toBe(1);
    expect(excluded['ticker neodpovídá tvaru trhu']).toBe(1);
  });

  const record = (ticker: string, isin: string, market: IsinDirectoryRecord['market'] = 'US'): IsinDirectoryRecord => ({
    market,
    ticker,
    isin,
    name: `Firma ${ticker}`,
    source: 'wikidata:Q1',
  });

  it('po ověření jen jednoznačné: ticker → jeden ISIN (na trhu)', () => {
    const { records, excluded } = selectUnambiguous([
      record('AAPL', 'US0378331005'),
      { ...record('AAPL', 'US0378331005'), name: 'APPLE INC', source: 'gleif' }, // táž dvojice z GLEIF
      record('S', 'US8520611000'),
      record('S', 'US81730H1095'), // týž ticker u dvou firem
      record('VUSA', 'IE00B3XXRP09', 'LSE'),
      record('VUSD', 'IE00B3XXRP09', 'LSE'), // ETF v librách i dolarech: jeden ISIN, dva tickery
      record('RIO', 'GB0007188757', 'LSE'),
      record('RIO', 'US7672041008'), // týž ticker na jiném trhu nevadí
    ]);
    expect(pairs(records)).toEqual([
      'US:AAPL=US0378331005',
      'LSE:VUSA=IE00B3XXRP09',
      'LSE:VUSD=IE00B3XXRP09',
      'LSE:RIO=GB0007188757',
      'US:RIO=US7672041008',
    ]);
    // první vyhrává: záznam z Wikidat (hezčí název) jde napřed
    expect(records[0]!.name).toBe('Firma AAPL');
    expect(excluded['ticker vede na víc ISIN']).toBe(1);
  });

  it('GLEIF: předvýběr vynechá eurobondy, americké dluhopisy a emitenty strukturovaných produktů', () => {
    const bank = Array.from({ length: MAX_ISINS_PER_ISSUER + 1 }, (_, i) => ['BANK', `DE000B${String(i).padStart(6, '0')}`] as const);
    const isins = prefilterIsins([
      ['APPLE', 'US0378331005'],
      ['APPLE', 'US037833AK68'], // dluhopis (písmena v čísle emise)
      ['APPLE', 'XS1234567890'], // eurobond
      ['TESCO', 'GB00BLGZ9862'],
      ...bank,
      ['BANK', 'US0000000AB1'], // dluhopis i od banky pryč
    ]);
    expect(isins).toEqual(['US0378331005', 'GB00BLGZ9862']);
  });

  it('GLEIF: z kotací OpenFIGI jen trhy číselníku, americký ticker jen z burzy, ne z OTC', () => {
    const records = recordsFromListings(
      'GB00BLGZ9862',
      [
        { ticker: 'TSCO', exchCode: 'LN', securityType: 'Common Stock', name: 'TESCO PLC' },
        { ticker: 'TSCDF', exchCode: 'US', securityType: 'Common Stock', name: 'TESCO PLC' },
        { ticker: 'TSCDF', exchCode: 'UV', securityType: 'Common Stock', name: 'TESCO PLC' },
        { ticker: 'TCO0', exchCode: 'GR', securityType: 'Common Stock', name: 'TESCO PLC' },
      ],
      ALLOWED_SECURITY_TYPES,
    );
    expect(pairs(records)).toEqual(['LSE:TSCO=GB00BLGZ9862']);

    const listed = recordsFromListings(
      'CH0432492467',
      [
        { ticker: 'ALC', exchCode: 'US', securityType: 'Common Stock', name: 'ALCON INC' },
        { ticker: 'ALC', exchCode: 'UN', securityType: 'Common Stock', name: 'ALCON INC' },
        { ticker: 'ALC', exchCode: 'LN', securityType: 'Common Stock', name: 'ALCON INC' },
        { ticker: 'ALCP', exchCode: 'LN', securityType: 'Preference', name: 'ALCON INC' },
      ],
      ALLOWED_SECURITY_TYPES,
    );
    expect(pairs(listed)).toEqual(['US:ALC=CH0432492467', 'LSE:ALC=CH0432492467']);
  });

  it('GLEIF: dotazy na OpenFIGI po dávkách a s mezipamětí — přerušený běh naváže', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'isin-cache-'));
    const cacheFile = join(dir, 'cache.jsonl');
    const asked: string[] = [];
    const fetchBatch = async (jobs: Array<Record<string, string>>) => {
      asked.push(...jobs.map((job) => job.idValue!));
      return jobs.map((job) => ({
        data: [
          { ticker: job.idValue!.slice(2, 6), exchCode: 'LN', securityType: 'Common Stock', name: 'X' },
          { ticker: 'NOPE', exchCode: 'XX', securityType: 'Common Stock', name: 'X' }, // cizí burza se neukládá
        ],
      }));
    };
    const first = await listingsFromOpenFigi(['GB0000000001', 'GB0000000002', 'GB0000000003'], fetchBatch, {
      cacheFile,
      batchSize: 2,
      perMinute: 60_000,
      concurrency: 2,
    });
    expect(first.get('GB0000000002')).toEqual([{ ticker: '0000', exchCode: 'LN', securityType: 'Common Stock', name: 'X' }]);
    expect(asked.sort()).toEqual(['GB0000000001', 'GB0000000002', 'GB0000000003']);

    asked.length = 0;
    const second = await listingsFromOpenFigi(['GB0000000001', 'GB0000000004'], fetchBatch, { cacheFile, perMinute: 60_000 });
    expect(asked).toEqual(['GB0000000004']);
    expect(second.size).toBe(4);
    rmSync(dir, { recursive: true, force: true });
  });

  it('OpenFIGI: projde jen ISIN, který na burze trhu vede na TENTÝŽ ticker kmenové akcie', async () => {
    const answers: Record<string, { data?: Array<{ ticker: string; securityType: string }> }> = {
      'US0378331005|US': { data: [{ ticker: 'AAPL', securityType: 'Common Stock' }] },
      // Wikidata u TT vedou ISIN Ingersoll Rand
      'US45687V1061|US': { data: [{ ticker: 'IR', securityType: 'Common Stock' }] },
      // zastaralý ISIN (XOM) OpenFIGI nezná
      'US30231G1022|US': {},
      // preferenční akcie
      'US12542R2094|US': { data: [{ ticker: 'CHSCP', securityType: 'Preference' }] },
      'US8740391003|US': { data: [{ ticker: 'TSM', securityType: 'ADR' }] },
      // tchajwanská akcie je v USA jen mimoburzovně pod jiným tickerem
      'TW0002330008|US': { data: [{ ticker: 'TSMWF', securityType: 'Common Stock' }] },
      // OpenFIGI píše londýnský ticker s lomítkem
      'GB0002634946|LN': { data: [{ ticker: 'BA/', securityType: 'Common Stock' }] },
    };
    const batches: number[] = [];
    const { records, rejected } = await verifyWithOpenFigi(
      [
        record('AAPL', 'US0378331005'),
        record('TT', 'US45687V1061'),
        record('XOM', 'US30231G1022'),
        record('CHSCP', 'US12542R2094'),
        record('TSM', 'US8740391003'),
        record('TSM', 'TW0002330008'),
        record('BA', 'GB0002634946', 'LSE'),
      ],
      async (jobs) => {
        batches.push(jobs.length);
        expect(jobs.every((job) => job.idType === 'ID_ISIN')).toBe(true);
        return jobs.map((job) => answers[`${job.idValue}|${job.exchCode}`] ?? {});
      },
      { batchSize: 3 },
    );

    expect(pairs(records)).toEqual(['US:AAPL=US0378331005', 'US:TSM=US8740391003', 'LSE:BA=GB0002634946']);
    expect(rejected.map((item) => `${item.record.ticker}: ${item.reason}`)).toEqual([
      'TT: OpenFIGI vede ISIN na jiný ticker (IR)',
      'XOM: OpenFIGI ISIN na burze trhu nezná',
      'CHSCP: druh cenného papíru Preference',
      'TSM: OpenFIGI vede ISIN na jiný ticker (TSMWF)',
    ]);
    expect(batches).toEqual([3, 3, 1]);
  });

  it('GLEIF: londýnská mezinárodní kniha (0R0X…) do číselníku nejde', () => {
    const records = recordsFromListings(
      'US88160R1014',
      [
        { ticker: '0R0X', exchCode: 'LN', securityType: 'Common Stock', name: 'TESLA INC' },
        { ticker: 'TSLA', exchCode: 'US', securityType: 'Common Stock', name: 'TESLA INC' },
        { ticker: 'TSLA', exchCode: 'UW', securityType: 'Common Stock', name: 'TESLA INC' },
      ],
      ALLOWED_SECURITY_TYPES,
    );
    expect(pairs(records)).toEqual(['US:TSLA=US88160R1014']);
  });

  it('GLEIF: useknutý řádek mezipaměti se přeskočí a chyba OpenFIGI u ISIN se neuloží', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'isin-cache-'));
    const cacheFile = join(dir, 'cache.jsonl');
    // přerušený běh: poslední řádek bez konce
    writeFileSync(cacheFile, `${JSON.stringify({ isin: 'GB0000000001', listings: [] })}\n{"isin":"GB00000`);
    const asked: string[] = [];
    const result = await listingsFromOpenFigi(
      ['GB0000000001', 'GB0000000002', 'GB0000000003'],
      async (jobs) => {
        asked.push(...jobs.map((job) => job.idValue!));
        return jobs.map((job) =>
          job.idValue === 'GB0000000003' ? { error: 'Invalid idValue format' } : { warning: 'No identifier found.' },
        );
      },
      { cacheFile, perMinute: 60_000 },
    );
    expect(asked).toEqual(['GB0000000002', 'GB0000000003']);
    expect([...result.keys()].sort()).toEqual(['GB0000000001', 'GB0000000002']);
    // nový zápis začal na novém řádku a mezipaměť jde přečíst celá
    const lines = readFileSync(cacheFile, 'utf8').split('\n').filter(Boolean);
    expect(lines.map((line) => { try { return (JSON.parse(line) as { isin: string }).isin; } catch { return 'useknutý'; } })).toEqual([
      'GB0000000001',
      'useknutý',
      'GB0000000002',
    ]);
    rmSync(dir, { recursive: true, force: true });
  });

  it('GLEIF: selhání dávky zastaví i ostatní dotazy a chyba se předá dál', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'isin-cache-'));
    let calls = 0;
    const isins = Array.from({ length: 50 }, (_, i) => `GB${String(i).padStart(9, '0')}1`);
    await expect(
      listingsFromOpenFigi(
        isins,
        async (jobs) => {
          calls += 1;
          if (calls === 2) throw new Error('OpenFIGI odpověděla 400');
          await new Promise((resolve) => setTimeout(resolve, 5));
          return jobs.map(() => ({ data: [] }));
        },
        { cacheFile: join(dir, 'cache.jsonl'), batchSize: 2, perMinute: 60_000, concurrency: 3 },
      ),
    ).rejects.toThrow('OpenFIGI odpověděla 400');
    // rozběhnuté dávky doběhnou, nové už nezačnou (25 dávek celkem)
    expect(calls).toBeLessThan(6);
    rmSync(dir, { recursive: true, force: true });
  });

  it('zpětná kontrola: ticker na burze musí vést na jediný titul, pořadí zůstává', async () => {
    const listed = (ticker: string, isin: string, market: IsinDirectoryRecord['market'], figiTicker = ticker) => ({
      ...record(ticker, isin, market),
      figiTicker,
    });
    const jobsSeen: string[] = [];
    const { records, rejected } = await uniqueTickers(
      [
        listed('AAPL', 'US0378331005', 'US'),
        listed('BA', 'GB0002634946', 'LSE', 'BA/'),
        listed('XYZ', 'GB0000000001', 'LSE'),
        listed('DUP', 'GB0000000002', 'LSE'),
      ],
      async (jobs) => {
        jobsSeen.push(...jobs.map((job) => `${job.idType}:${job.exchCode}:${job.idValue}`));
        return jobs.map((job) => {
          if (job.idValue === 'XYZ') return { warning: 'No identifier found.' };
          if (job.idValue === 'DUP') return { data: [{ shareClassFIGI: 'BBG1' }, { shareClassFIGI: 'BBG2' }] };
          return { data: [{ shareClassFIGI: `BBG-${job.idValue}` }, { shareClassFIGI: `BBG-${job.idValue}` }] };
        });
      },
      { perMinute: 60_000 },
    );
    expect(jobsSeen).toEqual(['TICKER:US:AAPL', 'TICKER:LN:BA/', 'TICKER:LN:XYZ', 'TICKER:LN:DUP']);
    expect(pairs(records)).toEqual(['US:AAPL=US0378331005', 'LSE:BA=GB0002634946']);
    expect(rejected.map((item) => `${item.record.ticker}: ${item.reason}`)).toEqual([
      'XYZ: OpenFIGI ticker na burze nezná',
      'DUP: ticker vede na víc titulů',
    ]);
  });

  it('pojistka: hlídá každý trh a zdroj, který běh prošel; vynechaný zdroj ne', () => {
    const many = (market: IsinDirectoryRecord['market'], source: string, count: number) =>
      Array.from({ length: count }, (_, i) => ({ ...record(`T${i}`, `GB${String(i).padStart(9, '0')}1`, market), source }));
    const before = [...many('US', 'wikidata:Q1', 20), ...many('LSE', 'gleif', 100)];
    // běh jen s Wikidaty (bez klíče): londýnské záznamy z GLEIF zmizí, to je v pořádku
    expect(sanityProblem(before, many('US', 'wikidata:Q1', 20), new Set(['wikidata']))).toBeNull();
    // běh s GLEIF, ve kterém Londýn skoro zmizel: podezřelé
    expect(
      sanityProblem(before, [...many('US', 'wikidata:Q1', 20), ...many('LSE', 'gleif', 10)], new Set(['wikidata', 'gleif'])),
    ).toMatch(/zdroj gleif na trhu LSE/);
  });

  it('ticker v jednotném tvaru trhu', () => {
    expect(normalizeTicker('LSE', 'BA/')).toBe('BA');
    expect(normalizeTicker('LSE', 'BA.')).toBe('BA');
    expect(normalizeTicker('LSE', 'MAW.L')).toBe('MAW');
    expect(normalizeTicker('XHKG', '0005')).toBe('5');
    expect(normalizeTicker('XHKG', '6666.HK')).toBe('6666');
    expect(normalizeTicker('XTKS', '1925')).toBe('1925');
    expect(normalizeTicker('US', 'BRK.B')).toBeUndefined();
    expect(normalizeTicker('US', 'aapl')).toBe('AAPL');
  });

  it('soubor se sestavuje znovu: změny proti stávajícímu se jen vypíší', () => {
    const { added, removed, changed } = diffRecords(
      [record('AAPL', 'US0378331005'), record('XOM', 'US30231G1022'), record('TT', 'US45687V1061')],
      [record('AAPL', 'US0378331005'), record('XOM', 'US30233Q1085'), record('KO', 'US1912161007')],
    );
    expect(added).toEqual(['KO US1912161007 (Firma KO)']);
    expect(removed).toEqual(['TT US45687V1061 (Firma TT)']);
    expect(changed).toEqual(['XOM: US30231G1022 → US30233Q1085']);
  });
});
