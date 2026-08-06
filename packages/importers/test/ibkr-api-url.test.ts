import { describe, expect, it } from 'vitest';
import { IbkrFlexClient } from '../src';
import { IBKR_FIXTURE } from './fixtures/ibkr';

/**
 * D-7: `sendRequest` přebírá adresu pro vyzvednutí výpisu z odpovědi IBKR
 * a připojuje k ní Flex token — cizí hostname by znamenal token poslaný
 * cizímu serveru.
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

describe('důvěra k adrese z odpovědi IBKR (D-7)', () => {
  it('cizí doména v odpovědi = chyba a token se tam neodešle', async () => {
    const { client: c, mock } = client(sendWithUrl('https://utocnik.example.com/GetStatement'));
    await expect(c.fetchStatementXml(5, 1_000)).rejects.toThrow(/cizí adresu \(utocnik/);
    expect(mock.urls.every((url) => !url.includes('utocnik.example.com'))).toBe(true);
    expect(mock.urls).toHaveLength(1); // jen SendRequest, žádné vyzvednutí
  });

  it('http varianta domény IBKR taky neprojde (token by šel v čitelné podobě)', async () => {
    const { client: c } = client(sendWithUrl('http://ndcdyn.interactivebrokers.com/GetStatement'));
    await expect(c.fetchStatementXml(5, 1_000)).rejects.toThrow(/cizí adresu/);
  });

  it('doména, která jen KONČÍ na jméno IBKR, neprojde', async () => {
    const { client: c } = client(sendWithUrl('https://notinteractivebrokers.com/GetStatement'));
    await expect(c.fetchStatementXml(5, 1_000)).rejects.toThrow(/cizí adresu/);
  });

  it('jiná subdoména IBKR projde (výpisy chodí z gdcdyn i ndcdyn)', async () => {
    const { client: c, mock } = client(
      sendWithUrl('https://gdcdyn.interactivebrokers.com/AccountManagement/FlexWebService/GetStatement'),
    );
    expect(await c.fetchStatementXml(5, 10_000)).toContain('<FlexQueryResponse');
    expect(mock.urls[1]).toBe(
      'https://gdcdyn.interactivebrokers.com/AccountManagement/FlexWebService/GetStatement?t=tok-abc&q=REF123&v=3',
    );
  });

  it('nakonfigurovaná adresa (mock, vlastní proxy) projde beze změny', async () => {
    const { client: c, mock } = client(
      sendWithUrl('https://flex.test/GetStatement'),
      'https://flex.test',
    );
    expect(await c.fetchStatementXml(5, 10_000)).toContain('<FlexQueryResponse');
    expect(mock.urls[1]).toBe('https://flex.test/GetStatement?t=tok-abc&q=REF123&v=3');
  });

  it('parametry z odpovědi se zahazují — token se skládá sám', async () => {
    const { client: c, mock } = client(
      sendWithUrl('https://ndcdyn.interactivebrokers.com/GetStatement?t=cizi-token&amp;x=1'),
    );
    expect(await c.fetchStatementXml(5, 10_000)).toContain('<FlexQueryResponse');
    expect(mock.urls[1]).toBe(
      'https://ndcdyn.interactivebrokers.com/GetStatement?t=tok-abc&q=REF123&v=3',
    );
  });
});
