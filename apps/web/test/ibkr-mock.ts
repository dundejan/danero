/** Mock IBKR Flex Web Service pro testy sync jobu. Data: test/ibkr-data.mjs. */
import { FLEX_BAD_TOKEN, FLEX_IN_PROGRESS, FLEX_SEND_OK, IBKR_FLEX_XML } from './ibkr-data.mjs';

export const IBKR_MOCK_CREDENTIALS = JSON.stringify({
  token: 'mock-flex-token-123',
  queryId: '654321',
});

export function makeIbkrMockFetch(
  options: {
    failToken?: boolean;
    /** Flex Query bez sekce Open Positions — není s čím porovnávat (B4-4). */
    withoutOpenPositions?: boolean;
  } = {},
) {
  const urls: string[] = [];
  let statementCalls = 0;
  const xml = options.withoutOpenPositions
    ? IBKR_FLEX_XML.replace(/ {6}<OpenPositions>[\s\S]*?<\/OpenPositions>\n/, '')
    : IBKR_FLEX_XML;

  const fetchImpl: typeof fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    urls.push(url);
    if (url.includes('SendRequest')) {
      if (options.failToken) return new Response(FLEX_BAD_TOKEN, { status: 200 });
      // adresa musí být na doméně IBKR — klient cizí hostname odmítá (D-7)
      return new Response(
        FLEX_SEND_OK('https://gdcdyn.interactivebrokers.com/AccountManagement/FlexWebService/GetStatement'),
        { status: 200 },
      );
    }
    // první GetStatement „generuje se“, pak hotový výpis
    statementCalls += 1;
    return new Response(statementCalls === 1 ? FLEX_IN_PROGRESS : xml, { status: 200 });
  }) as typeof fetch;

  return { fetchImpl, urls };
}
