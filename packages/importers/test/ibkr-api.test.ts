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
    const xml = await client.fetchStatementXml(5, 10_000);
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
    await expect(client.fetchStatementXml(5, 1_000)).rejects.toThrow(/vygeneruj v IBKR nový/);
  });

  it('nekonečné 1019 → timeout se srozumitelnou hláškou', async () => {
    const mock = makeFetch({ send: SEND_OK, statements: [IN_PROGRESS] });
    const client = new IbkrFlexClient({
      token: 'tok',
      queryId: '1',
      fetchImpl: mock.fetchImpl,
    });
    await expect(client.fetchStatementXml(5, 30)).rejects.toThrow(IbkrFlexError);
    await expect(
      new IbkrFlexClient({ token: 'tok', queryId: '1', fetchImpl: mock.fetchImpl }).fetchStatementXml(
        5,
        30,
      ),
    ).rejects.toThrow(/za pár minut/);
  });
});
