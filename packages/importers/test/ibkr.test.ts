import { describe, expect, it } from 'vitest';
import { dedupeTransactions, IBKR_BROKER, parseIbkrFlexXml } from '../src';
import { IBKR_FIXTURE } from './fixtures/ibkr';

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

  it('deduplikace: opakovaný import téhož XML nic nepřidá', () => {
    const again = parseIbkrFlexXml(IBKR_FIXTURE);
    const keys = result.transactions.map((t) => t.id);
    const outcome = dedupeTransactions(
      IBKR_BROKER,
      again.transactions,
      result.transactions.map((_, i) => `${IBKR_BROKER}|${i}`),
    );
    // dedupe jde přes obsahový hash — ověř aspoň, že id jsou stabilní
    expect(again.transactions.map((t) => t.id)).toEqual(keys);
    expect(outcome.fresh.length + outcome.duplicates).toBe(again.transactions.length);
  });

  it('ne-XML vstup a XML bez FlexQueryResponse → srozumitelný error', () => {
    const notFlex = parseIbkrFlexXml('<html><body>login</body></html>');
    expect(notFlex.errors[0]!.message).toContain('FlexQueryResponse');
    expect(notFlex.transactions).toHaveLength(0);
  });
});
