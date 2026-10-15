import { describe, expect, it } from 'vitest';
import { isValidIsin } from '@danero/shared';
import {
  candidatesFrom,
  isUsEquityIsin,
  mergeAppendOnly,
} from '../scripts/build-isin-directory';
import { builtinInstrument, isinDirectoryRecords } from '../src/isin-directory';
import type { IsinDirectoryRecord } from '../src/isin-directory/data';
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

  it('má rozumnou velikost a každý ISIN je americká akcie s platnou kontrolní číslicí', () => {
    expect(records.length).toBeGreaterThan(1000);
    const bad = records.filter((record) => !isUsEquityIsin(record.isin) || !isValidIsin(record.isin));
    expect(bad).toEqual([]);
  });

  it('ticker i ISIN jsou v souboru nejvýš jednou a ticker je jen písmena', () => {
    const tickers = records.map((record) => record.ticker);
    const isins = records.map((record) => record.isin);
    expect(new Set(tickers).size).toBe(tickers.length);
    expect(new Set(isins).size).toBe(isins.length);
    expect(tickers.filter((ticker) => !/^[A-Z]{1,5}$/.test(ticker))).toEqual([]);
    expect(records.every((record) => record.name !== '' && record.source.startsWith('wikidata:Q'))).toBe(
      true,
    );
  });

  it('známé dvojice sedí', () => {
    const isinOf = (ticker: string) => records.find((record) => record.ticker === ticker)?.isin;
    expect(isinOf('AAPL')).toBe('US0378331005');
    expect(isinOf('MSFT')).toBe('US5949181045');
    expect(isinOf('NVDA')).toBe('US67066G1040');
    expect(isinOf('KO')).toBe('US1912161007');
    expect(isinOf('META')).toBe('US30303M1027');
    expect(isinOf('JPM')).toBe('US46625H1005');
  });

  it('nejednoznačné tituly v něm nejsou: Alphabet má na jedné položce oba ISIN (GOOG i GOOGL)', () => {
    const tickers = new Set(records.map((record) => record.ticker));
    expect(tickers.has('GOOG')).toBe(false);
    expect(tickers.has('GOOGL')).toBe(false);
    // ISIN dluhopisu u firmy (Paramount Global měl US124857AK99) se nebere
    expect(records.some((record) => record.isin === 'US124857AK99')).toBe(false);
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
    // eToro dává tickerům mimo USA příponu burzy
    expect(builtinInstrument('etoro', 'BARC.L')).toBeUndefined();
    expect(builtinInstrument('schwab', 'BRK/B')).toBeUndefined();
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
  const row = (qid: string, ticker: string, isin: string, extra: Record<string, unknown> = {}) => ({
    item: { value: `http://www.wikidata.org/entity/${qid}` },
    label: { value: `Firma ${qid}` },
    ticker: { value: ticker },
    listingRank: { value: NORMAL },
    isin: { value: isin },
    isinRank: { value: NORMAL },
    ...extra,
  });

  it('bere jen jednoznačné dvojice', () => {
    const { records, excluded } = candidatesFrom([
      row('Q1', 'AAPL', 'US0378331005'),
      // dvě třídy na jedné položce (Alphabet)
      row('Q2', 'GOOG', 'US02079K1079'),
      row('Q2', 'GOOG', 'US02079K3059'),
      row('Q2', 'GOOGL', 'US02079K1079'),
      row('Q2', 'GOOGL', 'US02079K3059'),
      // ISIN dluhopisu vedle akcie: dluhopis se nepočítá
      row('Q3', 'KO', 'US1912161007'),
      row('Q3', 'KO', 'US191216AK62'),
      // ukončený výpis, zastaralý ISIN, zahraniční ISIN, ticker s tečkou
      row('Q4', 'OLD', 'US5949181045', { listingEnd: { value: '2020-01-01' } }),
      row('Q5', 'MA', 'US57636Q1040', { isinRank: { value: DEPRECATED } }),
      row('Q6', 'TSM', 'TW0002330008'),
      row('Q7', 'BRK.B', 'US0846707026'),
      // zaniklá nebo převzatá firma — její ticker burza časem přidělí jiné
      row('Q10', 'VMW', 'US9285634021', { ended: { value: 'true' } }),
      // ISIN s koncem platnosti
      row('Q11', 'PEP', 'US7134481081', { isinEnd: { value: '2020-01-01' } }),
      // týž ticker u dvou firem
      row('Q8', 'S', 'US8520611000'),
      row('Q9', 'S', 'US81730H1095'),
    ]);

    expect(records.map((record) => `${record.ticker}=${record.isin}`)).toEqual([
      'AAPL=US0378331005',
      'KO=US1912161007',
    ]);
    expect(excluded['víc US ISIN u jedné položky']).toBe(1);
    expect(excluded['ticker vede na víc ISIN']).toBe(2);
    expect(excluded['firma zanikla, byla nahrazena nebo převzata']).toBe(1);
  });

  it('záznamy jen přidává: starý zůstane beze změny a konflikt se vypíše', () => {
    const old: IsinDirectoryRecord = {
      market: 'US',
      ticker: 'AAPL',
      isin: 'US0378331005',
      name: 'Apple Inc.',
      source: 'wikidata:Q312',
    };
    const changed = { ...old, isin: 'US5949181045', name: 'Jiná firma' };
    const fresh: IsinDirectoryRecord = { ...old, ticker: 'KO', isin: 'US1912161007', name: 'Coca-Cola' };

    const result = mergeAppendOnly([old], [changed, fresh]);

    expect(result.records).toEqual([old, fresh]);
    expect(result.added).toEqual([fresh]);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]).toContain('ponechán starý');
  });
});
