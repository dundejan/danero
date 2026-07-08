/**
 * Jediný zdroj testovacích IBKR Flex dat — sdílí ho vitest mock (test/ibkr-mock.ts)
 * i E2E mock server (e2e/t212-mock-server.mjs). Konzistentní příběh: nákup 100
 * AAPL (2024), prodej 40 (2026), dividenda se srážkou → aktuální pozice 60 ks,
 * rekonciliace proti OpenPositions sedí.
 */

export const IBKR_FLEX_XML = `<?xml version="1.0" encoding="UTF-8"?>
<FlexQueryResponse queryName="danero" type="AF">
  <FlexStatements count="1">
    <FlexStatement accountId="U7777777" fromDate="20240101" toDate="20261231" whenGenerated="20260708;080000">
      <Trades>
        <Trade accountId="U7777777" assetCategory="STK" symbol="AAPL" description="APPLE INC" conid="265598" isin="US0378331005" currency="USD" tradeID="5001" transactionID="7001" tradeDate="20240610" settleDateTarget="20240611" buySell="BUY" quantity="100" tradePrice="150" ibCommission="-1" ibCommissionCurrency="USD" levelOfDetail="EXECUTION" />
        <Trade accountId="U7777777" assetCategory="STK" symbol="AAPL" description="APPLE INC" conid="265598" isin="US0378331005" currency="USD" tradeID="5002" transactionID="7002" tradeDate="20260305" settleDateTarget="20260306" buySell="SELL" quantity="-40" tradePrice="210" ibCommission="-1" ibCommissionCurrency="USD" levelOfDetail="EXECUTION" />
      </Trades>
      <CashTransactions>
        <CashTransaction accountId="U7777777" type="Dividends" symbol="AAPL" description="AAPL CASH DIVIDEND" conid="265598" isin="US0378331005" currency="USD" amount="25" dateTime="20260510" transactionID="7101" levelOfDetail="DETAIL" />
        <CashTransaction accountId="U7777777" type="Withholding Tax" symbol="AAPL" description="AAPL US TAX" conid="265598" isin="US0378331005" currency="USD" amount="-3.75" dateTime="20260510" transactionID="7102" levelOfDetail="DETAIL" />
      </CashTransactions>
      <OpenPositions>
        <OpenPosition accountId="U7777777" assetCategory="STK" symbol="AAPL" conid="265598" isin="US0378331005" position="60" levelOfDetail="SUMMARY" />
      </OpenPositions>
    </FlexStatement>
  </FlexStatements>
</FlexQueryResponse>`;

export const FLEX_SEND_OK = (url) => `<FlexStatementResponse timestamp="x">
  <Status>Success</Status>
  <ReferenceCode>REF777</ReferenceCode>
  <Url>${url}</Url>
</FlexStatementResponse>`;

export const FLEX_IN_PROGRESS = `<FlexStatementResponse timestamp="x">
  <Status>Warn</Status>
  <ErrorCode>1019</ErrorCode>
  <ErrorMessage>Statement generation in progress.</ErrorMessage>
</FlexStatementResponse>`;

export const FLEX_BAD_TOKEN = `<FlexStatementResponse timestamp="x">
  <Status>Fail</Status>
  <ErrorCode>1012</ErrorCode>
  <ErrorMessage>Token has expired.</ErrorMessage>
</FlexStatementResponse>`;
