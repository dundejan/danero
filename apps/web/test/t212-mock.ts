/** Sdílený mock T212 API pro testy syncu a background jobů. Data: test/t212-data.mjs. */
import { CASH, csvByYear, CSV_HEADER, INSTRUMENTS, PORTFOLIO } from './t212-data.mjs';

export const CSV_BY_YEAR = csvByYear('EOFSYNC');

export const MOCK_CREDENTIALS = JSON.stringify({
  keyId: 'key-id-123',
  secret: 'mock-secret-456789',
});

/** Mock T212 API: exporty per rok (rok čteme z těla requestu), pozice pro rekonciliaci. */
export function makeMockFetch(
  options: {
    rejectBasicAuth?: boolean;
    failExports?: boolean;
    /** Výpadek generování exportů: každý rok se stáhne jako ÚPLNĚ prázdný soubor. */
    emptyExports?: boolean;
    /** Účet u brokera nedrží žádnou pozici (nově založený účet). */
    emptyPortfolio?: boolean;
    /** Data vydá jen za tyhle roky (neúplná historie — ostatní roky prázdné). */
    onlyYears?: number[];
    /**
     * Přenos exportu se u těchto let přerušil hned za hlavičkou — přijde CSV
     * hlavička bez jediného datového řádku (B4-1). Prázdný rok tohle NENÍ:
     * ten posílá T212 jako úplně prázdný soubor.
     */
    truncatedYears?: number[];
  } = {},
) {
  const reportYears = new Map<number, number>();
  let lastReportId = 100;
  const requestedYears: number[] = [];
  const authorizations: string[] = [];

  const fetchImpl: typeof fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const authorization = new Headers(init?.headers).get('authorization') ?? '';
    authorizations.push(authorization);
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

    if (url.endsWith('/equity/account/cash')) {
      // simulace API, které pár ID+secret přes Basic odmítá (nejednoznačná dokumentace)
      if (options.rejectBasicAuth && authorization.startsWith('Basic ')) {
        return new Response('{"message":"unauthorized"}', { status: 401 });
      }
      return json(CASH);
    }
    if (url.endsWith('/history/exports') && method === 'POST') {
      if (options.failExports) {
        return new Response('{"message":"forbidden"}', { status: 403 });
      }
      const body = JSON.parse(String(init?.body)) as { timeFrom: string };
      const year = Number(body.timeFrom.slice(0, 4));
      requestedYears.push(year);
      lastReportId += 1;
      reportYears.set(lastReportId, year);
      return json({ reportId: lastReportId });
    }
    if (url.endsWith('/history/exports')) {
      return json([
        {
          reportId: lastReportId,
          status: 'Finished',
          downloadLink: `https://downloads.t212.test/${lastReportId}.csv`,
        },
      ]);
    }
    const download = /downloads\.t212\.test\/(\d+)\.csv/.exec(url);
    if (download) {
      const year = reportYears.get(Number(download[1]))!;
      // useknutý přenos: hlavička dorazila, datové řádky ne (bez Content-Length
      // ho nemá co odhalit) — schválně BEZ hlavičky Content-Length
      if (options.truncatedYears?.includes(year)) {
        return new Response(CSV_HEADER, { status: 200 });
      }
      const hidden = options.emptyExports || (options.onlyYears && !options.onlyYears.includes(year));
      // prázdné roky vrací T212 jako ÚPLNĚ prázdný soubor (ověřeno na reálném API)
      return new Response(hidden ? '' : (CSV_BY_YEAR[year] ?? ''), { status: 200 });
    }
    if (url.endsWith('/equity/portfolio')) {
      return json(options.emptyPortfolio ? [] : PORTFOLIO);
    }
    if (url.endsWith('/equity/metadata/instruments')) {
      return json(INSTRUMENTS);
    }
    throw new Error(`Mock nezná URL: ${method} ${url}`);
  }) as typeof fetch;

  return { fetchImpl, requestedYears, authorizations };
}
