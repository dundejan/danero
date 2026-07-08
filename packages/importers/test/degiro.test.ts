import { describe, expect, it } from 'vitest';
import { dedupeTransactions, UNIVERSAL_TEMPLATE_CSV } from '../src';
import {
  DEGIRO_BROKER,
  isDegiroCsv,
  parseDegiroAccountCsv,
  parseDegiroTransactionsCsv,
} from '../src/degiro/csv';
import {
  DEGIRO_ACCOUNT_CZ,
  DEGIRO_ACCOUNT_HEADER_CZ,
  DEGIRO_ACCOUNT_NL,
  DEGIRO_TRANSACTIONS_CZ,
  DEGIRO_TRANSACTIONS_EN,
} from './fixtures/degiro';

describe('Degiro Transactions.csv', () => {
  it('CZ hlavičky + středník: BUY/SELL, desetinná čárka, dd-MM-yyyy → ISO', () => {
    const result = parseDegiroTransactionsCsv(DEGIRO_TRANSACTIONS_CZ);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.transactions).toHaveLength(4);

    const buy = result.transactions[0]!;
    if (buy.type !== 'BUY') throw new Error('unreachable');
    expect(buy.id).toBe('degiro-abc-123-def');
    expect(buy.isin).toBe('US0378331005');
    expect(buy.name).toBe('APPLE INC');
    expect(buy.quantity.toString()).toBe('10');
    expect(buy.pricePerShare.toString()).toBe('185.5');
    expect(buy.currency).toBe('USD');
    expect(buy.fee?.amount.toString()).toBe('2.5');
    expect(buy.fee?.currency).toBe('EUR');
    expect(buy.tradeDate).toBe('2024-01-10');
    expect(buy.settlementDate).toBeUndefined(); // dopočítá engine

    // záporný počet = SELL s kladným množstvím (směr nese type)
    const sell = result.transactions[1]!;
    if (sell.type !== 'SELL') throw new Error('unreachable');
    expect(sell.quantity.toString()).toBe('6');
    expect(sell.pricePerShare.toString()).toBe('210');
    expect(sell.tradeDate).toBe('2025-03-05');

    // druhý fill má prázdný poplatek
    const sell2 = result.transactions[2]!;
    if (sell2.type !== 'SELL') throw new Error('unreachable');
    expect(sell2.quantity.toString()).toBe('4');
    expect(sell2.fee).toBeUndefined();
  });

  it('partial fills sdílejí Order ID → stabilní odlišná id; prázdné ID → obsahový hash', () => {
    const result = parseDegiroTransactionsCsv(DEGIRO_TRANSACTIONS_CZ);
    const ids = result.transactions.map((t) => t.id);
    expect(ids[1]).toBe('degiro-ord-shared-1');
    expect(ids[2]).toBe('degiro-ord-shared-1-2');
    // řádek bez Order ID dostane fnv1a64 hash obsahu, nikdy pořadí v souboru
    expect(ids[3]).toMatch(/^degiro-[0-9a-f]{16}$/);
  });

  it('čísla „1.234,56" (tisícová tečka + desetinná čárka)', () => {
    const result = parseDegiroTransactionsCsv(DEGIRO_TRANSACTIONS_CZ);
    const vwrl = result.transactions[3]!;
    if (vwrl.type !== 'BUY') throw new Error('unreachable');
    expect(vwrl.pricePerShare.toString()).toBe('1234.56');
    expect(vwrl.currency).toBe('EUR');
    expect(vwrl.fee?.amount.toString()).toBe('1');
  });

  it('EN hlavičky + čárkový oddělovač + čísla „1,855.00" v uvozovkách', () => {
    const result = parseDegiroTransactionsCsv(DEGIRO_TRANSACTIONS_EN);
    expect(result.errors).toEqual([]);
    expect(result.transactions).toHaveLength(1);
    const buy = result.transactions[0]!;
    if (buy.type !== 'BUY') throw new Error('unreachable');
    expect(buy.id).toBe('degiro-en-order-1');
    expect(buy.quantity.toString()).toBe('10');
    expect(buy.pricePerShare.toString()).toBe('185.5');
    expect(buy.currency).toBe('USD');
    expect(buy.fee?.amount.toString()).toBe('2.5');
    expect(buy.tradeDate).toBe('2024-01-10');
  });

  it('opakovaný import téhož souboru je idempotentní (stabilní id → dedupe)', () => {
    const first = parseDegiroTransactionsCsv(DEGIRO_TRANSACTIONS_CZ).transactions;
    const second = parseDegiroTransactionsCsv(DEGIRO_TRANSACTIONS_CZ).transactions;
    const outcome = dedupeTransactions(DEGIRO_BROKER, [...first, ...second]);
    expect(outcome.fresh).toHaveLength(4);
    expect(outcome.duplicates).toBe(4);
  });

  it('cizí soubor → error s výpisem sloupců; prázdný soubor → error', () => {
    const foreign = parseDegiroTransactionsCsv('foo;bar\n1;2');
    expect(foreign.errors).toHaveLength(1);
    expect(foreign.errors[0]!.message).toContain('nevypadá jako Degiro Transactions.csv');

    const empty = parseDegiroTransactionsCsv('');
    expect(empty.errors).toHaveLength(1);
    expect(empty.errors[0]!.message).toContain('prázdný');
  });
});

describe('Degiro Account.csv', () => {
  it('CZ popisy: vklad, poplatek, úrok, výběr; obchody, FX a sweep přeskočené', () => {
    const result = parseDegiroAccountCsv(DEGIRO_ACCOUNT_CZ);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.transactions).toHaveLength(6);
    expect(result.skipped).toHaveLength(3);
    expect(result.skipped.some((s) => s.message.includes('Transactions.csv'))).toBe(true);

    const deposit = result.transactions.find((t) => t.type === 'DEPOSIT')!;
    if (deposit.type !== 'DEPOSIT') throw new Error('unreachable');
    expect(deposit.amount.toString()).toBe('10000');
    expect(deposit.currency).toBe('CZK');
    expect(deposit.date).toBe('2024-01-02');

    const fee = result.transactions.find((t) => t.type === 'FEE')!;
    if (fee.type !== 'FEE') throw new Error('unreachable');
    expect(fee.amount.toString()).toBe('2.5');
    expect(fee.note).toContain('Poplatek za připojení na burzu');

    const interest = result.transactions.find((t) => t.type === 'INTEREST')!;
    if (interest.type !== 'INTEREST') throw new Error('unreachable');
    expect(interest.amount.toString()).toBe('1.25');

    const withdrawal = result.transactions.find((t) => t.type === 'WITHDRAWAL')!;
    if (withdrawal.type !== 'WITHDRAWAL') throw new Error('unreachable');
    expect(withdrawal.amount.toString()).toBe('500');
  });

  it('dividenda + daň z dividendy se spárují (stejný ISIN a den); prázdná Změna bez záznamu', () => {
    const result = parseDegiroAccountCsv(DEGIRO_ACCOUNT_CZ);
    const dividendy = result.transactions.filter((t) => t.type === 'DIVIDEND');
    // řádek „Dividenda" s prázdnou Změnou nesmí vytvořit záznam
    expect(dividendy).toHaveLength(1);
    const dividend = dividendy[0]!;
    if (dividend.type !== 'DIVIDEND') throw new Error('unreachable');
    expect(dividend.isin).toBe('US0378331005');
    expect(dividend.gross.toString()).toBe('24');
    expect(dividend.withholdingTax.toString()).toBe('3.6');
    expect(dividend.currency).toBe('USD');
    expect(dividend.date).toBe('2024-03-15');
  });

  it('změna ISIN (párové řádky, víceřádkový popis v uvozovkách) → ISIN_CHANGE, nikdy prodej/nákup', () => {
    const result = parseDegiroAccountCsv(DEGIRO_ACCOUNT_CZ);
    // NIKDY neinterpretovat jako zdanitelný prodej/nákup
    expect(result.transactions.some((t) => t.type === 'BUY' || t.type === 'SELL')).toBe(false);

    const action = result.transactions.find((t) => t.type === 'CORPORATE_ACTION')!;
    if (action.type !== 'CORPORATE_ACTION') throw new Error('unreachable');
    expect(action.subtype).toBe('ISIN_CHANGE');
    expect(action.isin).toBe('IE00B3RBWM25');
    expect(action.newIsin).toBe('IE00BK5BQT80');
    expect(action.date).toBe('2024-05-20');
    // víceřádkový popis v uvozovkách prošel RFC4180 parserem vč. \n
    expect(action.note).toContain('\n');
  });

  it('NL popisy: storting/terugstorting/rente/dividendbelasting; koop a flatex přeskočené', () => {
    const result = parseDegiroAccountCsv(DEGIRO_ACCOUNT_NL);
    expect(result.errors).toEqual([]);
    expect(result.skipped).toHaveLength(2);

    const deposit = result.transactions.find((t) => t.type === 'DEPOSIT')!;
    if (deposit.type !== 'DEPOSIT') throw new Error('unreachable');
    expect(deposit.amount.toString()).toBe('1000'); // „1.000,00" v uvozovkách

    // „Terugstorting" obsahuje „storting" — musí být výběr, ne vklad
    const withdrawal = result.transactions.find((t) => t.type === 'WITHDRAWAL')!;
    if (withdrawal.type !== 'WITHDRAWAL') throw new Error('unreachable');
    expect(withdrawal.amount.toString()).toBe('200');

    // záporný úrok (Rente) → FEE s poznámkou
    const fee = result.transactions.find((t) => t.type === 'FEE')!;
    if (fee.type !== 'FEE') throw new Error('unreachable');
    expect(fee.amount.toString()).toBe('0.75');
    expect(fee.note).toContain('Záporný úrok');

    const dividend = result.transactions.find((t) => t.type === 'DIVIDEND')!;
    if (dividend.type !== 'DIVIDEND') throw new Error('unreachable');
    expect(dividend.gross.toString()).toBe('10');
    expect(dividend.withholdingTax.toString()).toBe('1.5');
  });

  it('FUSIE pár → MERGER s poměrem z počtů kusů v popisech', () => {
    const result = parseDegiroAccountCsv(DEGIRO_ACCOUNT_NL);
    const merger = result.transactions.find((t) => t.type === 'CORPORATE_ACTION')!;
    if (merger.type !== 'CORPORATE_ACTION') throw new Error('unreachable');
    expect(merger.subtype).toBe('MERGER');
    expect(merger.isin).toBe('US1111111117');
    expect(merger.newIsin).toBe('US2222222226');
    expect(merger.ratio?.from.toString()).toBe('10');
    expect(merger.ratio?.to.toString()).toBe('5');
    expect(result.transactions.some((t) => t.type === 'BUY' || t.type === 'SELL')).toBe(false);
  });

  it('fúze bez počtů kusů v popisech → MERGER bez poměru + warning', () => {
    const csv = [
      DEGIRO_ACCOUNT_HEADER_CZ,
      '10-02-2024;12:00;10-02-2024;OLD;US1111111117;Fúze: Odpis akcií OLD;;;;EUR;0,00;',
      '10-02-2024;12:00;10-02-2024;NEW;US2222222226;Fúze: Připis akcií NEW;;;;EUR;0,00;',
    ].join('\n');
    const result = parseDegiroAccountCsv(csv);
    expect(result.errors).toEqual([]);
    const merger = result.transactions[0]!;
    if (merger.type !== 'CORPORATE_ACTION') throw new Error('unreachable');
    expect(merger.subtype).toBe('MERGER');
    expect(merger.ratio).toBeUndefined();
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]!.message).toContain('poměr');
  });

  it('nespárovaná změna ISIN → error s výzvou doplnit ručně, žádná transakce', () => {
    const csv = [
      DEGIRO_ACCOUNT_HEADER_CZ,
      '20-05-2024;12:00;20-05-2024;VANGUARD;IE00B3RBWM25;Změna ISIN: Odpis 3 ks;;;;EUR;0,00;',
    ].join('\n');
    const result = parseDegiroAccountCsv(csv);
    expect(result.transactions).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.line).toBe(2);
    expect(result.errors[0]!.message).toContain('ručně');
  });

  it('zpětná kompatibilita: částka v pojmenovaném sloupci Změna a měna za ní (opačné pořadí)', () => {
    const csv = [
      DEGIRO_ACCOUNT_HEADER_CZ,
      '02-01-2024;10:00;02-01-2024;;;Vklad;;10000,00;CZK;10000,00;CZK;',
      '15-03-2024;09:12;15-03-2024;APPLE INC;US0378331005;Dividenda;;24,00;USD;24,00;USD;',
    ].join('\n');
    const result = parseDegiroAccountCsv(csv);
    expect(result.errors).toEqual([]);
    expect(result.transactions).toHaveLength(2);
    const deposit = result.transactions.find((t) => t.type === 'DEPOSIT')!;
    if (deposit.type !== 'DEPOSIT') throw new Error('unreachable');
    expect(deposit.amount.toString()).toBe('10000');
    expect(deposit.currency).toBe('CZK');
    const dividend = result.transactions.find((t) => t.type === 'DIVIDEND')!;
    if (dividend.type !== 'DIVIDEND') throw new Error('unreachable');
    expect(dividend.gross.toString()).toBe('24');
    expect(dividend.currency).toBe('USD');
  });

  it('neprázdná, ale nečitelná dvojice částka/měna → error s citací hodnot', () => {
    const csv = [
      DEGIRO_ACCOUNT_HEADER_CZ,
      '02-01-2024;10:00;02-01-2024;;;Vklad;;N/A;EUR;10000,00;CZK;',
    ].join('\n');
    const result = parseDegiroAccountCsv(csv);
    expect(result.transactions).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toContain('N/A');
    expect(result.errors[0]!.message).toContain('nepodařilo přečíst');
  });

  it('nesmyslné kalendářní datum (31-13-2025) → error, řádek se nezpracuje', () => {
    const csv = [
      DEGIRO_ACCOUNT_HEADER_CZ,
      '31-13-2025;10:00;31-13-2025;;;Vklad;;CZK;10000,00;CZK;10000,00;',
    ].join('\n');
    const result = parseDegiroAccountCsv(csv);
    expect(result.transactions).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toContain('Neplatné datum');
  });

  it('2+ odpisů nebo připisů v týž den → žádné párování pořadím, error s výzvou doplnit ručně', () => {
    const csv = [
      DEGIRO_ACCOUNT_HEADER_CZ,
      '10-02-2024;12:00;10-02-2024;OLD A;US1111111117;Fúze: Odpis 10 ks OLD A;;;;EUR;0,00;',
      '10-02-2024;12:00;10-02-2024;OLD B;US3333333334;Fúze: Odpis 4 ks OLD B;;;;EUR;0,00;',
      '10-02-2024;12:00;10-02-2024;NEW A;US2222222226;Fúze: Připis 5 ks NEW A;;;;EUR;0,00;',
      '10-02-2024;12:00;10-02-2024;NEW B;US4444444442;Fúze: Připis 2 ks NEW B;;;;EUR;0,00;',
    ].join('\n');
    const result = parseDegiroAccountCsv(csv);
    expect(result.transactions).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toContain('2× odpis');
    expect(result.errors[0]!.message).toContain('2× připis');
    expect(result.errors[0]!.message).toContain('univerzální šablonu');
  });

  it('nespárovaná daň z dividendy → warning, nezaúčtuje se', () => {
    const csv = [
      DEGIRO_ACCOUNT_HEADER_CZ,
      '15-03-2024;09:12;15-03-2024;APPLE INC;US0378331005;Daň z dividendy;;USD;-3,60;USD;20,40;',
    ].join('\n');
    const result = parseDegiroAccountCsv(csv);
    expect(result.transactions).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]!.message).toContain('párovou dividendu');
  });

  it('neznámý popis → error s citací popisu a výzvou nahlásit', () => {
    const csv = [
      DEGIRO_ACCOUNT_HEADER_CZ,
      '05-05-2024;10:00;05-05-2024;;;Převod bonusových jednotek;;EUR;1,00;EUR;1,00;',
    ].join('\n');
    const result = parseDegiroAccountCsv(csv);
    expect(result.transactions).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toContain('Převod bonusových jednotek');
    expect(result.errors[0]!.message).toContain('nahlaš');
  });

  it('idempotentní obsahová id (Account.csv nemá ID řádku)', () => {
    const first = parseDegiroAccountCsv(DEGIRO_ACCOUNT_CZ).transactions;
    const second = parseDegiroAccountCsv(DEGIRO_ACCOUNT_CZ).transactions;
    expect(first.map((t) => t.id)).toEqual(second.map((t) => t.id));
    const outcome = dedupeTransactions(DEGIRO_BROKER, [...first, ...second]);
    expect(outcome.fresh).toHaveLength(6);
    expect(outcome.duplicates).toBe(6);
  });

  it('cizí soubor → error; prázdný soubor → error', () => {
    const foreign = parseDegiroAccountCsv('foo,bar\n1,2');
    expect(foreign.errors[0]!.message).toContain('nevypadá jako Degiro Account.csv');

    const empty = parseDegiroAccountCsv('\n\n');
    expect(empty.errors).toHaveLength(1);
    expect(empty.errors[0]!.message).toContain('prázdný');
  });
});

describe('isDegiroCsv (autodetekce)', () => {
  it('rozliší Transactions.csv a Account.csv v obou lokalizacích oddělovače', () => {
    expect(isDegiroCsv(DEGIRO_TRANSACTIONS_CZ)).toBe('transactions');
    expect(isDegiroCsv(DEGIRO_TRANSACTIONS_EN)).toBe('transactions');
    expect(isDegiroCsv(DEGIRO_ACCOUNT_CZ)).toBe('account');
    expect(isDegiroCsv(DEGIRO_ACCOUNT_NL)).toBe('account');
  });

  it('cizí soubory a prázdný vstup → null', () => {
    expect(isDegiroCsv('')).toBeNull();
    expect(isDegiroCsv('foo;bar\n1;2')).toBeNull();
    // T212 export nemá sloupce Datum/Date ani Produkt → nesmí se chytit
    const t212 =
      'Action,Time,ISIN,Ticker,Name,No. of shares,Price / share,Currency (Price / share),Total\nMarket buy,2024-01-10 14:30:02,US0378331005,AAPL,Apple,10,185.50,USD,1855.00';
    expect(isDegiroCsv(t212)).toBeNull();
  });

  it('univerzální šablona (type,date,…,isin,quantity,price) → null, ne „transactions"', () => {
    expect(isDegiroCsv(UNIVERSAL_TEMPLATE_CSV)).toBeNull();
  });
});
