import { describe, expect, it } from 'vitest';
import {
  mapPositionsToIsin,
  Trading212ApiError,
  Trading212Client,
  type Trading212Instrument,
  type Trading212Position,
} from '../src';

interface CapturedRequest {
  url: string;
  method: string;
  authorization: string;
  body?: string;
}

const makeFetch = (
  responses: Array<{ status?: number; body?: unknown; headers?: Record<string, string> }>,
  captured: CapturedRequest[] = [],
): typeof fetch => {
  let call = 0;
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    captured.push({
      url: String(input),
      method: init?.method ?? 'GET',
      authorization: headers.get('authorization') ?? '',
      body: typeof init?.body === 'string' ? init.body : undefined,
    });
    const response = responses[Math.min(call, responses.length - 1)]!;
    call += 1;
    return new Response(JSON.stringify(response.body ?? {}), {
      status: response.status ?? 200,
      headers: response.headers,
    });
  }) as typeof fetch;
};

describe('Trading212Client', () => {
  it('posílá API klíč v Authorization; se secretem HTTP Basic', async () => {
    const captured: CapturedRequest[] = [];
    await new Trading212Client({ apiKey: 'key123', fetchImpl: makeFetch([{ body: {} }], captured) }).getCash();
    expect(captured[0]!.authorization).toBe('key123');
    expect(captured[0]!.url).toBe('https://live.trading212.com/api/v0/equity/account/cash');

    const capturedBasic: CapturedRequest[] = [];
    await new Trading212Client({
      apiKey: 'key123',
      apiSecret: 'sec456',
      fetchImpl: makeFetch([{ body: {} }], capturedBasic),
    }).getCash();
    expect(capturedBasic[0]!.authorization).toBe(
      `Basic ${Buffer.from('key123:sec456').toString('base64')}`,
    );
  });

  it('429 opakuje dle Retry-After, pak uspěje', async () => {
    const positions: Trading212Position[] = [
      { ticker: 'AAPL_US_EQ', quantity: 10, averagePrice: 150, currentPrice: 210, ppl: 600 },
    ];
    const client = new Trading212Client({
      apiKey: 'k',
      fetchImpl: makeFetch([
        { status: 429, headers: { 'retry-after': '0.01' } },
        { body: positions },
      ]),
    });
    await expect(client.getPositions()).resolves.toEqual(positions);
  });

  it('neúspěch (401) → Trading212ApiError se statusem', async () => {
    const client = new Trading212Client({
      apiKey: 'bad',
      fetchImpl: makeFetch([{ status: 401, body: { message: 'unauthorized' } }]),
    });
    await expect(client.getPositions()).rejects.toThrowError(Trading212ApiError);
  });

  it('requestExport posílá POST s JSON tělem', async () => {
    const captured: CapturedRequest[] = [];
    const client = new Trading212Client({ apiKey: 'k', fetchImpl: makeFetch([{ body: { reportId: 7 } }], captured) });
    await client.requestExport({
      timeFrom: '2025-01-01T00:00:00Z',
      timeTo: '2025-12-31T23:59:59Z',
      dataIncluded: {
        includeOrders: true,
        includeDividends: true,
        includeTransactions: true,
        includeInterest: true,
      },
    });
    expect(captured[0]!.method).toBe('POST');
    expect(JSON.parse(captured[0]!.body!)).toMatchObject({ timeFrom: '2025-01-01T00:00:00Z' });
  });
});

describe('mapPositionsToIsin', () => {
  it('mapuje interní tickery na ISIN a hlásí nespárované', () => {
    const positions: Trading212Position[] = [
      { ticker: 'AAPL_US_EQ', quantity: 10, averagePrice: 1, currentPrice: 1, ppl: 0 },
      { ticker: 'NEZNAMY_EQ', quantity: 5, averagePrice: 1, currentPrice: 1, ppl: 0 },
    ];
    const instruments: Trading212Instrument[] = [
      { ticker: 'AAPL_US_EQ', isin: 'US0378331005', currencyCode: 'USD', name: 'Apple' },
    ];
    const { positions: mapped, unmatchedTickers } = mapPositionsToIsin(positions, instruments);
    expect(mapped).toEqual([
      {
        isin: 'US0378331005',
        quantity: 10,
        ticker: 'AAPL_US_EQ',
        currentPrice: 1,
        currency: 'USD',
      },
    ]);
    expect(unmatchedTickers).toEqual(['NEZNAMY_EQ']);
  });
});

// B-5: useknuté tělo se parsuje BEZ jediné chyby — rok by pak navždy platil za
// stažený. Nesoulad s Content-Length musí skončit výjimkou, ať se rok stáhne znovu.
describe('downloadCsv: kontrola úplnosti přenosu', () => {
  const csvFetch = (body: string, headers: Record<string, string>): typeof fetch =>
    (async () => new Response(body, { status: 200, headers })) as typeof fetch;

  const client = (fetchImpl: typeof fetch): Trading212Client =>
    new Trading212Client({ apiKey: 'k', fetchImpl });

  it('useknuté tělo (kratší než Content-Length) → chyba s výzvou opakovat', async () => {
    const c = client(csvFetch('Action,Time\nMarket buy,2024', { 'content-length': '4096' }));
    await expect(c.downloadCsv('https://downloads.t212.test/1.csv')).rejects.toThrow(
      /neúplný/,
    );
  });

  it('sedící Content-Length projde (délka v BAJTECH, ne znacích)', async () => {
    const body = 'Akce,Čas\nNákup,2024';
    const bytes = new TextEncoder().encode(body).length;
    const c = client(csvFetch(body, { 'content-length': String(bytes) }));
    await expect(c.downloadCsv('https://downloads.t212.test/1.csv')).resolves.toBe(body);
  });

  it('bez Content-Length se neověřuje (nemáme s čím porovnat)', async () => {
    const c = client(csvFetch('cokoli', {}));
    await expect(c.downloadCsv('https://downloads.t212.test/1.csv')).resolves.toBe('cokoli');
  });

  it('komprimovaná odpověď se neověřuje (hlavička platí pro komprimované bajty)', async () => {
    const c = client(
      csvFetch('rozbalený obsah', { 'content-length': '12', 'content-encoding': 'gzip' }),
    );
    await expect(c.downloadCsv('https://downloads.t212.test/1.csv')).resolves.toBe(
      'rozbalený obsah',
    );
  });
});

const EXPORT_REQUEST = {
  timeFrom: '2026-01-01T00:00:00Z',
  timeTo: '2026-12-31T23:59:59Z',
  dataIncluded: {
    includeOrders: true,
    includeDividends: true,
    includeTransactions: true,
    includeInterest: true,
  },
};

describe('čekání na export (K5-16)', () => {
  /**
   * Rozpočet čekání byl časový a kontroloval se PŘED uspáním, takže se
   * o celý interval překračoval. Naměřeno v poměru 1:1000 k produkci
   * (poll 65 ms, rozpočet 600 ms): 10 dotazů a 671 ms — tedy 671 s tam, kde
   * měl volající 600 s, což je víc, než kolik má celý tick cronu na všechny
   * joby. Strop na POČTU dotazů dá pevnou horní mez.
   */
  it('export, který se v seznamu nikdy neobjeví, se vzdá po zadaném počtu dotazů', async () => {
    let listCalls = 0;
    const fetchImpl = (async (_url: string | URL, init?: RequestInit): Promise<Response> => {
      if (init?.method === 'POST') {
        return new Response(JSON.stringify({ reportId: 42 }), { status: 200 });
      }
      listCalls += 1;
      // reportId 42 se v seznamu neobjeví nikdy
      return new Response(JSON.stringify([{ reportId: 7, status: 'Finished' }]), { status: 200 });
    }) as unknown as typeof fetch;

    const client = new Trading212Client({ apiKey: 'k', fetchImpl });
    const startedAt = Date.now();
    await expect(
      client.fetchHistoryCsv(EXPORT_REQUEST, { pollIntervalMs: 65, maxAttempts: 9 }),
    ).rejects.toThrow(/ani po 9 dotazech/);
    const elapsed = Date.now() - startedAt;

    expect(listCalls).toBe(9);
    // horní mez je součin, ne součin plus jeden interval navíc
    expect(elapsed).toBeLessThan(9 * 65 + 120);
  }, 30_000);

  it('hotový export se stáhne hned, jakmile se objeví — strop čekání nezkracuje', async () => {
    let listCalls = 0;
    const fetchImpl = (async (url: string | URL, init?: RequestInit): Promise<Response> => {
      if (String(url).includes('downloads')) return new Response('Action,Time\n', { status: 200 });
      if (init?.method === 'POST') {
        return new Response(JSON.stringify({ reportId: 42 }), { status: 200 });
      }
      listCalls += 1;
      // první dva dotazy: export se teprve generuje
      const status = listCalls < 3 ? 'Processing' : 'Finished';
      return new Response(
        JSON.stringify([
          {
            reportId: 42,
            status,
            ...(status === 'Finished' ? { downloadLink: 'https://downloads.t212.test/42.csv' } : {}),
          },
        ]),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const client = new Trading212Client({ apiKey: 'k', fetchImpl });
    await expect(
      client.fetchHistoryCsv(EXPORT_REQUEST, { pollIntervalMs: 5, maxAttempts: 9 }),
    ).resolves.toBe('Action,Time\n');
    expect(listCalls).toBe(3);
  }, 30_000);
});

describe('mapPositionsToIsin — tvar odpovědi brokera (K5-09)', () => {
  /**
   * `request()` vrací, co přijde, takže obalení pozic do objektu skončí uvnitř
   * `for…of` jako `TypeError`. Naměřeno: uživatel četl v UI surové anglické
   * „positions is not iterable“ jako text chyby synchronizace.
   */
  it('pozice v jiném tvaru než pole vyhodí českou chybu, ne TypeError', () => {
    const jinyTvar = { items: [] } as unknown as Trading212Position[];
    expect(() => mapPositionsToIsin(jinyTvar, [])).toThrow(Trading212ApiError);
    expect(() => mapPositionsToIsin(jinyTvar, [])).toThrow(/v jiném tvaru/);
    expect(() => mapPositionsToIsin(jinyTvar, [])).not.toThrow(/is not iterable/);
  });

  it('číselník instrumentů v jiném tvaru než pole taky', () => {
    const jinyTvar = null as unknown as Trading212Instrument[];
    expect(() => mapPositionsToIsin([], jinyTvar)).toThrow(/v jiném tvaru/);
  });
});

describe('cesta exportních endpointů (T212 ji v dokumentaci přesunul pod /equity)', () => {
  it('na 404 zkusí dokumentovanou cestu a tu úspěšnou si zapamatuje', async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string | URL): Promise<Response> => {
      const path = new URL(String(url)).pathname;
      calls.push(path);
      if (path.endsWith('/api/v0/history/exports')) {
        return new Response('not found', { status: 404 });
      }
      return new Response(JSON.stringify([]), { status: 200 });
    }) as unknown as typeof fetch;

    const client = new Trading212Client({ apiKey: 'k', fetchImpl });
    await expect(client.listExports()).resolves.toEqual([]);
    expect(calls).toEqual(['/api/v0/history/exports', '/api/v0/equity/history/exports']);

    // druhé volání už jde rovnou na fungující cestu (limit je 1 dotaz / 30 s)
    calls.length = 0;
    await client.listExports();
    expect(calls).toEqual(['/api/v0/equity/history/exports']);
  });
});
