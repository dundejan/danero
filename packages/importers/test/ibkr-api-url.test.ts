import { describe, expect, it } from 'vitest';
import { IbkrFlexClient } from '../src';
import { IBKR_FIXTURE } from './fixtures/ibkr';

/**
 * D-7: Flex token smí odejít jen tam, kam je klient nastavený. Odpověď
 * SendRequest nese `<Url>`, kterou dokumentace IBKR říká ignorovat („The <url>
 * returned in the response body should be ignored“) — a klient ji opravdu
 * nečte, takže ať v ní stojí cokoli, výpis se vyzvedne na základní adrese.
 */
const sendWithUrl = (url: string) => `<FlexStatementResponse timestamp="x">
  <Status>Success</Status>
  <ReferenceCode>REF123</ReferenceCode>
  <Url>${url}</Url>
</FlexStatementResponse>`;

function mockFetch(send: string) {
  const urls: string[] = [];
  const fetchImpl: typeof fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    urls.push(url);
    if (url.includes('SendRequest')) return new Response(send, { status: 200 });
    return new Response(IBKR_FIXTURE, { status: 200 });
  }) as typeof fetch;
  return { fetchImpl, urls };
}

const client = (send: string, baseUrl?: string) => {
  const mock = mockFetch(send);
  return {
    mock,
    client: new IbkrFlexClient({
      token: 'tok-abc',
      queryId: '123456',
      fetchImpl: mock.fetchImpl,
      ...(baseUrl ? { baseUrl } : {}),
    }),
  };
};

const DOCUMENTED_STATEMENT_URL =
  'https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService/GetStatement?t=tok-abc&q=REF123&v=3';

describe('adresa z odpovědi IBKR se ignoruje (D-7)', () => {
  it.each([
    ['cizí doména', 'https://utocnik.example.com/GetStatement'],
    ['http varianta domény IBKR', 'http://ndcdyn.interactivebrokers.com/GetStatement'],
    ['doména, která jen končí na jméno IBKR', 'https://notinteractivebrokers.com/GetStatement'],
    [
      'stará adresa, která od května 2026 vrací na všechno 1001',
      'https://gdcdyn.interactivebrokers.com/Universal/servlet/FlexStatementService.GetStatement',
    ],
    ['adresa s vlastními parametry', 'https://ndcdyn.interactivebrokers.com/GetStatement?t=cizi-token&amp;x=1'],
  ])('%s: výpis se vyzvedne na dokumentované adrese a token jinam neodejde', async (_label, url) => {
    const { client: c, mock } = client(sendWithUrl(url));
    expect(await c.fetchStatementXml({ pollIntervalMs: 5, maxAttempts: 3 })).toContain(
      '<FlexQueryResponse',
    );
    expect(mock.urls).toHaveLength(2);
    expect(mock.urls[1]).toBe(DOCUMENTED_STATEMENT_URL);
  });

  it('nakonfigurovaná adresa (mock, vlastní proxy) platí pro obě fáze', async () => {
    const { client: c, mock } = client(
      sendWithUrl('https://jinde.test/GetStatement'),
      'https://flex.test',
    );
    expect(await c.fetchStatementXml({ pollIntervalMs: 5, maxAttempts: 3 })).toContain('<FlexQueryResponse');
    expect(mock.urls[0]).toBe('https://flex.test/SendRequest?t=tok-abc&q=123456&p=365&v=3');
    expect(mock.urls[1]).toBe('https://flex.test/GetStatement?t=tok-abc&q=REF123&v=3');
  });
});
