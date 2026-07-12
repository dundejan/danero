/** Mock IBKR Flex Web Service pro testy sync jobu. Data: test/ibkr-data.mjs. */
import { FLEX_BAD_TOKEN, FLEX_IN_PROGRESS, FLEX_SEND_OK, IBKR_FLEX_XML } from './ibkr-data.mjs';

export const IBKR_MOCK_CREDENTIALS = JSON.stringify({
  token: 'mock-flex-token-123',
  queryId: '654321',
});

export function makeIbkrMockFetch(options: { failToken?: boolean } = {}) {
  const urls: string[] = [];
  let statementCalls = 0;

  const fetchImpl: typeof fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    urls.push(url);
    if (url.includes('SendRequest')) {
      if (options.failToken) return new Response(FLEX_BAD_TOKEN, { status: 200 });
      return new Response(FLEX_SEND_OK('https://flex.test/GetStatement'), { status: 200 });
    }
    // první GetStatement „generuje se“, pak hotový výpis
    statementCalls += 1;
    return new Response(statementCalls === 1 ? FLEX_IN_PROGRESS : IBKR_FLEX_XML, { status: 200 });
  }) as typeof fetch;

  return { fetchImpl, urls };
}
