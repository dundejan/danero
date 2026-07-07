/**
 * Fixture IBKR Flex Query XML — atributy dle reálného Flex formátu
 * (referenčně csingley/ibflex). Pokrývá Trades (buy/sell/forex/opce),
 * CashTransactions (dividenda + srážka, úrok, poplatek, vklad/výběr),
 * CorporateActions (FS, RS, IC pár, TC pár, TC cash, SO, neznámý typ),
 * Transfers a OpenPositions.
 */

export const IBKR_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<FlexQueryResponse queryName="danero" type="AF">
  <FlexStatements count="1">
    <FlexStatement accountId="U1234567" fromDate="20240101" toDate="20261231" period="Custom" whenGenerated="20260707;120000">
      <Trades>
        <Trade accountId="U1234567" assetCategory="STK" symbol="AAPL" description="APPLE INC" conid="265598" isin="US0378331005" currency="USD" tradeID="1001" transactionID="9001" reportDate="20240610" tradeDate="20240610" settleDateTarget="20240611" buySell="BUY" quantity="100" tradePrice="185.50" ibCommission="-1" ibCommissionCurrency="USD" levelOfDetail="EXECUTION" />
        <Trade accountId="U1234567" assetCategory="STK" symbol="AAPL" description="APPLE INC" conid="265598" isin="US0378331005" currency="USD" tradeID="1002" transactionID="9002" reportDate="20260305" tradeDate="20260305" settleDateTarget="20260306" buySell="SELL" quantity="-40" tradePrice="210" ibCommission="-1.25" ibCommissionCurrency="USD" levelOfDetail="EXECUTION" />
        <Trade accountId="U1234567" assetCategory="CASH" symbol="EUR.USD" description="EUR.USD" conid="12087792" currency="USD" tradeID="1003" tradeDate="20260110" buySell="BUY" quantity="1000" tradePrice="1.03" levelOfDetail="EXECUTION" />
        <Trade accountId="U1234567" assetCategory="OPT" symbol="AAPL  260619C00200000" description="AAPL 19JUN26 200 C" conid="7000001" currency="USD" tradeID="1004" tradeDate="20260115" buySell="BUY" quantity="1" tradePrice="12.5" levelOfDetail="EXECUTION" />
      </Trades>
      <CashTransactions>
        <CashTransaction accountId="U1234567" type="Dividends" symbol="AAPL" description="AAPL(US0378331005) CASH DIVIDEND USD 0.25 PER SHARE" conid="265598" isin="US0378331005" currency="USD" amount="25" dateTime="20260510" transactionID="9101" levelOfDetail="DETAIL" />
        <CashTransaction accountId="U1234567" type="Withholding Tax" symbol="AAPL" description="AAPL(US0378331005) CASH DIVIDEND - US TAX" conid="265598" isin="US0378331005" currency="USD" amount="-3.75" dateTime="20260510" transactionID="9102" levelOfDetail="DETAIL" />
        <CashTransaction accountId="U1234567" type="Broker Interest Received" description="USD CREDIT INT FOR MAY-2026" currency="USD" amount="1.23" dateTime="20260603" transactionID="9103" levelOfDetail="DETAIL" />
        <CashTransaction accountId="U1234567" type="Other Fees" description="SNAPSHOT MARKET DATA FEE" currency="USD" amount="-1.5" dateTime="20260601" transactionID="9104" levelOfDetail="DETAIL" />
        <CashTransaction accountId="U1234567" type="Deposits/Withdrawals" description="CASH RECEIPT" currency="CZK" amount="100000" dateTime="20240605" transactionID="9105" levelOfDetail="DETAIL" />
        <CashTransaction accountId="U1234567" type="Deposits/Withdrawals" description="DISBURSEMENT" currency="CZK" amount="-20000" dateTime="20260620" transactionID="9106" levelOfDetail="DETAIL" />
        <CashTransaction accountId="U1234567" type="Dividends" symbol="AAPL" description="SUMMARY ROW" currency="USD" amount="25" dateTime="20260510" levelOfDetail="SUMMARY" />
      </CashTransactions>
      <CorporateActions>
        <CorporateAction accountId="U1234567" assetCategory="STK" symbol="AAPL" description="APPLE INC" conid="265598" isin="US0378331005" currency="USD" type="FS" dateTime="20240831;202500" reportDate="20240831" actionDescription="AAPL(US0378331005) SPLIT 4 FOR 1 (AAPL, APPLE INC, US0378331005)" quantity="300" actionID="501" transactionID="9201" levelOfDetail="DETAIL" />
        <CorporateAction accountId="U1234567" assetCategory="STK" symbol="XYZ" description="XYZ CORP" conid="111111" isin="US1111111111" currency="USD" type="RS" dateTime="20250215;202500" reportDate="20250215" actionDescription="XYZ(US1111111111) SPLIT 1 FOR 10 (XYZ, XYZ CORP, US1111111111)" quantity="-90" actionID="502" transactionID="9202" levelOfDetail="DETAIL" />
        <CorporateAction accountId="U1234567" assetCategory="STK" symbol="OLDCO" description="OLDCO PLC" conid="222222" isin="GB0002222222" currency="GBP" type="IC" dateTime="20250401;202500" reportDate="20250401" actionDescription="OLDCO(GB0002222222) CUSIP/ISIN CHANGE TO (GB0003333333) (NEWCO, NEWCO PLC, GB0003333333)" quantity="-50" actionID="503" transactionID="9203" levelOfDetail="DETAIL" />
        <CorporateAction accountId="U1234567" assetCategory="STK" symbol="NEWCO" description="NEWCO PLC" conid="333333" isin="GB0003333333" currency="GBP" type="IC" dateTime="20250401;202500" reportDate="20250401" actionDescription="OLDCO(GB0002222222) CUSIP/ISIN CHANGE TO (GB0003333333) (NEWCO, NEWCO PLC, GB0003333333)" quantity="50" actionID="503" transactionID="9204" levelOfDetail="DETAIL" />
        <CorporateAction accountId="U1234567" assetCategory="STK" symbol="TGT" description="TARGET CO" conid="444444" isin="US4444444444" currency="USD" type="TC" dateTime="20250910;202500" reportDate="20250910" actionDescription="TGT(US4444444444) MERGED(Acquisition) WITH ACQ(US5555555555) 1 FOR 2 (ACQ, ACQUIRER INC, US5555555555)" quantity="-30" actionID="504" transactionID="9205" levelOfDetail="DETAIL" />
        <CorporateAction accountId="U1234567" assetCategory="STK" symbol="ACQ" description="ACQUIRER INC" conid="555555" isin="US5555555555" currency="USD" type="TC" dateTime="20250910;202500" reportDate="20250910" actionDescription="TGT(US4444444444) MERGED(Acquisition) WITH ACQ(US5555555555) 1 FOR 2 (ACQ, ACQUIRER INC, US5555555555)" quantity="15" actionID="504" transactionID="9206" levelOfDetail="DETAIL" />
        <CorporateAction accountId="U1234567" assetCategory="STK" symbol="CASHCO" description="CASHCO INC" conid="666666" isin="US6666666666" currency="USD" type="TC" dateTime="20251120;202500" reportDate="20251120" actionDescription="CASHCO(US6666666666) MERGED(Acquisition) FOR USD 12.00 PER SHARE (CASHCO, CASHCO INC, US6666666666)" quantity="-20" proceeds="240" value="240" actionID="505" transactionID="9207" levelOfDetail="DETAIL" />
        <CorporateAction accountId="U1234567" assetCategory="STK" symbol="CHILD" description="CHILD SPINCO" conid="777777" isin="US7777777777" currency="USD" type="SO" dateTime="20260220;202500" reportDate="20260220" actionDescription="PARENT(US0378331005) SPINOFF  1 FOR 4 (CHILD, CHILD SPINCO, US7777777777)" quantity="25" actionID="506" transactionID="9208" levelOfDetail="DETAIL" />
        <CorporateAction accountId="U1234567" assetCategory="STK" symbol="RGTS" description="RIGHTS ISSUE" conid="888888" isin="US8888888888" currency="USD" type="RI" dateTime="20260301;202500" reportDate="20260301" actionDescription="RGTS(US8888888888) SUBSCRIBABLE RIGHTS ISSUE" quantity="10" actionID="507" transactionID="9209" levelOfDetail="DETAIL" />
      </CorporateActions>
      <Transfers>
        <Transfer accountId="U1234567" assetCategory="STK" symbol="MSFT" description="MICROSOFT CORP" conid="272093" isin="US5949181045" currency="USD" date="20250505" type="ACATS" direction="IN" quantity="10" transactionID="9301" levelOfDetail="DETAIL" />
        <Transfer accountId="U1234567" assetCategory="STK" symbol="AAPL" description="APPLE INC" conid="265598" isin="US0378331005" currency="USD" date="20260415" type="ACATS" direction="OUT" quantity="-20" transactionID="9302" levelOfDetail="DETAIL" />
      </Transfers>
      <OpenPositions>
        <OpenPosition accountId="U1234567" assetCategory="STK" symbol="AAPL" conid="265598" isin="US0378331005" position="340" levelOfDetail="SUMMARY" />
        <OpenPosition accountId="U1234567" assetCategory="STK" symbol="MSFT" conid="272093" isin="US5949181045" position="10" levelOfDetail="SUMMARY" />
        <OpenPosition accountId="U1234567" assetCategory="STK" symbol="AAPL" conid="265598" isin="US0378331005" position="100" levelOfDetail="LOT" />
      </OpenPositions>
    </FlexStatement>
  </FlexStatements>
</FlexQueryResponse>`;

/** Chybová odpověď Flex Web Service (token/query problém). */
export const IBKR_ERROR_RESPONSE = `<?xml version="1.0" encoding="UTF-8"?>
<FlexStatementResponse timestamp="07 July, 2026 12:00 PM EDT">
  <Status>Warn</Status>
  <ErrorCode>1019</ErrorCode>
  <ErrorMessage>Statement generation in progress. Please try again shortly.</ErrorMessage>
</FlexStatementResponse>`;
