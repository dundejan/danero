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

  it('čísla „1.234,56“ (tisícová tečka + desetinná čárka)', () => {
    const result = parseDegiroTransactionsCsv(DEGIRO_TRANSACTIONS_CZ);
    const vwrl = result.transactions[3]!;
    if (vwrl.type !== 'BUY') throw new Error('unreachable');
    expect(vwrl.pricePerShare.toString()).toBe('1234.56');
    expect(vwrl.currency).toBe('EUR');
    expect(vwrl.fee?.amount.toString()).toBe('1');
  });

  it('EN hlavičky + čárkový oddělovač + čísla „1,855.00“ v uvozovkách', () => {
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
    // 3 přeskočené řádky (obchod, FX, sweep) + avízo dividendy s prázdnou
    // částkou, které dřív mizelo úplně beze stopy (B-3-6)
    expect(result.skipped).toHaveLength(4);
    expect(result.skipped.some((s) => s.message.includes('Transactions.csv'))).toBe(true);
    expect(result.skipped.some((s) => s.message.includes('nemá vyplněnou částku'))).toBe(true);

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
    // řádek „Dividenda“ s prázdnou Změnou nesmí vytvořit záznam
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
    expect(deposit.amount.toString()).toBe('1000'); // „1.000,00“ v uvozovkách

    // „Terugstorting“ obsahuje „storting“ — musí být výběr, ne vklad
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

  // B-1: řádek s nerozpoznaným popisem a BEZ peněžního pohybu mizel úplně beze
  // stopy (žádná transakce, chyba, skipped ani varování) — a přesně tak Degiro
  // reportuje korporátní akce
  it('neznámý popis BEZ peněžního pohybu → error, ne tiché zahození', () => {
    const csv = [
      DEGIRO_ACCOUNT_HEADER_CZ,
      '05-05-2024;10:00;05-05-2024;OLD CORP;US1111111117;Kapitálová restrukturalizace: Odpis 10 ks;;;;EUR;0,00;',
    ].join('\n');
    const result = parseDegiroAccountCsv(csv);
    expect(result.transactions).toEqual([]);
    expect(result.skipped).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toContain('Kapitálová restrukturalizace');
    expect(result.errors[0]!.message).toContain('nahlaš');
  });

  it('rozpoznaný popis bez peněžního pohybu (avízo dividendy) se přeskočí, ale zůstane po něm stopa (B-3-6)', () => {
    const csv = [
      DEGIRO_ACCOUNT_HEADER_CZ,
      '04-06-2024;09:00;04-06-2024;;;Dividenda;;;;EUR;7877,12;',
    ].join('\n');
    const result = parseDegiroAccountCsv(csv);
    expect(result.transactions).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    // dřív řádek zmizel úplně — ani transakce, ani chyba, ani přeskočení,
    // takže se nedal dohledat a import hlásil „0 chyb, 0 přeskočeno“
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]!.line).toBe(2);
    expect(result.skipped[0]!.message).toContain('Dividenda');
  });

  // B-1b: splity, reverse splity a spin-offy Degiro reportuje textem — parser
  // je musel poznat ve všech lokalizacích, které docs/03 slibuje (CZ/EN/NL/DE/FR)
  it.each([
    ['NL', 'AANDELENSPLITSING: Uitboeking 10 aandelen', 'AANDELENSPLITSING: Inboeking 40 aandelen'],
    ['EN', 'STOCK SPLIT: Removal 10 shares', 'STOCK SPLIT: Addition 40 shares'],
    ['CZ', 'Štěpení akcií: Odpis 10 ks', 'Štěpení akcií: Připis 40 ks'],
    ['CZ (rozdělení)', 'Rozdělení akcií: Odpis 10 ks', 'Rozdělení akcií: Připis 40 ks'],
    ['DE', 'Aktiensplit: Ausbuchung 10 Stück', 'Aktiensplit: Einbuchung 40 Stück'],
    ["FR", "Division d'actions: Sortie 10 titres", "Division d'actions: Entrée 40 titres"],
  ])('split %s → CORPORATE_ACTION SPLIT s poměrem 10:40', (_label, out, into) => {
    const csv = [
      DEGIRO_ACCOUNT_HEADER_CZ,
      `20-05-2024;12:00;20-05-2024;APPLE INC;US0378331005;${out};;;;EUR;0,00;`,
      `20-05-2024;12:00;20-05-2024;APPLE INC;US0378331005;${into};;;;EUR;0,00;`,
    ].join('\n');
    const result = parseDegiroAccountCsv(csv);
    expect(result.errors).toEqual([]);
    expect(result.transactions).toHaveLength(1);
    const action = result.transactions[0]!;
    if (action.type !== 'CORPORATE_ACTION') throw new Error('unreachable');
    expect(action.subtype).toBe('SPLIT');
    expect(action.isin).toBe('US0378331005');
    expect(action.ratio?.from.toString()).toBe('10');
    expect(action.ratio?.to.toString()).toBe('40');
  });

  it('reverse split (40 → 10) je týž SPLIT s obráceným poměrem', () => {
    const csv = [
      DEGIRO_ACCOUNT_HEADER_CZ,
      '20-05-2024;12:00;20-05-2024;APPLE INC;US0378331005;REVERSE SPLIT: Removal 40 shares;;;;EUR;0,00;',
      '20-05-2024;12:00;20-05-2024;APPLE INC;US0378331005;REVERSE SPLIT: Addition 10 shares;;;;EUR;0,00;',
    ].join('\n');
    const result = parseDegiroAccountCsv(csv);
    expect(result.errors).toEqual([]);
    const action = result.transactions[0]!;
    if (action.type !== 'CORPORATE_ACTION') throw new Error('unreachable');
    expect(action.subtype).toBe('SPLIT');
    expect(action.ratio?.from.toString()).toBe('40');
    expect(action.ratio?.to.toString()).toBe('10');
  });

  it('split bez počtů kusů v popisu → error (bez poměru je split nepoužitelný)', () => {
    const csv = [
      DEGIRO_ACCOUNT_HEADER_CZ,
      '20-05-2024;12:00;20-05-2024;APPLE INC;US0378331005;Aandelensplitsing: Uitboeking;;;;EUR;0,00;',
      '20-05-2024;12:00;20-05-2024;APPLE INC;US0378331005;Aandelensplitsing: Inboeking;;;;EUR;0,00;',
    ].join('\n');
    const result = parseDegiroAccountCsv(csv);
    expect(result.transactions).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toContain('poměr');
  });

  it.each([
    ['EN', 'SPIN-OFF: Addition 5 shares NEW CORP'],
    ['NL', 'Afsplitsing: Inboeking 5 aandelen NEW CORP'],
    ['DE', 'Abspaltung: Einbuchung 5 Stück NEW CORP'],
    ['FR', 'Scission: Entrée 5 titres NEW CORP'],
  ])('spin-off %s → error s výzvou doplnit ručně (alokaci ceny z výpisu nevyčteme)', (_l, text) => {
    const csv = [
      DEGIRO_ACCOUNT_HEADER_CZ,
      `20-05-2024;12:00;20-05-2024;NEW CORP;US2222222226;${text};;;;EUR;0,00;`,
    ].join('\n');
    const result = parseDegiroAccountCsv(csv);
    expect(result.transactions).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toContain('Spin-off');
    expect(result.errors[0]!.message).toContain('univerzální šablonu');
  });

  it.each([
    ['DE fúze', 'Verschmelzung: Ausbuchung 10 Stück', 'Verschmelzung: Einbuchung 5 Stück'],
    ['FR fúze', 'Fusion: Sortie 10 titres', 'Fusion: Entrée 5 titres'],
  ])('%s → CORPORATE_ACTION MERGER s poměrem 10:5', (_label, out, into) => {
    const csv = [
      DEGIRO_ACCOUNT_HEADER_CZ,
      `10-02-2024;12:00;10-02-2024;OLD CORP;US1111111117;${out};;;;EUR;0,00;`,
      `10-02-2024;12:00;10-02-2024;NEW CORP;US2222222226;${into};;;;EUR;0,00;`,
    ].join('\n');
    const result = parseDegiroAccountCsv(csv);
    expect(result.errors).toEqual([]);
    const action = result.transactions[0]!;
    if (action.type !== 'CORPORATE_ACTION') throw new Error('unreachable');
    expect(action.subtype).toBe('MERGER');
    expect(action.newIsin).toBe('US2222222226');
    expect(action.ratio?.from.toString()).toBe('10');
    expect(action.ratio?.to.toString()).toBe('5');
  });

  it('FR změna ISIN → CORPORATE_ACTION ISIN_CHANGE', () => {
    const csv = [
      DEGIRO_ACCOUNT_HEADER_CZ,
      "20-05-2024;12:00;20-05-2024;VANGUARD;IE00B3RBWM25;Changement d'ISIN: Sortie 3 titres;;;;EUR;0,00;",
      "20-05-2024;12:00;20-05-2024;VANGUARD;IE00BK5BQT80;Changement d'ISIN: Entrée 3 titres;;;;EUR;0,00;",
    ].join('\n');
    const result = parseDegiroAccountCsv(csv);
    expect(result.errors).toEqual([]);
    const action = result.transactions[0]!;
    if (action.type !== 'CORPORATE_ACTION') throw new Error('unreachable');
    expect(action.subtype).toBe('ISIN_CHANGE');
    expect(action.newIsin).toBe('IE00BK5BQT80');
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

  it('univerzální šablona (type,date,…,isin,quantity,price) → null, ne „transactions“', () => {
    expect(isDegiroCsv(UNIVERSAL_TEMPLATE_CSV)).toBeNull();
  });
});

/**
 * Nálezy B4-0 a B4-2: klasifikace popisu v Account.csv rozhoduje podle TVARU
 * řádku, ne podle výskytu slova kdekoli v názvu titulu. Degiro reportuje
 * korporátní akce jako `PREFIX: <sloveso> <počet>`, kdežto echo obchodu má
 * sloveso na začátku.
 */
describe('Degiro Account.csv — echo obchodu vs. korporátní akce (B4-0, B4-2)', () => {
  // CZ formát Degira je STŘEDNÍKOVÝ (viz DEGIRO_ACCOUNT_HEADER_CZ); částka
  // a měna jsou dvojice „Změna“ + bezejmenný sloupec za ní
  const radek = (popis: string, zmena = '') =>
    [
      DEGIRO_ACCOUNT_HEADER_CZ,
      `02-10-2024;10:00;02-10-2024;Titul;US1111111117;${popis};;${zmena ? `EUR;${zmena}` : ';'};100;EUR;`,
    ].join('\n');

  it('titul s „Fusion“ nebo „Split“ v NÁZVU je obchod, ne korporátní akce', () => {
    // Fusion Fuel Green i Split Rock Partners jsou skutečné tituly. Dřív
    // skončily chybou „Fúze …“, která naváděla doplnit akci ručně — kdo
    // poslechl, rozbil si držení.
    for (const popis of [
      'Koop 100 Fusion Fuel Green@2,50 EUR (XEAM)',
      'Buy 10 Split Rock Partners@12,00 USD (XSPL)',
      'Verkoop 5 The Merger Fund@33,00 EUR',
    ]) {
      const result = parseDegiroAccountCsv(radek(popis, '-250,00'));
      expect(result.errors, popis).toEqual([]);
      expect(result.skipped, popis).toHaveLength(1);
    }
  });

  it('německé a francouzské echo obchodu se přeskočí, ne aby skončilo chybou', () => {
    // DE a FR slovesa ve slovníku chyběla úplně → chyba na KAŽDÉM obchodním
    // řádku německého i francouzského výpisu.
    for (const popis of ['Kauf 3 zu je 60,5 USD', 'Achat 11 ASML Holding@700,00 EUR']) {
      const result = parseDegiroAccountCsv(radek(popis, '-181,50'));
      expect(result.errors, popis).toEqual([]);
      expect(result.skipped, popis).toHaveLength(1);
    }
  });

  it('korporátní akce ve tvaru „PREFIX: sloveso počet“ se pořád pozná', () => {
    const result = parseDegiroAccountCsv(radek('AKTIENSPLIT: Kauf 40 NĚCO'));
    // sama o sobě je to jen jedna noha páru, takže chyba — ale rozpoznaná jako
    // štěpení, ne jako obchod
    expect(result.errors[0]!.message).toContain('Štěpení akcií');
    expect(result.skipped).toEqual([]);
  });

  it('řádek bez peněžního pohybu, který hýbe KUSY, nesmí zmizet beze stopy', () => {
    // „STOCK DIVIDEND: Verkoop 35“ se kvůli slovu „dividend“ klasifikuje jako
    // dividenda a bez částky mizel i s pohybem 35 kusů.
    const result = parseDegiroAccountCsv(radek('STOCK DIVIDEND: Verkoop 35 NĚCO'));
    expect(result.transactions).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toContain('kusy');
  });

  it('skutečné avízo dividendy (bez počtu kusů) se pořád jen přeskočí, chyba z něj není', () => {
    // kontrola opačným směrem, ať se z opravy nestane falešný poplach
    const result = parseDegiroAccountCsv(radek('Dividenda ABC Corp'));
    expect(result.errors).toEqual([]);
    expect(result.transactions).toEqual([]);
    expect(result.skipped).toHaveLength(1);
  });
});
