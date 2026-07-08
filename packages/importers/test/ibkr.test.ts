import { describe, expect, it } from 'vitest';
import { dedupeKey, dedupeTransactions, IBKR_BROKER, parseIbkrFlexXml } from '../src';
import { IBKR_FIXTURE } from './fixtures/ibkr';

/** Minimální validní Flex obálka pro cílené testy jednotlivých sekcí. */
const wrapStatement = (inner: string): string => `<?xml version="1.0" encoding="UTF-8"?>
<FlexQueryResponse queryName="danero" type="AF">
  <FlexStatements count="1">
    <FlexStatement accountId="U1234567" fromDate="20240101" toDate="20261231">
      ${inner}
    </FlexStatement>
  </FlexStatements>
</FlexQueryResponse>`;

describe('IBKR Flex XML parser', () => {
  const result = parseIbkrFlexXml(IBKR_FIXTURE);

  it('projde fixture bez chyb kromě vědomě nepodporovaných akcí', () => {
    // jediný error: rights issue (RI) — nepodporovaný typ korporátní akce
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toContain('RI');
    expect(result.broker).toBe(IBKR_BROKER);
    expect(result.accountIds).toEqual(['U1234567']);
  });

  it('obchody: BUY/SELL s poplatkem, forex a opce přeskočené', () => {
    const buy = result.transactions.find((t) => t.type === 'BUY' && t.id === 'ibkr-1001');
    if (!buy || buy.type !== 'BUY') throw new Error('unreachable');
    expect(buy.isin).toBe('US0378331005');
    expect(buy.quantity.toString()).toBe('100');
    expect(buy.pricePerShare.toString()).toBe('185.5');
    expect(buy.fee?.amount.toString()).toBe('1');
    expect(buy.tradeDate).toBe('2024-06-10');
    expect(buy.settlementDate).toBe('2024-06-11');
    expect(buy.account).toBe('U1234567');

    const sell = result.transactions.find((t) => t.type === 'SELL' && t.id === 'ibkr-1002');
    if (!sell || sell.type !== 'SELL') throw new Error('unreachable');
    // záporné množství z IBKR → kladné (směr nese type)
    expect(sell.quantity.toString()).toBe('40');
    expect(sell.fee?.amount.toString()).toBe('1.25');

    // forex (CASH) a opce (OPT) = vědomé přeskočení, ne chyba
    expect(result.skipped.some((s) => s.message.includes('Měnová konverze'))).toBe(true);
    expect(result.skipped.some((s) => s.message.includes('Derivát'))).toBe(true);
  });

  it('dividenda se spáruje se samostatným řádkem srážkové daně', () => {
    const dividend = result.transactions.find((t) => t.type === 'DIVIDEND');
    if (!dividend || dividend.type !== 'DIVIDEND') throw new Error('unreachable');
    expect(dividend.isin).toBe('US0378331005');
    expect(dividend.gross.toString()).toBe('25');
    expect(dividend.withholdingTax.toString()).toBe('3.75');
    expect(dividend.currency).toBe('USD');
    expect(dividend.date).toBe('2026-05-10');
    // SUMMARY řádek dividendy se nesmí zdvojit
    expect(result.transactions.filter((t) => t.type === 'DIVIDEND')).toHaveLength(1);
  });

  it('úrok, poplatek, vklad a výběr', () => {
    const interest = result.transactions.find((t) => t.type === 'INTEREST');
    if (!interest || interest.type !== 'INTEREST') throw new Error('unreachable');
    expect(interest.amount.toString()).toBe('1.23');

    const fee = result.transactions.find((t) => t.type === 'FEE' && t.id === 'ibkr-9104');
    if (!fee || fee.type !== 'FEE') throw new Error('unreachable');
    expect(fee.amount.toString()).toBe('1.5');

    const deposit = result.transactions.find((t) => t.type === 'DEPOSIT');
    if (!deposit || deposit.type !== 'DEPOSIT') throw new Error('unreachable');
    expect(deposit.amount.toString()).toBe('100000');
    expect(deposit.currency).toBe('CZK');

    const withdrawal = result.transactions.find((t) => t.type === 'WITHDRAWAL');
    if (!withdrawal || withdrawal.type !== 'WITHDRAWAL') throw new Error('unreachable');
    expect(withdrawal.amount.toString()).toBe('20000');
  });

  it('split FS → SPLIT 1:4, reverse split RS → SPLIT 10:1', () => {
    const splits = result.transactions.filter(
      (t) => t.type === 'CORPORATE_ACTION' && t.subtype === 'SPLIT',
    );
    expect(splits).toHaveLength(2);
    const fs = splits.find((t) => 'isin' in t && t.isin === 'US0378331005');
    if (!fs || fs.type !== 'CORPORATE_ACTION') throw new Error('unreachable');
    // „SPLIT 4 FOR 1" = 4 nové za 1 starý
    expect(fs.ratio?.from.toString()).toBe('1');
    expect(fs.ratio?.to.toString()).toBe('4');
    expect(fs.date).toBe('2024-08-31');

    const rs = splits.find((t) => 'isin' in t && t.isin === 'US1111111111');
    if (!rs || rs.type !== 'CORPORATE_ACTION') throw new Error('unreachable');
    expect(rs.ratio?.from.toString()).toBe('10');
    expect(rs.ratio?.to.toString()).toBe('1');
  });

  it('IC pár → ISIN_CHANGE se starým a novým ISIN', () => {
    const change = result.transactions.find(
      (t) => t.type === 'CORPORATE_ACTION' && t.subtype === 'ISIN_CHANGE',
    );
    if (!change || change.type !== 'CORPORATE_ACTION') throw new Error('unreachable');
    expect(change.isin).toBe('GB0002222222');
    expect(change.newIsin).toBe('GB0003333333');
  });

  it('TC pár → MERGER s poměrem z množství, TC cash → SELL s varováním', () => {
    const merger = result.transactions.find(
      (t) => t.type === 'CORPORATE_ACTION' && t.subtype === 'MERGER',
    );
    if (!merger || merger.type !== 'CORPORATE_ACTION') throw new Error('unreachable');
    expect(merger.isin).toBe('US4444444444');
    expect(merger.newIsin).toBe('US5555555555');
    expect(merger.ratio?.from.toString()).toBe('30');
    expect(merger.ratio?.to.toString()).toBe('15');

    const cashOut = result.transactions.find(
      (t) => t.type === 'SELL' && t.isin === 'US6666666666',
    );
    if (!cashOut || cashOut.type !== 'SELL') throw new Error('unreachable');
    expect(cashOut.quantity.toString()).toBe('20');
    expect(cashOut.pricePerShare.toString()).toBe('12');
    expect(result.warnings.some((w) => w.message.includes('Fúze za hotovost'))).toBe(true);
  });

  it('SO → SPINOFF s mateřským ISIN z popisu a poměrem', () => {
    const spinoff = result.transactions.find(
      (t) => t.type === 'CORPORATE_ACTION' && t.subtype === 'SPINOFF',
    );
    if (!spinoff || spinoff.type !== 'CORPORATE_ACTION') throw new Error('unreachable');
    expect(spinoff.isin).toBe('US0378331005'); // matka
    expect(spinoff.newIsin).toBe('US7777777777'); // dcera
    expect(spinoff.ratio?.from.toString()).toBe('4');
    expect(spinoff.ratio?.to.toString()).toBe('1');
  });

  it('transfery: IN s varováním o nabývací ceně (R-04i), OUT bez', () => {
    const transferIn = result.transactions.find((t) => t.type === 'TRANSFER_IN');
    if (!transferIn || transferIn.type !== 'TRANSFER_IN') throw new Error('unreachable');
    expect(transferIn.isin).toBe('US5949181045');
    expect(transferIn.quantity.toString()).toBe('10');
    expect(transferIn.acquisition).toBeUndefined();
    expect(result.warnings.some((w) => w.message.includes('R-04i'))).toBe(true);

    const transferOut = result.transactions.find((t) => t.type === 'TRANSFER_OUT');
    if (!transferOut || transferOut.type !== 'TRANSFER_OUT') throw new Error('unreachable');
    expect(transferOut.quantity.toString()).toBe('20');
  });

  it('open positions pro rekonciliaci (LOT úroveň se nezdvojí)', () => {
    expect(result.openPositions).toEqual([
      { isin: 'US0378331005', quantity: '340' },
      { isin: 'US5949181045', quantity: '10' },
    ]);
  });

  it('deduplikace: opakovaný import téhož XML nepřidá nic nového', () => {
    const again = parseIbkrFlexXml(IBKR_FIXTURE);
    const existingKeys = result.transactions.map((tx) => dedupeKey(IBKR_BROKER, tx));
    const outcome = dedupeTransactions(IBKR_BROKER, again.transactions, existingKeys);
    expect(outcome.fresh).toHaveLength(0);
    expect(outcome.duplicates).toBe(result.transactions.length);
  });

  it('id bez transactionID jsou stabilní vůči obsahu, ne pořadí v souboru', () => {
    const deposit = wrapStatement(`<CashTransactions>
      <CashTransaction type="Deposits/Withdrawals" description="CASH RECEIPT" currency="CZK" amount="100000" dateTime="20240605" levelOfDetail="DETAIL" />
    </CashTransactions>`);
    // tentýž vklad, ale v souboru s dalšími záznamy PŘED ním (posun pořadí)
    const depositShifted = wrapStatement(`<CashTransactions>
      <CashTransaction type="Broker Interest Received" description="INT" currency="USD" amount="1" dateTime="20240101" levelOfDetail="DETAIL" />
      <CashTransaction type="Deposits/Withdrawals" description="CASH RECEIPT" currency="CZK" amount="100000" dateTime="20240605" levelOfDetail="DETAIL" />
    </CashTransactions>`);
    const a = parseIbkrFlexXml(deposit).transactions.find((t) => t.type === 'DEPOSIT');
    const b = parseIbkrFlexXml(depositShifted).transactions.find((t) => t.type === 'DEPOSIT');
    expect(a!.id).toBe(b!.id);
  });

  it('storno (Ca.) odstraní i původní exekuci; bez dohledatelného originálu je z něj error', () => {
    const cancelled = wrapStatement(`<Trades>
      <Trade assetCategory="STK" symbol="AAPL" isin="US0378331005" currency="USD" tradeID="2001" tradeDate="20260401" buySell="BUY" quantity="10" tradePrice="200" levelOfDetail="EXECUTION" />
      <Trade assetCategory="STK" symbol="AAPL" isin="US0378331005" currency="USD" tradeID="2002" origTradeID="2001" tradeDate="20260402" buySell="BUY (Ca.)" quantity="-10" tradePrice="200" levelOfDetail="EXECUTION" />
      <Trade assetCategory="STK" symbol="AAPL" isin="US0378331005" currency="USD" tradeID="2003" tradeDate="20260402" buySell="BUY" quantity="10" tradePrice="201" levelOfDetail="EXECUTION" />
    </Trades>`);
    const parsed = parseIbkrFlexXml(cancelled);
    expect(parsed.errors).toEqual([]);
    // zůstane jen opravný obchod 2003
    expect(parsed.transactions.map((t) => t.id)).toEqual(['ibkr-2003']);
    expect(parsed.warnings.some((w) => w.message.includes('Stornovaný obchod'))).toBe(true);

    const orphanCancel = wrapStatement(`<Trades>
      <Trade assetCategory="STK" symbol="AAPL" isin="US0378331005" currency="USD" tradeID="2002" origTradeID="1999" tradeDate="20260402" buySell="BUY (Ca.)" quantity="-10" tradePrice="200" levelOfDetail="EXECUTION" />
    </Trades>`);
    const orphan = parseIbkrFlexXml(orphanCancel);
    expect(orphan.errors.some((e) => e.message.includes('Storno'))).toBe(true);
  });

  it('více dividend v den: srážka pro-rata z celku; korekce → netto', () => {
    const proRata = wrapStatement(`<CashTransactions>
      <CashTransaction type="Dividends" symbol="AAPL" isin="US0378331005" currency="USD" amount="100" dateTime="20260510" transactionID="8101" levelOfDetail="DETAIL" />
      <CashTransaction type="Dividends" symbol="AAPL" isin="US0378331005" currency="USD" amount="100" dateTime="20260510" transactionID="8102" levelOfDetail="DETAIL" />
      <CashTransaction type="Dividends" symbol="AAPL" isin="US0378331005" currency="USD" amount="100" dateTime="20260510" transactionID="8103" levelOfDetail="DETAIL" />
      <CashTransaction type="Withholding Tax" symbol="AAPL" isin="US0378331005" currency="USD" amount="-30" dateTime="20260510" levelOfDetail="DETAIL" />
    </CashTransactions>`);
    const parsed = parseIbkrFlexXml(proRata);
    const dividends = parsed.transactions.filter((t) => t.type === 'DIVIDEND');
    expect(dividends).toHaveLength(3);
    for (const dividend of dividends) {
      if (dividend.type !== 'DIVIDEND') throw new Error('unreachable');
      expect(dividend.withholdingTax.toString()).toBe('10');
    }

    const corrected = wrapStatement(`<CashTransactions>
      <CashTransaction type="Dividends" symbol="AAPL" isin="US0378331005" currency="USD" amount="25" dateTime="20260510" transactionID="8201" levelOfDetail="DETAIL" />
      <CashTransaction type="Dividends" symbol="AAPL" isin="US0378331005" currency="USD" amount="-10" dateTime="20260510" transactionID="8202" levelOfDetail="DETAIL" />
      <CashTransaction type="Withholding Tax" symbol="AAPL" isin="US0378331005" currency="USD" amount="-2.25" dateTime="20260510" levelOfDetail="DETAIL" />
    </CashTransactions>`);
    const netted = parseIbkrFlexXml(corrected);
    const net = netted.transactions.find((t) => t.type === 'DIVIDEND');
    if (!net || net.type !== 'DIVIDEND') throw new Error('unreachable');
    expect(net.gross.toString()).toBe('15');
    expect(net.withholdingTax.toString()).toBe('2.25');
    expect(netted.warnings.some((w) => w.message.includes('korekční'))).toBe(true);
  });

  it('dluhopis: cena ze skutečného plnění (Proceeds), bez něj viditelný error', () => {
    const bond = wrapStatement(`<Trades>
      <Trade assetCategory="BOND" symbol="T 4.25 05/15/35" isin="US91282CJZ59" currency="USD" tradeID="3001" tradeDate="20260210" buySell="BUY" quantity="2000" tradePrice="99.472" proceeds="-1989.44" levelOfDetail="EXECUTION" />
      <Trade assetCategory="BOND" symbol="T 4.25 05/15/35" isin="US91282CJZ59" currency="USD" tradeID="3002" tradeDate="20260211" buySell="BUY" quantity="1000" tradePrice="99.5" levelOfDetail="EXECUTION" />
    </Trades>`);
    const parsed = parseIbkrFlexXml(bond);
    const buy = parsed.transactions.find((t) => t.type === 'BUY');
    if (!buy || buy.type !== 'BUY') throw new Error('unreachable');
    expect(buy.pricePerShare.toString()).toBe('0.99472');
    expect(buy.assetClass).toBe('BOND');
    expect(parsed.errors.some((e) => e.message.includes('Proceeds'))).toBe(true);
  });

  it('sekce jen se souhrny → srozumitelný error o konfiguraci Flex Query', () => {
    const summariesOnly = wrapStatement(`<Trades>
      <Trade assetCategory="STK" symbol="AAPL" isin="US0378331005" currency="USD" tradeDate="20260401" buySell="BUY" quantity="10" tradePrice="200" levelOfDetail="ORDER" />
    </Trades>
    <CashTransactions>
      <CashTransaction type="Dividends" symbol="AAPL" currency="USD" amount="25" dateTime="20260510" levelOfDetail="SUMMARY" />
    </CashTransactions>`);
    const parsed = parseIbkrFlexXml(summariesOnly);
    expect(parsed.transactions).toHaveLength(0);
    expect(parsed.errors.some((e) => e.message.includes('Executions'))).toBe(true);
    expect(parsed.errors.some((e) => e.message.includes('CashTransactions'))).toBe(true);
  });

  it('ne-XML vstup a XML bez FlexQueryResponse → srozumitelný error', () => {
    const notFlex = parseIbkrFlexXml('<html><body>login</body></html>');
    expect(notFlex.errors[0]!.message).toContain('FlexQueryResponse');
    expect(notFlex.transactions).toHaveLength(0);
  });
});
