import { afterEach, describe, expect, it, vi } from 'vitest';
import { d, TaxpayerProfileSchema } from '@danero/shared';
import { analyzeTaxYear, type TaxYearConfig } from '@danero/engine';
import { IbkrFlexClient, parseIbkrFlexXml } from '../src';

/**
 * IBKR / Lynx: tvary řádků a odpovědí, jak je služba opravdu posílá (audit
 * 13. 10. 2026). Rozložení (elementy, atributy, tvar popisů) je opsané ze
 * skutečných výpisů zveřejněných v cizích projektech; čísla, tituly, časy
 * a čísla účtů jsou smyšlené. Zdroj je u každého testu.
 *
 * Komentáře u testů popisují vadu, kterou test hlídá — tedy chování PŘED
 * opravou z 13. 10. 2026. Fixtura `fixtures/ibkr.ts` je proti těmhle tvarům
 * idealizovaná (párové akce se společným actionID, split jedním řádkem),
 * proto na ní sada vady neukázala.
 */
const statement = (inner: string, type = 'AF'): string => `<?xml version="1.0" encoding="UTF-8"?>
<FlexQueryResponse queryName="danero" type="${type}">
  <FlexStatements count="1">
    <FlexStatement accountId="U7000001" fromDate="20260101" toDate="20261009" period="YearToDate" whenGenerated="20261010;060000">
${inner}
    </FlexStatement>
  </FlexStatements>
</FlexQueryResponse>`;

/** Testovací kurzy (kulaté, NE skutečné) — stejné jako v e2e.engine.test.ts. */
const CFG: TaxYearConfig = {
  year: 2025,
  unifiedRatesByYear: {
    2024: { USD: '23' },
    2025: { USD: '20' },
  },
  limits: {
    securitiesProceedsExemption: '100000',
    cryptoProceedsExemption: '100000',
    flatTaxOtherIncome: '50000',
    employeeSideIncome: '20000',
    generalFiling: '50000',
    exemptIncomeReporting: '5000000',
    timeTestCap: { amountCzk: '40000000', appliesTo: ['SECURITIES', 'CRYPTO'] },
  },
  cryptoRules: { exemptionsAvailable: true, effectiveFrom: '2025-02-15' },
  progressiveThreshold: '1676052',
};

describe('IBKR Flex Query XML: čísla ze skutečných tvarů řádků', () => {
  /**
   * Pokladniční poukázka (assetCategory="BILL") se kotuje stejně jako dluhopis:
   * quantity je NOMINÁL a tradePrice procento nominálu. Parser zná jen "BOND",
   * takže BILL propadne mezi akcie a cena se vezme doslova — stonásobek.
   *
   * Zdroj: matdue/ibkr-steuerrechner, tests/resources/treasury_bill/buy_long_close.csv
   * (AssetClass BILL, TradeQuantity 5000, TradePrice 97,37…, TradeGross −4868,55);
   * csingley/ibflex enums.py (AssetClass.BILL = "BILL").
   */
  it('pokladniční poukázka (BILL) se ocení skutečným plněním, ne procentem nominálu', () => {
    const parsed = parseIbkrFlexXml(
      statement(`<Trades>
        <Trade accountId="U7000001" currency="USD" assetCategory="BILL" symbol="912797QX8" description="B 08/20/26" conid="700000001" securityID="US912797QX80" securityIDType="ISIN" cusip="912797QX8" isin="US912797QX80" multiplier="1" tradeID="810000001" reportDate="20260219" tradeDate="20260219" settleDateTarget="20260220" transactionType="ExchTrade" quantity="8000" tradePrice="98.125" tradeMoney="7850" proceeds="-7850" taxes="0" ibCommission="-5" ibCommissionCurrency="USD" netCash="-7855" openCloseIndicator="O" buySell="BUY" transactionID="910000001" levelOfDetail="EXECUTION" />
      </Trades>`),
    );
    const buy = parsed.transactions.find((tx) => tx.type === 'BUY');
    // přípustná je i viditelná chyba; tichý stonásobek ne
    if (!buy || buy.type !== 'BUY') {
      expect(parsed.errors.length).toBeGreaterThan(0);
      return;
    }
    expect(buy.quantity.mul(buy.pricePerShare).toString()).toBe('7850');
  });

  /**
   * Reverse split, při kterém se mění ISIN (v USA prakticky vždy — nový CUSIP),
   * posílá IBKR jako DVA řádky téhož typu: starý titul („XYZ.OLD“, staré ISIN,
   * záporné kusy) a nový titul (nové ISIN, kladné kusy). Parser z každého udělá
   * samostatný SPLIT: kusy zůstanou pod starým ISIN a nové ISIN nemá žádný lot,
   * takže pozdější prodej nemá nabývací cenu.
   *
   * Zdroj: titov-vv/jal tests/test_data/ibkr_corp_actions.xml (TWOHD / TWOHD.OLD,
   * 2023), ibkr_merger_spinoff.xml (SNPX, PTPI 2022), ibkr_year1.xml (ACB 2020);
   * portfolio-performance testIBFlexStatementFile01.xml (GCM / GCM.OLD).
   * Ve všech chybí actionID a popis se u obou nohou liší závorkou na konci.
   */
  const REVERSE_SPLIT_ROWS = `<CorporateActions>
        <CorporateAction accountId="U7000001" currency="USD" fxRateToBase="1" assetCategory="STK" symbol="NVXD" description="NVX(US66980A1016) SPLIT 1 FOR 20 (NVXD, NOVEXA CORP, US66980A2006)" conid="700000011" securityID="US66980A2006" securityIDType="ISIN" isin="US66980A2006" multiplier="1" reportDate="20250211" dateTime="20250210;202500" actionDescription="NVX(US66980A1016) SPLIT 1 FOR 20 (NVXD, NOVEXA CORP, US66980A2006)" amount="0" proceeds="0" value="0" quantity="30" fifoPnlRealized="0" mtmPnl="0" code="" type="RS" transactionID="920000011" actionID="" levelOfDetail="DETAIL" />
        <CorporateAction accountId="U7000001" currency="USD" fxRateToBase="1" assetCategory="STK" symbol="NVXD.OLD" description="NVX(US66980A1016) SPLIT 1 FOR 20 (NVXD.OLD, NOVEXA CORP, US66980A1016)" conid="700000010" securityID="US66980A1016" securityIDType="ISIN" isin="US66980A1016" multiplier="1" reportDate="20250211" dateTime="20250210;202500" actionDescription="NVX(US66980A1016) SPLIT 1 FOR 20 (NVXD.OLD, NOVEXA CORP, US66980A1016)" amount="0" proceeds="0" value="0" quantity="-600" fifoPnlRealized="0" mtmPnl="0" code="" type="RS" transactionID="920000012" actionID="" levelOfDetail="DETAIL" />
      </CorporateActions>`;

  it('reverse split se změnou ISIN přesune kusy pod nové ISIN (dva řádky = jedna akce)', () => {
    const parsed = parseIbkrFlexXml(statement(REVERSE_SPLIT_ROWS));
    expect(parsed.errors).toEqual([]);
    const actions = parsed.transactions.filter((tx) => tx.type === 'CORPORATE_ACTION');
    // nové ISIN před splitem nikdo nedržel — samostatný SPLIT nad ním je k ničemu
    expect(
      actions.some(
        (tx) => tx.type === 'CORPORATE_ACTION' && tx.isin === 'US66980A2006' && !tx.newIsin,
      ),
    ).toBe(false);
    expect(
      actions.some(
        (tx) =>
          tx.type === 'CORPORATE_ACTION' &&
          tx.isin === 'US66980A1016' &&
          tx.newIsin === 'US66980A2006',
      ),
    ).toBe(true);
  });

  it('prodej po reverse splitu se změnou ISIN má nabývací cenu z původního nákupu', () => {
    const parsed = parseIbkrFlexXml(
      statement(`<Trades>
        <Trade accountId="U7000001" currency="USD" assetCategory="STK" symbol="NVX" description="NOVEXA CORP" isin="US66980A1016" tradeID="810000011" tradeDate="20240304" settleDateTarget="20240306" quantity="600" tradePrice="2" proceeds="-1200" taxes="0" ibCommission="0" ibCommissionCurrency="USD" buySell="BUY" transactionID="910000011" levelOfDetail="EXECUTION" />
        <Trade accountId="U7000001" currency="USD" assetCategory="STK" symbol="NVXD" description="NOVEXA CORP" isin="US66980A2006" tradeID="810000012" tradeDate="20250602" settleDateTarget="20250603" quantity="-30" tradePrice="5000" proceeds="150000" taxes="0" ibCommission="0" ibCommissionCurrency="USD" buySell="SELL" transactionID="910000012" levelOfDetail="EXECUTION" />
      </Trades>
      ${REVERSE_SPLIT_ROWS}`),
    );
    const result = analyzeTaxYear({
      transactions: parsed.transactions,
      profile: TaxpayerProfileSchema.parse({ regime: 'PAUSAL' }),
      config: CFG,
    });
    // prodej 30 × 5 000 USD × 20 = 3 000 000 Kč (nad limit 100 000 Kč, ať se
    // výdaje počítají); nákup 600 × 2 USD × 23 = 27 600 Kč
    expect(result.warnings.some((w) => w.code === 'NEGATIVE_POSITION')).toBe(false);
    expect(result.securities.expensesCzk.toString()).toBe('27600');
    expect(result.securities.rawGainLossCzk.toString()).toBe('2972400');
  });

  /**
   * Výměna akcií za akcie (TC) má dvě nohy bez společného actionID a s různým
   * koncem popisu, takže se nespárují. Stará noha pak propadne do větve „fúze
   * za hotovost“ — a protože proceeds="0" je po převodu na Decimal pravdivý
   * objekt, projde kontrolou `!proceeds` a vznikne PRODEJ ZA NULU: celá pozice
   * se odepíše jako ztráta a nové akcie skončí jen chybou.
   *
   * Zdroj: titov-vv/jal tests/test_data/ibkr_merger_spinoff.xml (NTRP → PTPI).
   */
  it('výměna akcií za akcie (TC) je fúze, ne prodej za nulu', () => {
    const parsed = parseIbkrFlexXml(
      statement(`<CorporateActions>
        <CorporateAction accountId="U7000001" currency="USD" fxRateToBase="1" assetCategory="STK" symbol="ORLN" description="ORLN(US68571X1037) MERGED(Acquisition) WITH US92537N2071 1 FOR 4 (ORLN, ORLIN THERAPEUTICS INC, US68571X1037)" isin="US68571X1037" reportDate="20260303" dateTime="20260302;202500" actionDescription="ORLN(US68571X1037) MERGED(Acquisition) WITH US92537N2071 1 FOR 4 (ORLN, ORLIN THERAPEUTICS INC, US68571X1037)" amount="0" proceeds="0" value="-412.8" quantity="-240" type="TC" transactionID="920000021" actionID="" levelOfDetail="DETAIL" />
        <CorporateAction accountId="U7000001" currency="USD" fxRateToBase="1" assetCategory="STK" symbol="VRDA" description="ORLN(US68571X1037) MERGED(Acquisition) WITH US92537N2071 1 FOR 4 (VRDA, VERIDA PHARMA INC, US92537N2071)" isin="US92537N2071" reportDate="20260303" dateTime="20260302;202500" actionDescription="ORLN(US68571X1037) MERGED(Acquisition) WITH US92537N2071 1 FOR 4 (VRDA, VERIDA PHARMA INC, US92537N2071)" amount="0" proceeds="0" value="398.4" quantity="60" type="TC" transactionID="920000022" actionID="" levelOfDetail="DETAIL" />
      </CorporateActions>`),
    );
    expect(parsed.transactions.some((tx) => tx.type === 'SELL')).toBe(false);
    const merger = parsed.transactions.find(
      (tx) => tx.type === 'CORPORATE_ACTION' && tx.subtype === 'MERGER',
    );
    if (!merger || merger.type !== 'CORPORATE_ACTION') throw new Error('fúze se nenaimportovala');
    expect(merger.isin).toBe('US68571X1037');
    expect(merger.newIsin).toBe('US92537N2071');
    expect(parsed.errors).toEqual([]);
  });

  /**
   * IBKR do nabývací ceny počítá i daň z transakce (atribut `taxes`): „Cost
   * Basis … is the inverse of proceeds plus commission and tax amount“, „Net
   * Cash is calculated by adding the proceeds plus tax plus commissions“.
   * Parser čte jen ibCommission, takže daň z transakce tiše zmizí z výdajů.
   *
   * Zdroj: ibkrguides.com/reportingreference/reportguide/tradesfq.htm;
   * nenulové `taxes` v reálném výpisu: alensiljak/alens-importers
   * tests/commissions.xml (netCash = proceeds + taxes + ibCommission).
   */
  it('daň z transakce (taxes) vstupuje do poplatků obchodu', () => {
    const parsed = parseIbkrFlexXml(
      statement(`<Trades>
        <Trade accountId="U7000001" currency="GBP" assetCategory="STK" symbol="BRTL" description="BRITELINE PLC" isin="GB00B0000T19" tradeID="810000031" tradeDate="20260210" settleDateTarget="20260212" quantity="1000" tradePrice="0.9" tradeMoney="900" proceeds="-900" taxes="-4.5" ibCommission="-3" ibCommissionCurrency="GBP" netCash="-907.5" cost="907.5" buySell="BUY" transactionID="910000031" levelOfDetail="EXECUTION" />
      </Trades>`),
    );
    const buy = parsed.transactions.find((tx) => tx.type === 'BUY');
    if (!buy || buy.type !== 'BUY') throw new Error('nákup se nenaimportoval');
    expect(buy.fee?.amount.toString()).toBe('7.5');
  });

  /**
   * Storno bez sloupce origTradeID (uživatel si pole nezaškrtl): originál,
   * storno i opravný obchod jsou ve výpisu, jen je parser neumí spojit. Dnes
   * skončí chybou „zkontroluj, že výpis pokrývá i původní obchod“ — přestože
   * ho pokrývá — a originál i oprava se uloží OBA, takže pozice je dvojnásobná.
   *
   * Zdroj: Sourcerooo/WealthIQ data/input/TaxAlpha_Raw_Data_2021.xml (VUSA,
   * 9. 4. 2021: BUY, BUY (Ca.) se záporným množstvím, BUY znovu; atributy
   * tradeID ani origTradeID ve výpisu nejsou, jen transactionID).
   */
  it('storno bez origTradeID se spáruje podle obsahu a pozici nezdvojí', () => {
    const parsed = parseIbkrFlexXml(
      statement(`<Trades>
        <Trade accountId="U7000001" currency="EUR" fxRateToBase="1" assetCategory="STK" symbol="EUXA" description="EURO EQUITY UCITS" isin="IE00B0000X17" dateTime="20260409;103001" tradeDate="20260409" settleDateTarget="20260413" quantity="150" tradePrice="40.2" tradeMoney="6030" taxes="0" ibCommission="-3.015" ibCommissionCurrency="EUR" cost="6033.015" fifoPnlRealized="0" buySell="BUY" transactionID="910000041" />
        <Trade accountId="U7000001" currency="EUR" fxRateToBase="1" assetCategory="STK" symbol="EUXA" description="EURO EQUITY UCITS" isin="IE00B0000X17" dateTime="20260409;103001" tradeDate="20260409" settleDateTarget="20260413" quantity="-150" tradePrice="40.2" tradeMoney="-6030" taxes="0" ibCommission="0" ibCommissionCurrency="EUR" cost="-6030" fifoPnlRealized="0" buySell="BUY (Ca.)" transactionID="910000047" />
        <Trade accountId="U7000001" currency="EUR" fxRateToBase="1" assetCategory="STK" symbol="EUXA" description="EURO EQUITY UCITS" isin="IE00B0000X17" dateTime="20260409;103001" tradeDate="20260409" settleDateTarget="20260414" quantity="150" tradePrice="40.2" tradeMoney="6030" taxes="0" ibCommission="0" ibCommissionCurrency="EUR" cost="6030" fifoPnlRealized="0" buySell="BUY" transactionID="910000048" />
      </Trades>`),
    );
    const bought = parsed.transactions
      .filter((tx) => tx.type === 'BUY')
      .reduce((sum, tx) => (tx.type === 'BUY' ? sum.plus(tx.quantity) : sum), d('0'));
    expect(bought.toString()).toBe('150');
  });
});

describe('IBKR Flex Query XML: výpis bez obchodů se neprohlásí za prázdný', () => {
  /**
   * Úroveň „Orders“ v sekci Trades NENÍ <Trade levelOfDetail="ORDER">, ale
   * vlastní element <Order> (stejně tak <Lot>, <SymbolSummary>, <AssetSummary>).
   * Parser čte jen <Trade>, takže kontrola „sekce obsahuje jen objednávky“
   * nikdy nenastane: výpis s objednávkami bez exekucí dá 0 obchodů a 0 chyb.
   *
   * Zdroj: portfolio-performance testIBFlexStatementFile20.xml (<Trades> s
   * <AssetSummary>, <SymbolSummary>, <Order>, <Trade>); csingley/ibflex
   * Types.py („class Order: Wrapped in <TradeConfirms> or <Trades>“).
   */
  it('sekce Trades jen s elementy <Order> skončí chybou o úrovni Executions', () => {
    const parsed = parseIbkrFlexXml(
      statement(`<Trades>
        <SymbolSummary accountId="U7000001" currency="USD" assetCategory="STK" symbol="MSFT" description="MICROSOFT CORP" isin="US5949181045" tradeDate="20260312" quantity="12" tradePrice="401.5" proceeds="-4818" taxes="0" ibCommission="-1" ibCommissionCurrency="USD" buySell="BUY" levelOfDetail="SYMBOL_SUMMARY" />
        <Order accountId="U7000001" currency="USD" fxRateToBase="0.92" assetCategory="STK" symbol="MSFT" description="MICROSOFT CORP" isin="US5949181045" reportDate="20260312" tradeDate="20260312" settleDateTarget="20260313" quantity="12" tradePrice="401.5" tradeMoney="4818" proceeds="-4818" taxes="0" ibCommission="-1" ibCommissionCurrency="USD" netCash="-4819" openCloseIndicator="-" buySell="BUY" ibOrderID="900000001" orderTime="20260312;093015" levelOfDetail="ORDER" orderType="LMT" />
      </Trades>`),
    );
    expect(parsed.transactions).toHaveLength(0);
    expect(parsed.errors.some((error) => /Execution/i.test(error.message))).toBe(true);
  });

  /**
   * Flex Web Service vydává i „Trade Confirmation Flex Query“ (IBKR: „generate
   * at least one Activity Flex Query or Trade Confirmation Flex Query“). Ta má
   * type="TCF" a obchody v <TradeConfirms>. Parser v ní nenajde nic a vrátí
   * prázdný výsledek bez chyby — synchronizace skončí jako úspěšná.
   *
   * Zdroj: interactivebrokers.com/docs/web-api/flex-web-service/
   * client-portal-configuration/create-a-flex-query; csingley/ibflex Types.py
   * (TradeConfirm „Wrapped in <TradeConfirms>“).
   */
  it('Trade Confirmation Flex Query řekne, že je potřeba Activity Flex Query', () => {
    const parsed = parseIbkrFlexXml(
      statement(
        `<TradeConfirms>
        <TradeConfirm accountId="U7000001" currency="USD" assetCategory="STK" symbol="MSFT" description="MICROSOFT CORP" isin="US5949181045" tradeID="810000051" tradeDate="20261009" settleDate="20261012" buySell="BUY" quantity="5" price="402" amount="-2010" commission="-1" commissionCurrency="USD" levelOfDetail="EXECUTION" />
      </TradeConfirms>`,
        'TCF',
      ),
    );
    expect(parsed.transactions).toHaveLength(0);
    expect(parsed.errors.length).toBeGreaterThan(0);
  });
});

describe('IBKR Flex Query XML: párování nohou a formáty data', () => {
  /**
   * Změna ISIN (IC) chodí jako dvě nohy BEZ společného actionID a s různým
   * koncem popisu (závorka popisuje titul té které nohy). Náhradní klíč
   * „typ + popis + datum“ je tak pro každou nohu jiný a obě skončí chybou
   * „nemá kompletní pár“. Fixtura v repu má actionID na obou nohách a shodné
   * popisy — proto testy mlčely.
   *
   * Zdroj: titov-vv/jal tests/test_data/ibkr_year1.xml (PEIX / PEIX.OLD, 2021).
   */
  it('změna ISIN (IC) bez actionID se spáruje podle společné části popisu', () => {
    const parsed = parseIbkrFlexXml(
      statement(`<CorporateActions>
        <CorporateAction accountId="U7000001" currency="USD" fxRateToBase="1" assetCategory="STK" symbol="ALTV" description="PCET(US70469K3014) CUSIP/ISIN CHANGE TO (US02209V1052) (ALTV, ALTIVA INGREDIENTS INC, US02209V1052)" isin="US02209V1052" reportDate="20260115" dateTime="20260114;202500" actionDescription="PCET(US70469K3014) CUSIP/ISIN CHANGE TO (US02209V1052) (ALTV, ALTIVA INGREDIENTS INC, US02209V1052)" amount="0" proceeds="0" value="0" quantity="90" type="IC" transactionID="920000031" actionID="" levelOfDetail="DETAIL" />
        <CorporateAction accountId="U7000001" currency="USD" fxRateToBase="1" assetCategory="STK" symbol="PCET.OLD" description="PCET(US70469K3014) CUSIP/ISIN CHANGE TO (US02209V1052) (PCET.OLD, PACIFIC CETANE INC, US70469K3014)" isin="US70469K3014" reportDate="20260115" dateTime="20260114;202500" actionDescription="PCET(US70469K3014) CUSIP/ISIN CHANGE TO (US02209V1052) (PCET.OLD, PACIFIC CETANE INC, US70469K3014)" amount="0" proceeds="0" value="0" quantity="-90" type="IC" transactionID="920000032" actionID="" levelOfDetail="DETAIL" />
      </CorporateActions>`),
    );
    expect(parsed.errors).toEqual([]);
    const change = parsed.transactions.find(
      (tx) => tx.type === 'CORPORATE_ACTION' && tx.subtype === 'ISIN_CHANGE',
    );
    if (!change || change.type !== 'CORPORATE_ACTION') throw new Error('změna ISIN chybí');
    expect(change.isin).toBe('US70469K3014');
    expect(change.newIsin).toBe('US02209V1052');
  });

  /**
   * IBKR Ireland sráží z kreditního úroku 20 % a posílá to jako řádek
   * „Withholding Tax“ bez titulu. Parser každou srážku páruje s dividendou,
   * takže tady hlásí „Srážková daň bez párové dividendy (nejspíš oprava přes
   * hranici období)“ a radí zkontrolovat export — což uživatele pošle hledat
   * chybu, která neexistuje, a o sražené dani z úroku se nedozví.
   *
   * Zdroj: Sourcerooo/WealthIQ data/input/TaxAlpha_Raw_Data_2024.xml
   * („EUR CREDIT INT FOR JUN-2024“ + „WITHHOLDING @ 20% ON CREDIT INT FOR
   * JUN-2024“, týž den a měna, symbol i isin prázdné); na témže souboru dnes
   * parser vydá 4× toto varování.
   */
  it('srážka z kreditního úroku patří k úroku, ne k „dividendě bez páru“', () => {
    const parsed = parseIbkrFlexXml(
      statement(`<CashTransactions>
        <CashTransaction accountId="U7000001" currency="EUR" fxRateToBase="1" assetCategory="" symbol="" description="EUR CREDIT INT FOR MAR-2026" isin="" dateTime="20260403" amount="84.5" type="Broker Interest Received" transactionID="930000001" />
        <CashTransaction accountId="U7000001" currency="EUR" fxRateToBase="1" assetCategory="" symbol="" description="WITHHOLDING @ 20% ON CREDIT INT FOR MAR-2026" isin="" dateTime="20260403" amount="-16.9" type="Withholding Tax" transactionID="930000002" />
      </CashTransactions>`),
    );
    expect(parsed.warnings.some((w) => w.message.includes('bez párové dividendy'))).toBe(false);
    const interest = parsed.transactions.find((tx) => tx.type === 'INTEREST');
    if (!interest || interest.type !== 'INTEREST') throw new Error('úrok se nenaimportoval');
    expect(interest.amount.toString()).toBe('84.5');
    expect(interest.withholdingTax.toString()).toBe('16.9');
  });

  /**
   * Formát data si uživatel volí. Parser umí lomítka jen se čtyřmístným rokem
   * (MM/dd/yyyy, dd/MM/yyyy); nabídka má i MM/dd/yy a dd/MM/yy. Každý řádek pak
   * skončí chybou „chybí datum“, přestože datum ve výpisu je.
   *
   * Zdroj: csingley/ibflex parser.py („Available date formats are: yyyyMMdd,
   * yyyy-MM-dd, MM/dd/yyyy, MM/dd/yy, dd/MM/yyyy, dd/MM/yy, dd-MMM-yy“).
   */
  it('datum MM/dd/yy (dvoumístný rok) se přečte', () => {
    const parsed = parseIbkrFlexXml(
      statement(`<Trades>
        <Trade accountId="U7000001" currency="USD" assetCategory="STK" symbol="MSFT" description="MICROSOFT CORP" isin="US5949181045" tradeID="810000061" tradeDate="03/17/26" settleDateTarget="03/18/26" quantity="4" tradePrice="400" proceeds="-1600" taxes="0" ibCommission="-1" ibCommissionCurrency="USD" buySell="BUY" transactionID="910000061" levelOfDetail="EXECUTION" />
      </Trades>`),
    );
    expect(parsed.errors).toEqual([]);
    const buy = parsed.transactions.find((tx) => tx.type === 'BUY');
    if (!buy || buy.type !== 'BUY') throw new Error('nákup se nenaimportoval');
    expect(buy.tradeDate).toBe('2026-03-17');
  });

  /**
   * Oddělovač data a času nabízí i volbu „No separator“ — dateTime je pak
   * čtrnáct číslic za sebou. Parser hledá jen `;`, čárku, mezeru a `T`.
   *
   * Zdroj: csingley/ibflex parser.py („Available date/time separators are:
   * ; , ' ' No separator“).
   */
  it('dateTime bez oddělovače (yyyyMMddHHmmss) se přečte', () => {
    const parsed = parseIbkrFlexXml(
      statement(`<CashTransactions>
        <CashTransaction accountId="U7000001" currency="USD" fxRateToBase="0.92" assetCategory="STK" symbol="MSFT" description="MSFT(US5949181045) CASH DIVIDEND USD 0.83 PER SHARE (Ordinary Dividend)" isin="US5949181045" dateTime="20260611202000" settleDate="20260611" amount="33.2" type="Dividends" transactionID="930000011" reportDate="20260611" levelOfDetail="DETAIL" />
      </CashTransactions>`),
    );
    expect(parsed.errors).toEqual([]);
    const dividend = parsed.transactions.find((tx) => tx.type === 'DIVIDEND');
    if (!dividend || dividend.type !== 'DIVIDEND') throw new Error('dividenda se nenaimportovala');
    expect(dividend.date).toBe('2026-06-11');
  });
});

describe('IBKR Flex Query XML: pojistky z revize oprav (13. 10. 2026)', () => {
  it('datum splatnosti v popisu dluhopisu nerozhoduje o pořadí dne a měsíce', () => {
    // Výpis je v dd/MM/yyyy; popis „T 2 7/8 05/15/28“ se opakuje u každého
    // řádku a jako americké datum by přehlasoval skutečná data.
    const bond = (id: string, date: string): string =>
      `<Trade accountId="U7000001" currency="USD" assetCategory="BOND" symbol="T 2 7/8 05/15/28" description="T 2 7/8 05/15/28" isin="US9128284N73" tradeID="${id}" tradeDate="${date}" quantity="1000" tradePrice="97.5" proceeds="-975" ibCommission="-1" ibCommissionCurrency="USD" buySell="BUY" levelOfDetail="EXECUTION" />`;
    const parsed = parseIbkrFlexXml(
      statement(`<Trades>${bond('1', '20/03/2026')}${bond('2', '05/06/2026')}</Trades>`),
    );
    expect(parsed.errors).toEqual([]);
    expect(parsed.transactions.map((tx) => (tx.type === 'BUY' ? tx.tradeDate : ''))).toEqual([
      '2026-03-20',
      '2026-06-05',
    ]);
  });

  it('storno opce vyřadí původní obchod stejně jako u akcií', () => {
    const option = (extra: string): string =>
      `<Trade accountId="U7000001" currency="USD" assetCategory="OPT" symbol="MSFT  261218C00450000" description="MSFT 18DEC26 450 C" multiplier="100" tradeDate="20260410" tradePrice="12" ibCommission="-1" ibCommissionCurrency="USD" levelOfDetail="EXECUTION" ${extra} />`;
    const parsed = parseIbkrFlexXml(
      statement(`<Trades>
        ${option('tradeID="5001" quantity="1" buySell="BUY"')}
        ${option('tradeID="5002" origTradeID="5001" quantity="-1" buySell="BUY (Ca.)"')}
      </Trades>`),
    );
    expect(parsed.transactions).toEqual([]);
    expect(parsed.errors).toEqual([]);
    expect(parsed.retracted).toEqual([{ id: 'ibkr-5001', types: ['BUY', 'SELL'] }]);
  });

  it('srážka bez titulu nepřipadne kupónu z dluhopisu, ale úroku od brokera', () => {
    const cash = (type: string, description: string, amount: string, id: string): string =>
      `<CashTransaction accountId="U7000001" currency="USD" symbol="" isin="" description="${description}" dateTime="20260403" amount="${amount}" type="${type}" transactionID="${id}" />`;
    const parsed = parseIbkrFlexXml(
      statement(`<CashTransactions>
        ${cash('Bond Interest Received', 'BOND COUPON PAYMENT', '120', '1')}
        ${cash('Broker Interest Received', 'USD CREDIT INT FOR MAR-2026', '50', '2')}
        ${cash('Withholding Tax', 'WITHHOLDING @ 20% ON CREDIT INT FOR MAR-2026', '-10', '3')}
      </CashTransactions>`),
    );
    const withheld = parsed.transactions.flatMap((tx) =>
      tx.type === 'INTEREST' ? [`${tx.amount.toString()}:${tx.withholdingTax.toString()}`] : [],
    );
    expect(withheld.sort()).toEqual(['120:0', '50:10']);
  });

  it('spojená fúze ruší dřív uložený prodej staré nohy za nulu', () => {
    const leg = (symbol: string, isin: string, quantity: string): string =>
      `<CorporateAction accountId="U7000001" currency="USD" symbol="${symbol}" isin="${isin}" description="ORLN(US68571X1037) MERGED(Acquisition) WITH US92537N2071 1 FOR 4 (${symbol}, X INC, ${isin})" dateTime="20260302;202500" proceeds="0" quantity="${quantity}" type="TC" actionID="" levelOfDetail="DETAIL" />`;
    const parsed = parseIbkrFlexXml(
      statement(
        `<CorporateActions>${leg('ORLN', 'US68571X1037', '-240')}${leg('VRDA', 'US92537N2071', '60')}</CorporateActions>`,
      ),
    );
    expect(parsed.transactions.map((tx) => tx.type)).toEqual(['CORPORATE_ACTION']);
    expect(parsed.retracted).toHaveLength(1);
    expect(parsed.retracted[0]).toMatchObject({ types: ['SELL'] });
    expect(parsed.retracted[0]!.id).toMatch(/^ibkr-ca-[0-9a-f]+$/);
  });
});


/* ── Flex Web Service ────────────────────────────────────────────────────── */

const DOCUMENTED_BASE = 'https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService';

const sendOk = (url: string): string => `<FlexStatementResponse timestamp='13 October, 2026 03:10 AM EDT'>
<Status>Success</Status>
<ReferenceCode>7700000001</ReferenceCode>
<Url>${url}</Url>
</FlexStatementResponse>`;

const failure = (status: 'Fail' | 'Warn', code: string, message: string): string =>
  `<FlexStatementResponse timestamp='13 October, 2026 03:10 AM EDT'>
<Status>${status}</Status>
<ErrorCode>${code}</ErrorCode>
<ErrorMessage>${message}</ErrorMessage>
</FlexStatementResponse>`;

const READY = statement('<Trades />');

/** Odpovědi se berou popořadě; poslední se opakuje. */
function scriptedFetch(script: { send: string[]; statements: string[] }) {
  const urls: string[] = [];
  let sendCalls = 0;
  let statementCalls = 0;
  const fetchImpl: typeof fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    urls.push(url);
    if (url.includes('SendRequest')) {
      const body = script.send[Math.min(sendCalls, script.send.length - 1)]!;
      sendCalls += 1;
      return new Response(body, { status: 200 });
    }
    const body = script.statements[Math.min(statementCalls, script.statements.length - 1)]!;
    statementCalls += 1;
    return new Response(body, { status: 200 });
  }) as typeof fetch;
  return { fetchImpl, urls };
}

const client = (fetchImpl: typeof fetch) =>
  new IbkrFlexClient({ token: 'tok-audit-000000', queryId: '1234567', fetchImpl });

describe('IBKR Flex Web Service podle dokumentace', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * Období uložené ve Flex Query služba ve verzi 3 nedodržuje spolehlivě:
   * uživatelé hlásí, že „Last N / 365 Calendar Days“ vrací přes API jediný
   * den, a pomáhá až parametr `p` (nebo `fd` + `td`), který IBKR dokumentuje
   * („Period Override (up to 365 days)“). Klient období neposílá, takže
   * rozsah synchronizace závisí na chování, které se u brokera mění.
   *
   * Zdroj: csingley/ibflex issue #109 (25. 5. a 10. 6. 2026);
   * ibkrguides.com/clientportal/performanceandstatements/flex3.htm (8. 6. 2026);
   * interactivebrokers.com/docs/web-api/api-reference/send-request.
   */
  it('SendRequest říká období výslovně (p, nebo fd + td)', async () => {
    const mock = scriptedFetch({
      send: [sendOk(`${DOCUMENTED_BASE}/GetStatement`)],
      statements: [READY],
    });
    await client(mock.fetchImpl).fetchStatementXml({ pollIntervalMs: 1, maxAttempts: 2 });
    expect(mock.urls[0]).toMatch(/[?&](p=\d+|fd=\d{8})(&|$)/);
  });

  /**
   * Dokumentace: „The <url> returned in the response body should be ignored“
   * (dřív „This is a legacy URL. Should be ignored.“). Klient ji naopak
   * následuje, kdykoli je na doméně IBKR. Příklad v dokumentaci sám nese
   * starou adresu `Universal/servlet/FlexStatementService.GetStatement`, která
   * od května 2026 vrací na všechno kód 1001.
   *
   * Zdroj: interactivebrokers.com/docs/web-api/flex-web-service/
   * using-flex-web-service/generate-the-report; csingley/ibflex PR #108.
   */
  it('GetStatement jde vždy na dokumentovanou adresu, ne na <Url> z odpovědi', async () => {
    const mock = scriptedFetch({
      send: [
        sendOk(
          'https://gdcdyn.interactivebrokers.com/Universal/servlet/FlexStatementService.GetStatement',
        ),
      ],
      statements: [READY],
    });
    await client(mock.fetchImpl).fetchStatementXml({ pollIntervalMs: 1, maxAttempts: 2 });
    expect(mock.urls[1]!.startsWith(`${DOCUMENTED_BASE}/GetStatement?`)).toBe(true);
  });

  /**
   * 1013 „IP restriction“: token je omezený na IP adresu. Hostovaná instance
   * nemá pevnou odchozí adresu, takže takový token nebude fungovat nikdy —
   * a obecné „zkus to znovu“ uživatele nechá zkoušet donekonečna.
   *
   * Zdroj: interactivebrokers.com/docs/web-api/flex-web-service/error-codes.
   */
  it('kód 1013 řekne, že token je omezený na IP adresu', async () => {
    const mock = scriptedFetch({
      send: [failure('Fail', '1013', 'IP restriction.')],
      statements: [],
    });
    await expect(
      client(mock.fetchImpl).fetchStatementXml({ pollIntervalMs: 1, maxAttempts: 2 }),
    ).rejects.toThrow(/IP adres/);
  });

  /**
   * 1014 „Query is invalid“ je kód pro špatné Query ID. Klient ho nezná
   * (radu „zkontroluj Query ID“ má jen u 1003 a 1020), takže uživatel dostane
   * anglickou větu brokera a obecné „synchronizace se nepovedla“.
   *
   * Zdroj: tamtéž.
   */
  it('kód 1014 pošle uživatele zkontrolovat Query ID', async () => {
    const mock = scriptedFetch({
      send: [failure('Fail', '1014', 'Query is invalid.')],
      statements: [],
    });
    await expect(
      client(mock.fetchImpl).fetchStatementXml({ pollIntervalMs: 1, maxAttempts: 2 }),
    ).rejects.toThrow(/Query ID/);
  });

  /**
   * Kódy s dovětkem „Please try again shortly“ (1001, 1004–1009) jsou dočasné
   * stejně jako 1019. Klient z nich opakuje jen 1018, 1019 a 1021, ostatní
   * ukončí synchronizaci na první pokus.
   *
   * Zdroj: tamtéž (texty kódů).
   */
  it('dočasný kód 1001 u SendRequest se zkusí znovu', async () => {
    const mock = scriptedFetch({
      send: [
        failure(
          'Fail',
          '1001',
          'Statement could not be generated at this time. Please try again shortly.',
        ),
        sendOk(`${DOCUMENTED_BASE}/GetStatement`),
      ],
      statements: [READY],
    });
    const xml = await client(mock.fetchImpl).fetchStatementXml({
      pollIntervalMs: 1,
      maxAttempts: 3,
    });
    expect(xml).toContain('<FlexQueryResponse');
  });

  it('dočasný kód 1009 u GetStatement se zkusí znovu', async () => {
    const mock = scriptedFetch({
      send: [sendOk(`${DOCUMENTED_BASE}/GetStatement`)],
      statements: [
        failure(
          'Warn',
          '1009',
          'The server is under heavy load. Statement could not be generated at this time. Please try again shortly.',
        ),
        READY,
      ],
    });
    const xml = await client(mock.fetchImpl).fetchStatementXml({
      pollIntervalMs: 1,
      maxAttempts: 3,
    });
    expect(xml).toContain('<FlexQueryResponse');
  });

  /**
   * Když služba neodpovídá, jediný dotaz čeká 5 × 60 s + 75 s prodlev = 375 s.
   * To je víc než rozpočet běhu jobů (225 s) i strop funkce na hostingu
   * (300 s): funkci utne platforma a job zůstane viset do úklidu.
   * Doloženo kódem (`get()` v ibkr/api.ts), ne chováním brokera.
   */
  it('nedostupná služba vzdá čekání dřív, než vyprší rozpočet běhu (225 s)', async () => {
    vi.useFakeTimers();
    const hanging: typeof fetch = (() =>
      new Promise((_resolve, reject) => {
        setTimeout(() => reject(new DOMException('timeout', 'TimeoutError')), 60_000);
      })) as typeof fetch;
    let settled = false;
    const pending = client(hanging)
      .fetchStatementXml({ pollIntervalMs: 10_000, maxAttempts: 20 })
      .then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        },
      );
    await vi.advanceTimersByTimeAsync(225_000);
    const settledInBudget = settled;
    await vi.advanceTimersByTimeAsync(400_000);
    await pending;
    expect(settledInBudget).toBe(true);
  });
});
