import { describe, expect, it } from 'vitest';
import { detectAndParse } from '@/lib/import-service';

/**
 * Charles Schwab a Revolut (audit 13. 10. 2026) — webová vrstva: co uvidí
 * uživatel, který nahraje soubor z té správné platformy, ale ne ten, který
 * čteme.
 *
 * Do toho dne všechny tyhle soubory končily u obecného „Formát souboru
 * nepoznáváme — v hlavičce jsme našli: …“ (`knownOtherStatement`).
 * Hlavičky jsou převzaté z veřejných zdrojů uvedených u testu; řádky s daty
 * jsou smyšlené.
 */

/** Obecná věta poslední záchrany — u souboru, který umíme pojmenovat, nestačí. */
const GENERIC = 'Formát souboru nepoznáváme';

describe('Schwab: výpis z účtu Equity Awards (akcie od zaměstnavatele)', () => {
  /**
   * Zdroj rozložení: KapJI/capital-gains-calculator (cgt-calc),
   * `docs/brokers/schwab.md`, oddíl „Equity awards“, a testovací data
   * `tests/schwab/data/rsu_settlement/awards.csv` (cenový export),
   * `tests/schwab/data/equity_award/schwab_equity_award_v2.example.csv`
   * (úplný export) a `…/schwab_equity_award_v2.json` (JSON).
   *
   * RSU a ESPP jsou u českých uživatelů nejčastější důvod, proč Schwab mají,
   * a katalog říká, že tenhle výpis nečteme. Kdo ho přesto nahraje, má se
   * dozvědět právě tohle — ne obecné „nepoznáváme“ se seznamem sloupců.
   */
  const awardPriceCsv = [
    '"Date","Action","Symbol","Description","Quantity","FeesAndCommissions","DisbursementElection","Amount","AwardDate","AwardId","FairMarketValuePrice","SalePrice","SharesSoldWithheldForTaxes","NetSharesDeposited","Taxes"',
    '"05/20/2025","Lapse","ABCD","Restricted Stock Lapse","60","","","","","","","","","",""',
    '"","","","","","","","","02/14/2023","900001234","$82.15","","24","36","$1,971.60"',
  ].join('\n');

  const completeCsv = [
    '"Date","Action","Symbol","Description","Quantity","FeesAndCommissions","DisbursementElection","Amount","Type","Shares","SalePrice","SubscriptionDate","SubscriptionFairMarketValue","PurchaseDate","PurchasePrice","PurchaseFairMarketValue","DispositionType","GrantId","VestDate","VestFairMarketValue","GrossProceeds","AwardDate","AwardId"',
    '"05/22/2025","Deposit","ABCD","RS","36","","","","","","","","","","","","","","","","","",""',
    '"","","","","","","","","","","","","","","","","","","","","","02/14/2023","900001234"',
  ].join('\n');

  const json = JSON.stringify(
    {
      FromDate: '01/01/2025',
      ToDate: '06/30/2025',
      Transactions: [
        {
          Date: '05/22/2025',
          Action: 'Deposit',
          Symbol: 'ABCD',
          Quantity: '36',
          Description: 'RS',
          FeesAndCommissions: null,
          DisbursementElection: null,
          Amount: null,
          TransactionDetails: [],
        },
      ],
    },
    null,
    2,
  );

  it.each([
    ['cenový export (CSV s FairMarketValuePrice)', awardPriceCsv],
    ['úplný export (CSV s VestFairMarketValue)', completeCsv],
    ['export ve formátu JSON', json],
  ])('%s: zaúčtuje se, nebo dostane větu o Equity Awards', (_label, text) => {
    const result = detectAndParse(text);

    if (result.transactions.length > 0) return; // přečteno — taky dobře
    const message = result.errors[0]?.message ?? '';
    expect(message).toMatch(/Equity Award/i);
    expect(message).not.toContain(GENERIC);
  });
});

describe('Schwab: výpis z bankovního (šekového) účtu', () => {
  /**
   * Parser Schwabu má pro bankovní export hotovou větu („Tohle je výpis
   * z bankovního (šekového) účtu Schwab — … nahraj export transakcí
   * z investičního účtu“), jenže sniffer ho k parseru nepustí (chybí „Fees &
   * Comm“), takže je dosažitelná jen z unit testu. Stejná třída jako YTD
   * export Tastytrade z auditu 12. 8. 2026.
   *
   * Zdroj hlavičky: vlastní fixtura `SCHWAB_BANK` v
   * `packages/importers/test/fixtures/schwab.ts`.
   */
  it('dostane větu o bankovním účtu, ne obecné „nepoznáváme“', () => {
    const bank = [
      '"Date","Type","Check #","Description","Withdrawal (-)","Deposit (+)","RunningBalance"',
      '"03/04/2025","ACH","","XYZ PAYMENT","","$250.00","$250.00"',
    ].join('\n');
    const message = detectAndParse(bank).errors[0]?.message ?? '';

    expect(message).toMatch(/bankovní/i);
    expect(message).not.toContain(GENERIC);
  });
});

describe('Revolut: výpis z běžného účtu (i spoření a „Flexible“)', () => {
  /**
   * Zdroj hlavičky: lastunicorn/revolut-toolkit, README, oddíl „Export
   * Statement CSV File“ (stav 26. 6. 2026) — výpis účtu z webové aplikace,
   * volba „Excel“, která vrací CSV.
   *
   * Je to první soubor, na který uživatel Revolutu narazí (tlačítko
   * „Statement“ u účtu), a nese i úroky ze spoření. Nečteme ho; má dostat
   * větu, která ho pošle pro „Account statement“ z Invest / Crypto, a pokud
   * mu jde o úroky, k univerzální šabloně.
   */
  it('dostane větu, která pojmenuje Revolut a správný výpis', () => {
    const statement = [
      'Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance',
      'INTEREST,Savings,2025-03-01 02:11:07,2025-03-01 02:11:07,Gross interest,1.84,0.00,EUR,COMPLETED,2501.84',
      'TOPUP,Current,2025-03-02 09:30:00,2025-03-02 09:30:11,Top-Up by *1234,500.00,0.00,EUR,COMPLETED,812.40',
    ].join('\n');
    const result = detectAndParse(statement);

    if (result.transactions.length > 0) return; // přečteno — taky dobře
    const message = result.errors[0]?.message ?? '';
    expect(message).toMatch(/Revolut/);
    expect(message).not.toContain(GENERIC);
  });
});
