import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  mapPositionsToIsin,
  positionsCarryIsin,
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
    await new Trading212Client({ apiKey: 'key123', fetchImpl: makeFetch([{ body: {} }], captured) }).getAccountSummary();
    expect(captured[0]!.authorization).toBe('key123');
    expect(captured[0]!.url).toBe('https://live.trading212.com/api/v0/equity/account/summary');

    const capturedBasic: CapturedRequest[] = [];
    await new Trading212Client({
      apiKey: 'key123',
      apiSecret: 'sec456',
      fetchImpl: makeFetch([{ body: {} }], capturedBasic),
    }).getAccountSummary();
    expect(capturedBasic[0]!.authorization).toBe(
      `Basic ${Buffer.from('key123:sec456').toString('base64')}`,
    );
  });

  it('429 opakuje dle Retry-After, pak uspěje', async () => {
    const positions: Trading212Position[] = [
      { ticker: 'AAPL_US_EQ', quantity: 10, currentPrice: 210 },
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
      { ticker: 'AAPL_US_EQ', quantity: 10, currentPrice: 1 },
      { ticker: 'NEZNAMY_EQ', quantity: 5, currentPrice: 1 },
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

/**
 * Cesty a tvary podle OpenAPI specifikace https://docs.trading212.com/api
 * (stav 13. 10. 2026). `/equity/account/cash` a `/equity/portfolio` z ní
 * zmizely na přelomu let 2025 a 2026, exporty se přestěhovaly pod `/equity`.
 * Klient proto volá dokumentovanou cestu a starší má jako zálohu na 404.
 */
describe('cesty endpointů: dokumentovaná napřed, starší jako záloha na 404', () => {
  const DOCUMENTED_POSITION = {
    instrument: { ticker: 'AAA_US_EQ', name: 'Alfa Inc', isin: 'US0000000001', currency: 'USD' },
    createdAt: '2025-02-10T14:30:02.000Z',
    quantity: 12.5,
    quantityAvailableForTrading: 12.5,
    quantityInPies: 0,
    currentPrice: 21.4,
    averagePricePaid: 19.9,
    walletImpact: {
      currency: 'EUR',
      totalCost: 228.1,
      currentValue: 246.2,
      unrealizedProfitLoss: 18.1,
      fxImpact: null,
    },
  };
  const DOCUMENTED_SUMMARY = {
    id: 1234567,
    currency: 'EUR',
    totalValue: 1500.5,
    cash: { availableToTrade: 100.25, inPies: 0, reservedForOrders: 0 },
    investments: {
      currentValue: 1400.25,
      totalCost: 1300,
      realizedProfitLoss: 12.5,
      unrealizedProfitLoss: 100.25,
    },
  };

  /** API, které zná jen vyjmenované cesty; ostatní vrací 404 jako zrušená cesta. */
  const apiWith = (routes: Record<string, unknown>, calls: string[] = []): typeof fetch =>
    (async (url: string | URL): Promise<Response> => {
      const path = new URL(String(url)).pathname.replace('/api/v0', '');
      calls.push(path);
      return path in routes
        ? new Response(JSON.stringify(routes[path]), { status: 200 })
        : new Response('{"status":404,"title":"Requested entity not found"}', { status: 404 });
    }) as unknown as typeof fetch;

  const clientOf = (fetchImpl: typeof fetch): Trading212Client =>
    new Trading212Client({ apiKey: 'key-id', apiSecret: 'secret-000000', fetchImpl });

  it('účet se čte z /equity/account/summary', async () => {
    const calls: string[] = [];
    const client = clientOf(apiWith({ '/equity/account/summary': DOCUMENTED_SUMMARY }, calls));
    await expect(client.getAccountSummary()).resolves.toEqual({ currency: 'EUR', freeCash: 100.25 });
    expect(calls).toEqual(['/equity/account/summary']);
  });

  it('když dokumentovaná cesta účtu vrátí 404, poslouží starší /equity/account/cash', async () => {
    const calls: string[] = [];
    const client = clientOf(
      apiWith({ '/equity/account/cash': { free: 55.5, total: 80, invested: 24.5 } }, calls),
    );
    await expect(client.getAccountSummary()).resolves.toEqual({ freeCash: 55.5 });
    await client.getAccountSummary();
    // napodruhé už bez zbytečného dotazu na cestu, která neexistuje
    expect(calls).toEqual(['/equity/account/summary', '/equity/account/cash', '/equity/account/cash']);
  });

  it('pozice z /equity/positions nesou ISIN samy — číselník instrumentů není potřeba', async () => {
    const calls: string[] = [];
    const client = clientOf(apiWith({ '/equity/positions': [DOCUMENTED_POSITION] }, calls));
    const positions = await client.getPositions();
    expect(positionsCarryIsin(positions)).toBe(true);
    expect(mapPositionsToIsin(positions)).toEqual({
      positions: [
        { isin: 'US0000000001', ticker: 'AAA_US_EQ', quantity: 12.5, currentPrice: 21.4, currency: 'USD' },
      ],
      unmatchedTickers: [],
    });
    expect(calls).toEqual(['/equity/positions']);
  });

  it('když dokumentovaná cesta pozic vrátí 404, poslouží starší /equity/portfolio s číselníkem', async () => {
    const client = clientOf(
      apiWith({
        '/equity/portfolio': [
          { ticker: 'AAA_US_EQ', quantity: 12.5, averagePrice: 19.9, currentPrice: 21.4, ppl: 18.1 },
        ],
        '/equity/metadata/instruments': [
          { ticker: 'AAA_US_EQ', isin: 'US0000000001', currencyCode: 'USD', name: 'Alfa Inc' },
        ],
      }),
    );
    const positions = await client.getPositions();
    expect(positionsCarryIsin(positions)).toBe(false);
    const mapped = mapPositionsToIsin(positions, await client.getInstruments());
    expect(mapped.unmatchedTickers).toEqual([]);
    expect(mapped.positions).toEqual([
      { isin: 'US0000000001', ticker: 'AAA_US_EQ', quantity: 12.5, currentPrice: 21.4, currency: 'USD' },
    ]);
  });

  it('položka pozic bez tickeru nebo kusů je cizí tvar, ne pozice k zahození', async () => {
    const client = clientOf(
      apiWith({ '/equity/positions': [DOCUMENTED_POSITION, { instrument: { isin: 'US0000000002' } }] }),
    );
    await expect(client.getPositions()).rejects.toThrow(/v jiném tvaru/);
  });

  it('exporty: na 404 z /equity/history/exports zkusí starší cestu a zapamatuje si ji', async () => {
    const calls: string[] = [];
    const client = clientOf(apiWith({ '/history/exports': [] }, calls));
    await expect(client.listExports()).resolves.toEqual([]);
    expect(calls).toEqual(['/equity/history/exports', '/history/exports']);

    // druhé volání už jde rovnou na fungující cestu (limit je 1 dotaz / 30 s)
    calls.length = 0;
    await client.listExports();
    expect(calls).toEqual(['/history/exports']);
  });

  it('404 na obou cestách skončí chybou 404, ne tichým prázdnem', async () => {
    const error = await clientOf(apiWith({}))
      .getPositions()
      .then(
        () => null,
        (reason: unknown) => reason,
      );
    expect(error).toBeInstanceOf(Trading212ApiError);
    expect((error as Trading212ApiError).status).toBe(404);
  });
});

describe('stav exportu Canceled', () => {
  // Specifikace: ReportResponse.status = Queued | Processing | Running |
  // Canceled | Failed | Finished. Zrušený export už hotový nebude.
  it('ukončí čekání hned a neskončí jako vypršení (408)', async () => {
    let listCalls = 0;
    const fetchImpl = (async (_url: string | URL, init?: RequestInit): Promise<Response> => {
      if (init?.method === 'POST') {
        return new Response(JSON.stringify({ reportId: 501 }), { status: 200 });
      }
      listCalls += 1;
      return new Response(JSON.stringify([{ reportId: 501, status: 'Canceled' }]), { status: 200 });
    }) as unknown as typeof fetch;

    const error = await new Trading212Client({ apiKey: 'k', apiSecret: 's', fetchImpl })
      .fetchHistoryCsv(EXPORT_REQUEST, { pollIntervalMs: 1, maxAttempts: 4 })
      .then(
        () => null,
        (reason: unknown) => reason,
      );

    expect(error).toBeInstanceOf(Trading212ApiError);
    expect((error as Trading212ApiError).message).toMatch(/zrušen/);
    expect((error as Trading212ApiError).status).not.toBe(408);
    expect(listCalls).toBe(1);
  });
});

describe('čekání po 429', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const limited = (headers: Record<string, string>): Response =>
    new Response('{"code":"TooManyRequests"}', { status: 429, headers });

  // Dokumentace: „Every API response includes … x-ratelimit-reset: A Unix
  // timestamp indicating the exact time when the limit will be fully reset.“
  it('řídí se hlavičkou x-ratelimit-reset — limit obnovený za 2 s nestojí půl minuty', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-13T10:00:00Z') });
    const resetAt = Math.floor(Date.now() / 1000) + 2;
    let calls = 0;
    const fetchImpl = (async (): Promise<Response> => {
      calls += 1;
      return calls === 1
        ? limited({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(resetAt) })
        : new Response('[]', { status: 200 });
    }) as unknown as typeof fetch;

    const pending = new Trading212Client({ apiKey: 'k', apiSecret: 's', fetchImpl }).getPositions();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(calls).toBe(2);
    await expect(pending).resolves.toEqual([]);
  });

  it('bez hlaviček čeká 30 s (exporty je u 429 neposílají)', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-13T10:00:00Z') });
    let calls = 0;
    const fetchImpl = (async (): Promise<Response> => {
      calls += 1;
      return calls === 1 ? limited({}) : new Response('[]', { status: 200 });
    }) as unknown as typeof fetch;

    const pending = new Trading212Client({ apiKey: 'k', apiSecret: 's', fetchImpl }).listExports();
    await vi.advanceTimersByTimeAsync(29_000);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(calls).toBe(2);
    await expect(pending).resolves.toEqual([]);
  });

  it('součet čekání na jeden dotaz nepřeroste dvě minuty', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-13T10:00:00Z') });
    let calls = 0;
    const fetchImpl = (async (): Promise<Response> => {
      calls += 1;
      return limited({ 'retry-after': '100' });
    }) as unknown as typeof fetch;

    const outcome = new Trading212Client({ apiKey: 'k', apiSecret: 's', fetchImpl })
      .getPositions()
      .then(
        () => null,
        (reason: unknown) => reason,
      );
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    const error = await outcome;
    expect(error).toBeInstanceOf(Trading212ApiError);
    expect((error as Trading212ApiError).status).toBe(429);
    // první čekání 100 s proběhne, druhé by součet přetáhlo přes 120 s
    expect(calls).toBe(2);
  });
});
