import { describe, expect, it } from 'vitest';
import { parseIbkrFlexXml } from '@danero/importers';
import { d } from '@danero/shared';
import { createPgliteDb, type Db } from '@/db';
import { transactions, user } from '@/db/schema';
import { importParsed } from '@/lib/import-service';
import { loadTransactions } from '@/lib/portfolio';

/**
 * IBKR / Lynx: zpětné opravy a storna u napojeného účtu (audit 13. 10. 2026).
 * Komentáře u testů popisují vadu, kterou test hlídá — tedy chování před
 * opravou, kdy se uložený řádek nenahrazoval ani neodstraňoval
 * (`removeOutdatedRows` v `lib/import-service.ts`).
 *
 * Společný jmenovatel: napojený účet stahuje KAŽDÝ DEN výpis za posledních
 * 365 dní, takže tutéž událost vidí mnohokrát. IBKR ale události zpětně
 * opravuje — oprava nese PŮVODNÍ dateTime a pozdější reportDate, takže se
 * ve výpisu objeví až za dny či měsíce a parser pak tutéž dividendu složí
 * s jinými čísly. Dedupe je obsahový a IBKR není mezi brokery, u nichž se
 * porovnává i id (`TRANSACTION_ID_BROKERS`), takže se přepočítaná dividenda
 * uloží vedle té původní.
 *
 * Rozložení řádků je opsané ze skutečných výpisů zveřejněných v cizích
 * projektech; čísla, tituly, časy a čísla účtů jsou smyšlené.
 */

const statement = (toDate: string, inner: string): string => `<?xml version="1.0" encoding="UTF-8"?>
<FlexQueryResponse queryName="danero" type="AF">
  <FlexStatements count="1">
    <FlexStatement accountId="U7000001" fromDate="20260101" toDate="${toDate}" period="Last365CalendarDays" whenGenerated="${toDate};230000">
${inner}
    </FlexStatement>
  </FlexStatements>
</FlexQueryResponse>`;

async function freshDb(): Promise<Db> {
  const db = await createPgliteDb();
  await db.insert(user).values({ id: 'u1', name: 'Audit', email: 'audit-ibkr@priklad.test' });
  return db;
}

async function syncStatement(db: Db, day: string, xml: string) {
  return importParsed(db, 'u1', `ibkr-flex-${day}.xml`, parseIbkrFlexXml(xml), undefined, {
    newerThanStored: true,
  });
}

async function storedGross(db: Db, isin: string): Promise<{ count: number; gross: string }> {
  const dividends = (await loadTransactions(db, 'u1', 'ibkr')).filter(
    (tx) => tx.type === 'DIVIDEND' && tx.isin === isin,
  );
  const gross = dividends.reduce(
    (sum, tx) => (tx.type === 'DIVIDEND' ? sum.plus(tx.gross) : sum),
    d('0'),
  );
  return { count: dividends.length, gross: gross.toString() };
}

describe('IBKR: zpětná oprava u napojeného účtu nesmí událost zdvojit', () => {
  /**
   * Přeúčtování srážkové daně (typicky v únoru za loňský rok): vratka původní
   * srážky a nová, nižší — obojí s dateTime původní výplaty.
   *
   * Zdroj: titov-vv/jal tests/test_data/ibkr_dividends_year1.xml + year2.xml
   * (dividenda 5. 7. 2024, oprava s reportDate 4. 2. 2025 a dateTime 5. 7. 2024);
   * portfolio-performance testIBFlexStatementFile12.xml a 23.xml (kladná
   * „Withholding Tax“ s dateTime o rok starším, než je období výpisu).
   */
  it(
    'přeúčtovaná srážková daň neuloží tutéž dividendu podruhé',
    { timeout: 30_000 },
    async () => {
      const db = await freshDb();
      const original = `
        <CashTransaction accountId="U7000001" currency="USD" fxRateToBase="0.92" assetCategory="STK" symbol="RLTY" description="RLTY(US7561091049) CASH DIVIDEND USD 0.5 PER SHARE (Ordinary Dividend)" isin="US7561091049" dateTime="20260305;202000" settleDate="20260305" amount="50" type="Dividends" transactionID="940000001" reportDate="20260305" levelOfDetail="DETAIL" />
        <CashTransaction accountId="U7000001" currency="USD" fxRateToBase="0.92" assetCategory="STK" symbol="RLTY" description="RLTY(US7561091049) CASH DIVIDEND USD 0.5 PER SHARE - US TAX" isin="US7561091049" dateTime="20260305;202000" settleDate="20260305" amount="-7.5" type="Withholding Tax" transactionID="940000002" reportDate="20260305" levelOfDetail="DETAIL" />`;
      const correction = `
        <CashTransaction accountId="U7000001" currency="USD" fxRateToBase="0.92" assetCategory="STK" symbol="RLTY" description="RLTY(US7561091049) CASH DIVIDEND USD 0.5 PER SHARE - US TAX" isin="US7561091049" dateTime="20260305;202000" settleDate="20260305" amount="7.5" type="Withholding Tax" transactionID="940000101" reportDate="20260918" levelOfDetail="DETAIL" />
        <CashTransaction accountId="U7000001" currency="USD" fxRateToBase="0.92" assetCategory="STK" symbol="RLTY" description="RLTY(US7561091049) CASH DIVIDEND USD 0.5 PER SHARE - US TAX" isin="US7561091049" dateTime="20260305;202000" settleDate="20260305" amount="-2.5" type="Withholding Tax" transactionID="940000102" reportDate="20260918" levelOfDetail="DETAIL" />`;

      await syncStatement(
        db,
        '2026-03-06',
        statement('20260305', `<CashTransactions>${original}</CashTransactions>`),
      );
      expect(await storedGross(db, 'US7561091049')).toEqual({ count: 1, gross: '50' });

      await syncStatement(
        db,
        '2026-09-19',
        statement('20260918', `<CashTransactions>${original}${correction}</CashTransactions>`),
      );
      // vyplaceno bylo jednou 50 USD — po opravě srážky to tak musí zůstat
      expect(await storedGross(db, 'US7561091049')).toEqual({ count: 1, gross: '50' });
    },
  );

  /**
   * Storno a nové zaúčtování samotné dividendy: první den přijdou dva řádky,
   * o pár dní později REVERSAL jednoho z nich a náhradní řádek s jinou částkou
   * (všechno s dateTime původní výplaty). První synchronizace uloží dvě
   * dividendy, pozdější z týchž řádků složí jednu „netto“ — a ta se přidá
   * jako třetí.
   *
   * Zdroj: Sourcerooo/WealthIQ data/input/TaxAlpha_Raw_Data_2021.xml a
   * _2022.xml (VUSA 29. 9. 2021 a 30. 3. 2022: „CASH DIVIDEND … - REVERSAL“
   * s transactionID o desítky milionů vyšším než původní řádky téhož dne).
   */
  it(
    'stornovaná a znovu zaúčtovaná dividenda se nesečte s původní',
    { timeout: 30_000 },
    async () => {
      const db = await freshDb();
      const firstDay = `
        <CashTransaction accountId="U7000001" currency="USD" fxRateToBase="0.92" assetCategory="STK" symbol="WRLD" description="WRLD(IE00B0000W16) CASH DIVIDEND USD 0.25 PER SHARE (Mixed Income)" isin="IE00B0000W16" dateTime="20260629;202000" amount="20" type="Dividends" transactionID="950000001" />
        <CashTransaction accountId="U7000001" currency="USD" fxRateToBase="0.92" assetCategory="STK" symbol="WRLD" description="WRLD(IE00B0000W16) CASH DIVIDEND USD 0.25 PER SHARE (Mixed Income)" isin="IE00B0000W16" dateTime="20260629;202000" amount="45" type="Dividends" transactionID="950000002" />`;
      const rebooked = `
        <CashTransaction accountId="U7000001" currency="USD" fxRateToBase="0.92" assetCategory="STK" symbol="WRLD" description="WRLD(IE00B0000W16) CASH DIVIDEND USD 0.25 PER SHARE - REVERSAL (Mixed Income)" isin="IE00B0000W16" dateTime="20260629;202000" amount="-45" type="Dividends" transactionID="950400001" />
        <CashTransaction accountId="U7000001" currency="USD" fxRateToBase="0.92" assetCategory="STK" symbol="WRLD" description="WRLD(IE00B0000W16) CASH DIVIDEND USD 0.25 PER SHARE (Mixed Income)" isin="IE00B0000W16" dateTime="20260629;202000" amount="43" type="Dividends" transactionID="950400002" />`;

      await syncStatement(
        db,
        '2026-06-30',
        statement('20260629', `<CashTransactions>${firstDay}</CashTransactions>`),
      );
      expect((await storedGross(db, 'IE00B0000W16')).gross).toBe('65');

      await syncStatement(
        db,
        '2026-07-08',
        statement('20260707', `<CashTransactions>${firstDay}${rebooked}</CashTransactions>`),
      );
      // skutečně vyplaceno: 20 + 45 − 45 + 43 = 63 USD
      expect((await storedGross(db, 'IE00B0000W16')).gross).toBe('63');
    },
  );

  /**
   * Stornovaný obchod: parser originál vyřadí jen z TÉHOŽ výpisu. U napojeného
   * účtu se ale originál uložil dřív, než storno přišlo (storno má pozdější
   * reportDate) — a v databázi zůstane napořád. Varování přitom tvrdí
   * „originál i storno vynechány“.
   *
   * Zdroj: portfolio-performance testIBFlexStatementFile09.xml (nákup
   * 2. 12. 2022, „BUY (Ca.)“ s origTradeID a reportDate 5. 12. 2022).
   */
  it(
    'obchod stornovaný až po první synchronizaci v datech nezůstane',
    { timeout: 30_000 },
    async () => {
      const db = await freshDb();
      const trade = `
        <Trade accountId="U7000001" currency="EUR" fxRateToBase="1" assetCategory="STK" symbol="FRFT" description="FARFIELD LTD-CLASS A" isin="KY3074400017" tradeID="960000001" reportDate="20260602" dateTime="20260602;062611" tradeDate="20260602" settleDateTarget="20260604" transactionType="ExchTrade" quantity="300" tradePrice="5.5" tradeMoney="1650" proceeds="-1650" taxes="0" ibCommission="-1.65" ibCommissionCurrency="EUR" netCash="-1651.65" openCloseIndicator="O" transactionID="970000001" buySell="BUY" levelOfDetail="EXECUTION" />`;
      const cancellation = `
        <Trade accountId="U7000001" currency="EUR" fxRateToBase="1" assetCategory="STK" symbol="FRFT" description="FARFIELD LTD-CLASS A" isin="KY3074400017" reportDate="20260605" dateTime="20260602;062611" tradeDate="20260602" transactionType="TradeCancel" quantity="-300" tradePrice="5.5" tradeMoney="-1650" proceeds="1650" taxes="0" ibCommission="0" ibCommissionCurrency="EUR" netCash="1650" notes="Ca" origTradePrice="5.5" origTradeDate="20260602" origTradeID="960000001" transactionID="970000091" buySell="BUY (Ca.)" levelOfDetail="EXECUTION" />`;

      await syncStatement(db, '2026-06-03', statement('20260602', `<Trades>${trade}</Trades>`));
      await syncStatement(
        db,
        '2026-06-06',
        statement('20260605', `<Trades>${trade}${cancellation}</Trades>`),
      );

      const buys = (await loadTransactions(db, 'u1', 'ibkr')).filter(
        (tx) => tx.type === 'BUY' && tx.isin === 'KY3074400017',
      );
      expect(buys).toHaveLength(0);
    },
  );

  const DIVIDEND = `
    <CashTransaction accountId="U7000001" currency="USD" assetCategory="STK" symbol="RLTY" description="RLTY(US7561091049) CASH DIVIDEND USD 0.5 PER SHARE (Ordinary Dividend)" isin="US7561091049" dateTime="20260305;202000" amount="50" type="Dividends" transactionID="940000001" reportDate="20260305" levelOfDetail="DETAIL" />`;
  const withholding = (amount: string, id: string): string => `
    <CashTransaction accountId="U7000001" currency="USD" assetCategory="STK" symbol="RLTY" description="RLTY(US7561091049) CASH DIVIDEND USD 0.5 PER SHARE - US TAX" isin="US7561091049" dateTime="20260305;202000" amount="${amount}" type="Withholding Tax" transactionID="${id}" reportDate="20260305" levelOfDetail="DETAIL" />`;
  const dividendStatement = (rows: string): string =>
    statement('20260918', `<CashTransactions>${rows}</CashTransactions>`);
  const storedWithholding = async (db: Db): Promise<string[]> =>
    (await loadTransactions(db, 'u1', 'ibkr')).flatMap((tx) =>
      tx.type === 'DIVIDEND' ? [tx.withholdingTax.toString()] : [],
    );

  it(
    'opravený řádek zůstává ve své původní dávce — vrácení novějšího importu ho nesmaže',
    { timeout: 30_000 },
    async () => {
      const db = await freshDb();
      await syncStatement(db, '2026-03-06', dividendStatement(DIVIDEND + withholding('-7.5', '940000002')));
      const corrected = await syncStatement(
        db,
        '2026-09-19',
        dividendStatement(
          DIVIDEND +
            withholding('-7.5', '940000002') +
            withholding('7.5', '940000101') +
            withholding('-2.5', '940000102'),
        ),
      );
      expect(await storedWithholding(db)).toEqual(['2.5']);
      expect(corrected.warnings.some((w) => w.message.includes('zpětně opravil'))).toBe(true);
      // oprava není nová transakce dávky
      expect(corrected.added).toBe(0);

      const { undoImportBatch } = await import('@/lib/import-undo');
      await undoImportBatch(db, 'u1', corrected.batchId);
      expect((await storedGross(db, 'US7561091049')).count).toBe(1);
    },
  );

  it(
    'účet, který má tutéž dividendu z dřívějška uloženou dvakrát, se opravou srovná na jednu',
    { timeout: 30_000 },
    async () => {
      const db = await freshDb();
      await syncStatement(db, '2026-03-06', dividendStatement(DIVIDEND + withholding('-7.5', '940000002')));
      // stav před opravou importu: přepočtená kopie téže události vedle původní
      const [stored] = await db.select().from(transactions);
      await db.insert(transactions).values({
        ...stored!,
        dedupeKey: `${stored!.dedupeKey}-kopie`,
        payload: { ...(stored!.payload as Record<string, unknown>), withholdingTax: '15' },
      });
      expect((await storedGross(db, 'US7561091049')).count).toBe(2);

      await syncStatement(
        db,
        '2026-09-19',
        dividendStatement(
          DIVIDEND +
            withholding('-7.5', '940000002') +
            withholding('7.5', '940000101') +
            withholding('-2.5', '940000102'),
        ),
      );
      expect(await storedGross(db, 'US7561091049')).toEqual({ count: 1, gross: '50' });
      expect(await storedWithholding(db)).toEqual(['2.5']);
    },
  );

  it(
    'ručně nahraný výpis uloženou verzi nepřepíše — neví se, která je novější',
    { timeout: 30_000 },
    async () => {
      const db = await freshDb();
      // synchronizace už nese opravenou srážku 2,5
      await syncStatement(
        db,
        '2026-09-19',
        dividendStatement(
          DIVIDEND +
            withholding('-7.5', '940000002') +
            withholding('7.5', '940000101') +
            withholding('-2.5', '940000102'),
        ),
      );
      // starší soubor z disku, ještě se srážkou 7,5
      const manual = await importParsed(
        db,
        'u1',
        'starsi-vypis.xml',
        parseIbkrFlexXml(dividendStatement(DIVIDEND + withholding('-7.5', '940000002'))),
      );
      expect(await storedWithholding(db)).toEqual(['2.5']);
      expect(manual.added).toBe(0);
      expect(manual.warnings.some((w) => w.message.includes('která verze je novější'))).toBe(true);
    },
  );

  it(
    'dříve uložený split nového titulu se po spojení nohou reverse splitu zruší',
    { timeout: 30_000 },
    async () => {
      const db = await freshDb();
      const leg = (symbol: string, isin: string, quantity: string, id: string): string =>
        `<CorporateAction accountId="U7000001" currency="USD" assetCategory="STK" symbol="${symbol}" description="NVX(US66980A1016) SPLIT 1 FOR 20 (${symbol}, NOVEXA CORP, ${isin})" isin="${isin}" reportDate="20260211" dateTime="20260210;202500" actionDescription="NVX(US66980A1016) SPLIT 1 FOR 20 (${symbol}, NOVEXA CORP, ${isin})" quantity="${quantity}" type="RS" transactionID="${id}" actionID="" levelOfDetail="DETAIL" />`;
      const parsed = parseIbkrFlexXml(
        statement(
          '20260918',
          `<CorporateActions>${leg('NVXD', 'US66980A2006', '30', '920000011')}${leg('NVXD.OLD', 'US66980A1016', '-600', '920000012')}</CorporateActions>`,
        ),
      );
      const [merged] = parsed.transactions;
      if (merged?.type !== 'CORPORATE_ACTION') throw new Error('split chybí');
      // stav před opravou parseru: každá noha jako vlastní SPLIT pod svým id
      const oldLegOnly = { ...merged, newIsin: undefined };
      await importParsed(db, 'u1', 'drive.xml', {
        ...parsed,
        retracted: [],
        transactions: [
          oldLegOnly,
          { ...oldLegOnly, id: parsed.retracted[0]!.id, isin: 'US66980A2006' },
        ],
      });

      await importParsed(db, 'u1', 'dnes.xml', parsed, undefined, { newerThanStored: true });
      const actions = (await loadTransactions(db, 'u1', 'ibkr')).filter(
        (tx) => tx.type === 'CORPORATE_ACTION',
      );
      expect(actions).toHaveLength(1);
      expect(actions[0]).toMatchObject({ isin: 'US66980A1016', newIsin: 'US66980A2006' });
    },
  );
});
