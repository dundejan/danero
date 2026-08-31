import { describe, expect, it } from 'vitest';
import { IbkrFlexClient, IbkrFlexError } from '../src';
import { IBKR_FIXTURE } from './fixtures/ibkr';

const SEND_OK = `<FlexStatementResponse timestamp="x">
  <Status>Success</Status>
  <ReferenceCode>REF123</ReferenceCode>
  <Url>https://gdcdyn.interactivebrokers.com/AccountManagement/FlexWebService/GetStatement</Url>
</FlexStatementResponse>`;

const IN_PROGRESS = `<FlexStatementResponse timestamp="x">
  <Status>Warn</Status>
  <ErrorCode>1019</ErrorCode>
  <ErrorMessage>Statement generation in progress.</ErrorMessage>
</FlexStatementResponse>`;

const BAD_TOKEN = `<FlexStatementResponse timestamp="x">
  <Status>Fail</Status>
  <ErrorCode>1012</ErrorCode>
  <ErrorMessage>Token has expired.</ErrorMessage>
</FlexStatementResponse>`;

/** Škrcení: IBKR pouští jednu objednávku za čas — dočasné, ne fatální. */
const THROTTLED = `<FlexStatementResponse timestamp="x">
  <Status>Warn</Status>
  <ErrorCode>1018</ErrorCode>
  <ErrorMessage>Too many requests.</ErrorMessage>
</FlexStatementResponse>`;

function makeFetch(script: { send: string; statements: string[] }) {
  const urls: string[] = [];
  let statementCalls = 0;
  const fetchImpl: typeof fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    urls.push(url);
    if (url.includes('SendRequest')) return new Response(script.send, { status: 200 });
    const body = script.statements[Math.min(statementCalls, script.statements.length - 1)]!;
    statementCalls += 1;
    return new Response(body, { status: 200 });
  }) as typeof fetch;
  return { fetchImpl, urls };
}

describe('IbkrFlexClient (mock fetch)', () => {
  it('SendRequest → poll 1019 → hotový FlexQueryResponse', async () => {
    const mock = makeFetch({ send: SEND_OK, statements: [IN_PROGRESS, IN_PROGRESS, IBKR_FIXTURE] });
    const client = new IbkrFlexClient({
      token: 'tok-abc',
      queryId: '123456',
      fetchImpl: mock.fetchImpl,
    });
    const xml = await client.fetchStatementXml({ pollIntervalMs: 5, maxAttempts: 3 });
    expect(xml).toContain('<FlexQueryResponse');
    // SendRequest nese token+query, GetStatement referenceCode
    expect(mock.urls[0]).toContain('SendRequest?t=tok-abc&q=123456&v=3');
    expect(mock.urls[1]).toContain('GetStatement?t=tok-abc&q=REF123&v=3');
    expect(mock.urls).toHaveLength(4);
  });

  it('expirovaný token → česká chyba s návodem', async () => {
    const mock = makeFetch({ send: BAD_TOKEN, statements: [] });
    const client = new IbkrFlexClient({
      token: 'starý',
      queryId: '123456',
      fetchImpl: mock.fetchImpl,
    });
    await expect(client.fetchStatementXml({ pollIntervalMs: 5, maxAttempts: 3 })).rejects.toThrow(/vygeneruj v IBKR nový/);
  });

  it('nekonečné 1019 → timeout se srozumitelnou hláškou', async () => {
    const mock = makeFetch({ send: SEND_OK, statements: [IN_PROGRESS] });
    const client = new IbkrFlexClient({
      token: 'tok',
      queryId: '1',
      fetchImpl: mock.fetchImpl,
    });
    await expect(client.fetchStatementXml({ pollIntervalMs: 5, maxAttempts: 3 })).rejects.toThrow(
      IbkrFlexError,
    );
    await expect(
      new IbkrFlexClient({
        token: 'tok',
        queryId: '1',
        fetchImpl: mock.fetchImpl,
      }).fetchStatementXml({ pollIntervalMs: 5, maxAttempts: 3 }),
    ).rejects.toThrow(/za pár minut/);
  });

  /**
   * Čekání na výpis má strop v POČTU POKUSŮ, ne v čase. Časový rozpočet se
   * kontroloval před uspáním, takže čekání přeteklo o celý interval — a byl
   * nastavený na 600 s, tedy na celý rozpočet ticku cronu. Stejná vada jako
   * u Trading212 (`EXPORT_POLL_ATTEMPTS`).
   */
  it('nekonečné 1019: dotazů je přesně maxAttempts + 1 a hláška to říká', async () => {
    const mock = makeFetch({ send: SEND_OK, statements: [IN_PROGRESS] });
    const client = new IbkrFlexClient({ token: 'tok', queryId: '1', fetchImpl: mock.fetchImpl });
    await expect(client.fetchStatementXml({ pollIntervalMs: 1, maxAttempts: 4 })).rejects.toThrow(
      /ani po 4 dotazech/,
    );
    const statementCalls = mock.urls.filter((url) => url.includes('GetStatement')).length;
    expect(statementCalls).toBe(5); // první dotaz + 4 opakování
  });

  /** Škrcení 1018 při objednávce čerpá TÝŽ rozpočet — jinak by se čekání sečetlo. */
  it('1018 u SendRequest se počítá do stejného stropu pokusů', async () => {
    const mock = makeFetch({ send: THROTTLED, statements: [IN_PROGRESS] });
    const client = new IbkrFlexClient({ token: 'tok', queryId: '1', fetchImpl: mock.fetchImpl });
    await expect(client.fetchStatementXml({ pollIntervalMs: 1, maxAttempts: 3 })).rejects.toThrow(
      IbkrFlexError,
    );
    // 4 objednávky (první + 3 opakování ze stropu), pak už na výpis nezbylo
    expect(mock.urls.filter((url) => url.includes('SendRequest'))).toHaveLength(4);
    expect(mock.urls.filter((url) => url.includes('GetStatement'))).toHaveLength(0);
  });
});
