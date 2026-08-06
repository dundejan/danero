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
