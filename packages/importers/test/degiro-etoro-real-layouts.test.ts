import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { d, type Transaction } from '@danero/shared';
import { brokerIdKey, dedupeTransactions } from '../src';
import {
  isDegiroCsv,
  parseDegiroAccountCsv,
  parseDegiroTransactionsCsv,
} from '../src/degiro/csv';
import { ETORO_BROKER, parseEtoroXlsx } from '../src/etoro/xlsx';
import {
  buildEtoroXlsx,
  ETORO_ACTIVITY_HEADERS,
  ETORO_CLOSED_HEADERS,
  ETORO_DIVIDEND_HEADERS,
  type EtoroCellValue,
} from './fixtures/etoro';

/**
 * Degiro a eToro: tvary výpisů, jak je platformy opravdu posílají (audit
 * 13. 10. 2026). Komentáře u testů popisují vadu, kterou test hlídá — tedy
 * chování PŘED opravou z toho dne. Z cizích zdrojů je opsané jen rozložení (hlavičky,
 * názvy listů, znění popisů a typů); tituly, ISINy, čísla, časy i ID jsou
 * smyšlené.
 *
 * Zdroje, na které se komentáře odkazují:
 *  - PP = Portfolio Performance, testovací výpisy Degira převedené z PDF
 *    (`name.abuchen.portfolio.tests/.../pdf/degiro/*.txt`), mj. český
 *    `Prehleductu01.txt` a `Transakce01.txt` a anglický
 *    `Transactions_english02.txt` s řádky z prosince 2025 a ledna 2026
 *  - yardee = github.com/yardee/degiro-cz-taxes (český nástroj nad českým
 *    Account.csv, 4/2026)
 *  - jantobola = github.com/jantobola/degiro-tax-report (český nástroj nad
 *    Transactions.csv, 3/2026)
 *  - ETG = github.com/dickwolff/Export-To-Ghostfolio (`samples/degiro-export.csv`,
 *    `samples/etoro-export.csv`)
 *  - eToro API = api-portal.etoro.com (definice polí pozice)
 */

/* ── Degiro: společné hlavičky ───────────────────────────────────────────── */

/** Transactions.csv v rozložení od prosince 2025, anglicky (shodné s fixturou 2026 EN). */
const TX_HEADER_2026_EN =
  'Date,Time,Product,ISIN,Reference exchange,Venue,Quantity,Price,,Local value,,Value EUR,Exchange rate,AutoFX Fee,Transaction and/or third party fees EUR,Total EUR,Order ID,';

/** Account.csv anglicky. */
const ACCOUNT_HEADER_EN =
  'Date,Time,Value date,Product,ISIN,Description,FX,Change,,Balance,,Order Id';

/** Account.csv nizozemsky. */
const ACCOUNT_HEADER_NL =
  'Datum,Tijd,Valutadatum,Product,ISIN,Omschrijving,FX,Mutatie,,Saldo,,Order Id';

/** Account.csv německy. */
const ACCOUNT_HEADER_DE =
  'Datum,Uhrzeit,Valutadatum,Produkt,ISIN,Beschreibung,FX,Änderung,,Saldo,,Order-ID';

/**
 * Account.csv ČESKY tak, jak ho Degiro opravdu posílá (yardee,
 * `test_dane_degiro.py`; totéž hlavička českého PDF v PP `Prehleductu01.txt`):
 * sloupec se jmenuje „Pohyb“, ne „Změna“, zůstatek „Zůstatek“, ne „Saldo“,
 * datum valuty má hlavičku jen „Datum“ (název se tedy opakuje) a oddělovač je
 * čárka.
 */
const ACCOUNT_HEADER_CZ_REAL =
  'Datum,Čas,Datum,Produkt,ISIN,Popis,Kurz,Pohyb,,Zůstatek,,ID objednávky';

const lines = (...rows: string[]): string => rows.join('\n');

const ofType = <T extends Transaction['type']>(
  transactions: Transaction[],
  type: T,
): Array<Extract<Transaction, { type: T }>> =>
  transactions.filter((tx): tx is Extract<Transaction, { type: T }> => tx.type === type);

/* ── Degiro: Transactions.csv ────────────────────────────────────────────── */

describe('Degiro Transactions.csv: korporátní akce nejsou obchody', () => {
  /**
   * Štěpení, změnu ISIN i fúzi zapisuje Degiro do Transakcí jako dvojici
   * prodej + nákup: čas 00:00 (u změny ISIN i jiný), prázdné místo provedení
   * (Venue), žádný poplatek a žádné ID objednávky. Doloženo: PP
   * `Transactions_english02.txt` (23-12-2025 štěpení 1:3, 30-01-2026 fúze),
   * český `Transakce01.txt` (02-08-2021 reverzní štěpení se změnou ISIN,
   * 31-01-2022 změna ISIN) a pravidlo jantobola
   * (`time == "00:00" && venue.isBlank() && orderId.isBlank()`).
   *
   * Parser z nich dnes udělá SELL a BUY. Prodej je zdanitelná událost, čerpá
   * limit 100 000 Kč a nový nákup nuluje časový test — přitom se nic
   * neprodalo.
   */
  it('štěpení 1:3 (dva řádky v 00:00 bez Venue a bez ID objednávky) nevyrobí prodej', () => {
    const result = parseDegiroTransactionsCsv(
      lines(
        TX_HEADER_2026_EN,
        '03-03-2023,15:41,BOREALIS CORP,US0000000011,NSY,XNYS,4,600.0000,USD,-2400.00,USD,-2200.00,1.0909,-5.50,-2.00,-2207.50,7b1e0c52-0000-4000-8000-00000000c001,',
        '18-12-2025,00:00,BOREALIS CORP,US0000000011,NSY,,12,210.0000,USD,-2520.00,USD,-2150.00,1.1721,0.00,,-2150.00,,',
        '18-12-2025,00:00,BOREALIS CORP,US0000000011,NSY,,-4,630.0000,USD,2520.00,USD,2150.00,1.1721,0.00,,2150.00,,',
      ),
    );

    expect(ofType(result.transactions, 'SELL')).toEqual([]);
    // skutečný nákup z roku 2023 zůstává jediným nákupem
    expect(ofType(result.transactions, 'BUY')).toHaveLength(1);
    // a dvojice nesmí zmizet beze stopy: buď z ní vznikne korporátní akce,
    // nebo se o ní uživatel dozví
    const [split] = ofType(result.transactions, 'CORPORATE_ACTION');
    expect(split).toMatchObject({ subtype: 'SPLIT', isin: 'US0000000011', date: '2025-12-18' });
    expect(split?.ratio?.from.toString()).toBe('4');
    expect(split?.ratio?.to.toString()).toBe('12');
    expect(result.errors).toEqual([]);
  });

  it('změna ISIN (stejný počet kusů, jiný ISIN, bez Venue a bez ID objednávky) nevyrobí prodej', () => {
    const result = parseDegiroTransactionsCsv(
      lines(
        TX_HEADER_2026_EN,
        '30-01-2026,06:45,AURELIA NV A,NL0000000022,EAM,,150,20.0000,EUR,-3000.00,EUR,-3000.00,,0.00,,-3000.00,,',
        '30-01-2026,06:45,AURELIA PLC,GB0000000021,EAM,,-150,20.0000,EUR,3000.00,EUR,3000.00,,0.00,,3000.00,,',
      ),
    );

    expect(ofType(result.transactions, 'SELL')).toEqual([]);
    expect(ofType(result.transactions, 'BUY')).toEqual([]);
    const [change] = ofType(result.transactions, 'CORPORATE_ACTION');
    expect(change).toMatchObject({
      subtype: 'ISIN_CHANGE',
      isin: 'GB0000000021',
      newIsin: 'NL0000000022',
    });
    expect(result.errors).toEqual([]);
  });
});

describe('Degiro Transactions.csv: pojistky párování korporátních akcí', () => {
  const entry = (time: string, product: string, isin: string, quantity: string, price: string): string =>
    `30-01-2026,${time},${product},${isin},EAM,,${quantity},${price},EUR,0.00,EUR,0.00,,0.00,,0.00,,`;

  it('spojená akce ruší prodej a nákup, které se z týchž řádků ukládaly dřív', () => {
    const result = parseDegiroTransactionsCsv(
      lines(
        TX_HEADER_2026_EN,
        entry('00:00', 'BOREALIS CORP', 'US0000000011', '12', '210.0000'),
        entry('00:00', 'BOREALIS CORP', 'US0000000011', '-4', '630.0000'),
      ),
    );
    expect(ofType(result.transactions, 'CORPORATE_ACTION')).toHaveLength(1);
    // id obou nohou tak, jak je parser přiděloval jako obchodům
    expect(result.retracted).toHaveLength(2);
    expect(result.retracted?.every((event) => event.types.join() === 'BUY,SELL')).toBe(true);
  });

  it('dvě změny ISIN ve stejný okamžik se spárují podle hodnoty, ne křížem', () => {
    const result = parseDegiroTransactionsCsv(
      lines(
        TX_HEADER_2026_EN,
        entry('06:45', 'AURELIA PLC', 'GB0000000021', '-150', '20.0000'),
        entry('06:45', 'AURELIA NV A', 'NL0000000022', '150', '20.0000'),
        entry('06:45', 'MERIDIAN PLC', 'GB0000000031', '-40', '7.5000'),
        entry('06:45', 'MERIDIAN NV', 'NL0000000032', '40', '7.5000'),
      ),
    );
    expect(result.errors).toEqual([]);
    expect(
      ofType(result.transactions, 'CORPORATE_ACTION')
        .map((tx) => `${tx.isin}→${tx.newIsin}`)
        .sort(),
    ).toEqual(['GB0000000021→NL0000000022', 'GB0000000031→NL0000000032']);
  });

  it('nohy, které k sobě přiřadit nejde, skončí chybou — ne prodejem a nákupem', () => {
    const result = parseDegiroTransactionsCsv(
      lines(
        TX_HEADER_2026_EN,
        entry('06:45', 'AURELIA PLC', 'GB0000000021', '-150', '20.0000'),
        entry('06:45', 'MERIDIAN NV', 'NL0000000032', '40', '7.5000'),
      ),
    );
    expect(result.transactions).toEqual([]);
    expect(result.errors).toHaveLength(2);
    expect(result.errors.every((error) => error.knownUnsupported)).toBe(true);
  });

  it('stejný název a jiný ISIN s jiným počtem kusů je štěpení s novým ISIN, ne fúze', () => {
    const result = parseDegiroTransactionsCsv(
      lines(
        TX_HEADER_2026_EN,
        entry('00:00', 'BOREALIS CORP', 'US0000000011', '-600', '2.0000'),
        entry('00:00', 'BOREALIS CORP', 'US0000000099', '30', '40.0000'),
      ),
    );
    const [split] = ofType(result.transactions, 'CORPORATE_ACTION');
    expect(split).toMatchObject({ subtype: 'SPLIT', isin: 'US0000000011', newIsin: 'US0000000099' });
    expect(split?.ratio?.from.toString()).toBe('600');
    expect(split?.ratio?.to.toString()).toBe('30');
  });
});

describe('Degiro Transactions.csv: česká hlavička a deriváty', () => {
  /**
   * Český výpis Transakcí má cenu ve sloupci „Cena“ (ne „Kurz“), hodnotu
   * v „Hodnota v domácí měně“ a poplatek pod anglickým názvem. Doloženo
   * hlavičkou českého PDF (PP `Transakce01.txt`); u NL, EN a DE se názvy
   * sloupců v PDF a v CSV shodují, pro český CSV je to tedy silná domněnka,
   * ne přímý doklad.
   */
  it('český výpis se sloupcem „Cena“ se přečte', () => {
    const csv = lines(
      'Datum,Čas,Produkt,ISIN,Reference,Venue,Počet,Cena,,Hodnota v domácí měně,,Hodnota,,Směnný kurz,Transaction and/or third party fees,,Celkem,,ID objednávky',
      '08-09-2025,16:42,NORDWIND CORP,US0000000001,NSY,CDED,16,"14,82",USD,"-237,12",USD,"-232,29",EUR,"1,0208","-0,50",EUR,"-232,79",EUR,7b1e0c52-0000-4000-8000-00000000c002',
    );
    expect(isDegiroCsv(csv)).toBe('transactions');

    const result = parseDegiroTransactionsCsv(csv);
    expect(result.errors).toEqual([]);
    const [buy] = ofType(result.transactions, 'BUY');
    expect(buy?.quantity.toString()).toBe('16');
    expect(buy?.pricePerShare.toString()).toBe('14.82');
    expect(buy?.currency).toBe('USD');
    expect(buy?.fee?.amount.toString()).toBe('0.5');
  });

  /**
   * Opce a futures mají multiplikátor: počet × kurz NENÍ hodnota obchodu.
   * PP `Transaktionsuebersicht06.txt`: opce na DAX, 1 kontrakt za 30,00 EUR má
   * hodnotu −150,00 EUR. Parser hodnotu nečte, takže uloží nákup 1 ks za 30 —
   * nabývací cena i příjem vyjdou pětkrát (u amerických opcí stokrát) nižší
   * a kontrakt se navíc tváří jako akcie s časovým testem.
   */
  it('kontrakt s multiplikátorem: počet × kurz nesedí na hodnotu → ne tichý nákup za zlomek ceny', () => {
    const result = parseDegiroTransactionsCsv(
      lines(
        TX_HEADER_2026_EN,
        '06-02-2026,12:22,ODX2 C21200.00 06FEB26,DE000C00AAA1,ERX,XEUR,1,30.0000,EUR,-150.00,EUR,-150.00,,0.00,-0.90,-150.90,7b1e0c52-0000-4000-8000-00000000c003,',
      ),
    );

    const [buy] = ofType(result.transactions, 'BUY');
    if (buy === undefined) {
      // nedokážeme-li kontrakt zaúčtovat, musí to být vidět
      expect(result.errors.length + result.warnings.length).toBeGreaterThan(0);
      return;
    }
    expect(buy.quantity.mul(buy.pricePerShare).toString()).toBe('150');
  });
});

/* ── Degiro: Account.csv ─────────────────────────────────────────────────── */

describe('Degiro Account.csv: skutečná česká hlavička', () => {
  const csv = lines(
    ACCOUNT_HEADER_CZ_REAL,
    '12-03-2026,09:14,11-03-2026,NORDWIND CORP,US0000000001,Dividenda,,USD,"10,00",USD,"10,00",',
    '12-03-2026,09:14,11-03-2026,NORDWIND CORP,US0000000001,Daň z dividendy,,USD,"-1,50",USD,"8,50",',
    '10-03-2026,16:20,10-03-2026,,,Vklad,,CZK,"50 000,00",CZK,"50 000,00",',
  );

  it('sloupec „Pohyb“ (a zůstatek „Zůstatek“) se pozná jako Account.csv', () => {
    expect(isDegiroCsv(csv)).toBe('account');
  });

  it('dividenda se sraženou daní a vklad se naimportují', () => {
    const result = parseDegiroAccountCsv(csv);
    expect(result.errors).toEqual([]);

    const [dividend] = ofType(result.transactions, 'DIVIDEND');
    expect(dividend?.gross.toString()).toBe('10');
    expect(dividend?.withholdingTax.toString()).toBe('1.5');
    expect(dividend?.currency).toBe('USD');

    const [deposit] = ofType(result.transactions, 'DEPOSIT');
    expect(deposit?.amount.toString()).toBe('50000');
    expect(deposit?.currency).toBe('CZK');
  });
});

describe('Degiro Account.csv: popisy, které výpisy opravdu nesou', () => {
  /**
   * Každý z těchhle popisů dnes končí chybou „Neznámý popis pohybu … nahlaš
   * nám ho“. Jsou to přitom běžné řádky: poplatek za obchod má jeden na KAŽDÝ
   * obchod, převod na peněžní účet jeden na každou dividendu a vklad. Anglický
   * i český výpis tak vrací desítky až stovky chyb.
   *
   * Znění: PP `AccountStatement02.txt` (EN, do 12/2024), `Prehleductu01.txt`
   * (CZ — poplatek za obchod a převod na peněžní účet jsou v českém výpisu
   * anglicky), `AccountStatement_french01.txt` (FR, do 5/2026),
   * `Kontoauszug16.txt`/`17.txt` (DE, 2025), yardee (CZ).
   */
  const KNOWN: Array<[label: string, header: string, row: string]> = [
    [
      'EN i CZ: poplatek za obchod',
      ACCOUNT_HEADER_EN,
      '19-10-2025,09:41,19-10-2025,NORDWIND CORP,US0000000001,DEGIRO Transaction and/or third party fees,,EUR,"-2,00",EUR,"199,55",7b1e0c52-0000-4000-8000-00000000d001',
    ],
    [
      'CZ: poplatek za obchodování na zahraničních burzách',
      ACCOUNT_HEADER_EN,
      '03-01-2026,14:01,31-12-2025,,,DEGIRO poplatek za Obchodování na zahraničních burzách 2026 (Xetra - XET),,EUR,"-2,50",EUR,"215,47",',
    ],
    [
      'DE: poplatek za burzu (znění z roku 2025)',
      ACCOUNT_HEADER_DE,
      '03-02-2025,08:00,31-01-2025,,,Einrichtung von Handelsmodalitäten 2025 (Xetra - XET),,EUR,"-2,50",EUR,"88,40",',
    ],
    [
      'EN i CZ: převod Z peněžního účtu (částka jen v popisu)',
      ACCOUNT_HEADER_EN,
      '04-01-2026,05:36,03-01-2026,,,"Transfer from your Cash Account at flatex Bank: 8,25 EUR",,,,EUR,"210,47",',
    ],
    [
      'EN i CZ: převod NA peněžní účet (částka jen v popisu)',
      ACCOUNT_HEADER_EN,
      '30-12-2025,20:04,30-12-2025,,,"Transfer to your Cash Account at flatex Bank: 41,10 EUR",,,,EUR,"217,97",',
    ],
    [
      'FR: převod na peněžní účet',
      ACCOUNT_HEADER_EN,
      '08-05-2026,07:33,08-05-2026,,,"Virement vers votre Compte Espèces à la flatexDEGIRO Bank: 19,40 EUR",,,,EUR,"54,32",',
    ],
    [
      'FR: směna měn — připsání',
      ACCOUNT_HEADER_EN,
      '08-05-2026,06:31,07-05-2026,,,Operation de change - Crédit,,EUR,"19,40",EUR,"31,73",',
    ],
    [
      'FR: směna měn — odepsání',
      ACCOUNT_HEADER_EN,
      '08-05-2026,06:31,07-05-2026,,,Opération de change - Débit,"10,908",SEK,"-211,60",SEK,"0,00",',
    ],
    [
      'EN: poplatek za ADR',
      ACCOUNT_HEADER_EN,
      '17-10-2025,13:51,16-10-2025,ADR ON NORDWIND,US0000000051,ADR/GDR Pass-Through Fee,,EUR,"-0,31",EUR,"12,47",',
    ],
    [
      'DE: poplatek za ADR',
      ACCOUNT_HEADER_DE,
      '23-10-2025,14:59,21-10-2025,ADR ON NORDWIND,US0000000051,ADR/GDR Weitergabegebühr,,USD,"-0,09",USD,"1,08",',
    ],
    [
      'DE: poplatek za korporátní akci',
      ACCOUNT_HEADER_DE,
      '11-06-2025,07:30,10-06-2025,,,Gebühr für Kapitalmaßnahme,,EUR,"-1,00",EUR,"87,40",',
    ],
    [
      'CZ: konverze peněžního fondu (historie do roku 2021)',
      ACCOUNT_HEADER_EN,
      '13-09-2021,12:01,09-09-2021,FUNDSHARE UCITS EUR CASH FUND,NL0010661914,"Konverze Peněžního Fondu: Prodej 2,1140 v 0,9761 EUR",,EUR,"-0,01",EUR,"3,01",',
    ],
    [
      'CZ: změna ceny peněžního fondu (historie do roku 2021)',
      ACCOUNT_HEADER_EN,
      '15-07-2021,00:00,14-07-2021,FUNDSHARE UCITS EUR CASH FUND,NL0010661914,Změna ceny Peněžního Fondu (EUR),,EUR,"-0,02",EUR,"24,58",',
    ],
  ];

  it.each(KNOWN)('%s neskončí jako „neznámý popis“', (_label, header, row) => {
    const result = parseDegiroAccountCsv(lines(header, row));
    expect(result.errors).toEqual([]);
  });

  /**
   * Vrácení kapitálu má v modelu vlastní příznak (R-07h), ale z výpisu Degira
   * se k němu řádek nedostane — skončí jako neznámý popis. Znění: yardee
   * („Vratka kapitálu“), PP `Kontoauszug09.txt` („Kapitalrückzahlung“).
   */
  it.each([
    ['CZ', ACCOUNT_HEADER_EN, 'Vratka kapitálu'],
    ['DE', ACCOUNT_HEADER_DE, 'Kapitalrückzahlung'],
  ])('%s vrácení kapitálu → výplata s příznakem returnOfCapital', (_label, header, description) => {
    const result = parseDegiroAccountCsv(
      lines(
        header,
        `14-05-2025,08:10,13-05-2025,MERIDIAN REIT,BM0000000061,${description},,USD,"3,20",USD,"3,20",`,
      ),
    );
    expect(result.errors).toEqual([]);
    const [payout] = ofType(result.transactions, 'DIVIDEND');
    expect(payout?.gross.toString()).toBe('3.2');
    expect(payout?.returnOfCapital).toBe(true);
  });
});

describe('Degiro Account.csv: korporátní akce ve tvaru, který Degiro opravdu píše', () => {
  /**
   * Parser páruje nohy podle slov „Uitboeking/Inboeking“, „Odpis/Připis“,
   * „Removal/Addition“. Žádný dohledaný výpis je neobsahuje: Degiro píše
   * `PREFIX: <sloveso obchodu> <počet> …` a nohy NESOU částku. Doloženo: PP
   * `Kontoauszug15.txt` („AKTIENSPLIT: Kauf 40 zu je … / Verkauf 2 zu je …“),
   * `Kontoauszug11.txt` („ISIN-ÄNDERUNG: Kauf/Verkauf“), yardee („Stock
   * split: Nákup/Prodej“, „Merger:“, „Změna produktu:“).
   *
   * Dnes každá noha skončí chybou „z popisu nepoznáme, jestli jde o odpis,
   * nebo připis kusů“, přestože směr i počet v popisu jsou.
   */
  it.each([
    [
      'DE „AKTIENSPLIT: Kauf/Verkauf“',
      ACCOUNT_HEADER_DE,
      '"AKTIENSPLIT: Kauf 12 zu je 210 USD (US0000000011)"',
      '"AKTIENSPLIT: Verkauf 4 zu je 630 USD"',
    ],
    [
      'CZ „Stock split: Nákup/Prodej“',
      ACCOUNT_HEADER_EN,
      '"Stock split: Nákup 12 Borealis Corp@210 USD (US0000000011)"',
      '"Stock split: Prodej 4 Borealis Corp@630 USD (US0000000011)"',
    ],
  ])('%s → přeskočí se s odkazem na Transactions.csv', (_label, header, buyLeg, sellLeg) => {
    const result = parseDegiroAccountCsv(
      lines(
        header,
        `18-12-2025,08:04,18-12-2025,BOREALIS CORP,US0000000011,${buyLeg},,USD,"-2520,00",USD,"0,00",`,
        `18-12-2025,08:04,18-12-2025,BOREALIS CORP,US0000000011,${sellLeg},,USD,"2520,00",USD,"2520,00",`,
      ),
    );

    // Tatáž akce je v Transactions.csv (dvojice bez Venue a ID objednávky),
    // odkud se bere — z obou souborů by vznikla dvakrát.
    expect(result.errors).toEqual([]);
    expect(result.transactions).toEqual([]);
    expect(result.skipped).toHaveLength(2);
    expect(result.skipped[0]!.message).toContain('Transactions.csv');
  });
});

describe('Degiro Account.csv: řádek rozlomený do dvou', () => {
  /**
   * Dlouhou buňku Degiro láme: zbytek (tady konec ID objednávky, jindy konec
   * popisu) je na dalším řádku, který má všechny ostatní buňky prázdné.
   * Doloženo: ETG `samples/degiro-export.csv`, řádky 18–19. Pokračování dnes
   * skončí chybou „Neplatné datum „“ (očekáván formát dd-MM-yyyy)“ — o datu,
   * které v řádku nemá být.
   */
  it('pokračování řádku není chyba „neplatné datum“', () => {
    const result = parseDegiroAccountCsv(
      lines(
        ACCOUNT_HEADER_NL,
        '15-12-2025,16:55,15-12-2025,NORDWIND CORP,US0000000001,Valuta Creditering,"1,0624",USD,"41,20",USD,"0,00",7b1e0c52-0000-4000-',
        ',,,,,,,,,,,8000-00000000d002',
        '15-12-2025,16:55,15-12-2025,NORDWIND CORP,US0000000001,Valuta Debitering,,EUR,"-38,78",EUR,"0,07",7b1e0c52-0000-4000-8000-00000000d002',
      ),
    );
    expect(result.errors).toEqual([]);
  });
});

describe('Degiro Account.csv: storno a oprava dividendy', () => {
  /**
   * Degiro opravuje dividendu protizápisem: záporná „Dividend“ a KLADNÁ
   * „Dividendbelasting“ (vrácená srážka). Doloženo: PP `EstadoDeCuenta01.txt`
   * (07-11-2022, plné storno týž den), `Kontoauszug08.txt` (02-05-2019,
   * přeúčtovaná srážka), dále 2021, 2024 a 2025 v dalších výpisech.
   *
   * Parser zápornou dividendu jen ohlásí a původní nechá stát, a vrácenou
   * srážku bere v absolutní hodnotě jako srážku — takže stornovaná výplata
   * zůstane v příjmech § 8 i se zápočtem daně, která se vrátila.
   */
  it('plně stornovaná dividenda (± dividenda, ± srážka týž den) nezůstane v příjmech', () => {
    const result = parseDegiroAccountCsv(
      lines(
        ACCOUNT_HEADER_NL,
        '07-11-2025,09:59,02-11-2025,MERIDIAN SA,ES0000000031,Dividend,,EUR,"-120,00",EUR,"500,00",',
        '07-11-2025,09:59,02-11-2025,MERIDIAN SA,ES0000000031,Dividendbelasting,,EUR,"22,80",EUR,"620,00",',
        '07-11-2025,07:28,02-11-2025,MERIDIAN SA,ES0000000031,Dividend,,EUR,"120,00",EUR,"597,20",',
        '07-11-2025,07:28,02-11-2025,MERIDIAN SA,ES0000000031,Dividendbelasting,,EUR,"-22,80",EUR,"477,20",',
      ),
    );

    const gross = ofType(result.transactions, 'DIVIDEND').reduce(
      (sum, dividend) => sum.plus(dividend.gross),
      d(0),
    );
    expect(gross.toString()).toBe('0');
  });

  it('přeúčtovaná srážka (−2,20, +2,20, −1,25) dá srážku 1,25, ne 2,20', () => {
    const result = parseDegiroAccountCsv(
      lines(
        ACCOUNT_HEADER_DE,
        '02-05-2025,08:20,02-05-2025,NORDWIND NV,NL0000000071,Dividendensteuer,,EUR,"2,20",EUR,"129,07",',
        '02-05-2025,08:20,02-05-2025,NORDWIND NV,NL0000000071,Dividendensteuer,,EUR,"-1,25",EUR,"126,87",',
        '02-05-2025,07:50,02-05-2025,NORDWIND NV,NL0000000071,Dividende,,EUR,"8,36",EUR,"107,05",',
        '02-05-2025,07:50,02-05-2025,NORDWIND NV,NL0000000071,Dividendensteuer,,EUR,"-2,20",EUR,"98,69",',
      ),
    );

    const dividends = ofType(result.transactions, 'DIVIDEND');
    expect(dividends).toHaveLength(1);
    expect(dividends[0]!.gross.toString()).toBe('8.36');
    expect(dividends[0]!.withholdingTax.toString()).toBe('1.25');
  });
});

/* ── eToro ───────────────────────────────────────────────────────────────── */

const closedRow = (values: Record<string, EtoroCellValue>): EtoroCellValue[] =>
  ETORO_CLOSED_HEADERS.map((header) => values[header] ?? '');
const activityRow = (values: Record<string, EtoroCellValue>): EtoroCellValue[] =>
  ETORO_ACTIVITY_HEADERS.map((header) => values[header] ?? '');
const dividendRow = (values: Record<string, EtoroCellValue>): EtoroCellValue[] =>
  ETORO_DIVIDEND_HEADERS.map((header) => values[header] ?? '');

/** Peněžní tok páru transakcí jedné pozice v měně transakcí: prodej +, nákup −. */
const cashFlow = (transactions: Transaction[]): string =>
  transactions
    .reduce((sum, tx) => {
      if (tx.type === 'SELL') return sum.plus(tx.quantity.mul(tx.pricePerShare));
      if (tx.type === 'BUY') return sum.minus(tx.quantity.mul(tx.pricePerShare));
      return sum;
    }, d(0))
    .toDecimalPlaces(2)
    .toString();

describe('eToro Closed Positions: kurz je v měně instrumentu, ne v USD', () => {
  /**
   * „Open Rate“ a „Close Rate“ jsou ceny v měně, ve které se titul kotuje
   * (eToro API: `openRate` = „Entry price of the position in the instrument's
   * currency“; ETG vzorek nese v Details `KER/EUR`, konvertor zná i `…/GBX`).
   * V USD je jen „Amount“ (investovaná částka) a „Profit(USD)“ — z těch dvou
   * počítají náklad a příjem všechny dohledané daňové nástroje nad výpisem
   * eToro (CZ jetcz/eToroAccountStatementProcessor, IE, FI, RO).
   *
   * Parser bere kurz a nálepkuje ho USD. U titulu v eurech je chyba kolem
   * 10 %, u pencí (GBX) a jenů řádová.
   */
  it('akcie kotovaná v EUR: nákup stojí Amount v USD a prodej Amount + Profit(USD)', async () => {
    const buffer = await buildEtoroXlsx({
      closed: {
        rows: [
          closedRow({
            'Position ID': '2700000001',
            Action: 'Buy Nordwind SE (NWD.DE)',
            'Long / Short': 'Long',
            Amount: 220,
            'Units / Contracts': 1,
            'Open Date': '03/02/2025 10:00:00',
            'Close Date': '05/06/2025 10:00:00',
            Leverage: 1,
            'Profit(USD)': 11,
            'FX rate at open (USD)': 1.1,
            'FX rate at close (USD)': 1.05,
            'Open Rate': 200,
            'Close Rate': 220,
            Type: 'Stocks',
            ISIN: 'DE0000000041',
          }),
        ],
      },
    });
    const result = await parseEtoroXlsx(buffer);
    const [buy] = ofType(result.transactions, 'BUY');
    const [sell] = ofType(result.transactions, 'SELL');
    if (!buy || !sell) throw new Error('pozice se nenaimportovala');

    // Správně jsou obě cesty: částky v USD podle Amount a Profit(USD), nebo
    // kurz ponechaný v měně instrumentu. Špatně je kurz v EUR vydávaný za USD.
    if (buy.currency === 'USD') {
      expect(buy.quantity.mul(buy.pricePerShare).toDecimalPlaces(2).toString()).toBe('220');
      expect(sell.quantity.mul(sell.pricePerShare).toDecimalPlaces(2).toString()).toBe('231');
    } else {
      expect(buy.currency).toBe('EUR');
      expect(sell.currency).toBe('EUR');
    }
  });

  it('měnový pár USD/JPY: výsledek pozice odpovídá Profit(USD), ne rozdílu kurzů v jenech', async () => {
    const buffer = await buildEtoroXlsx({
      closed: {
        rows: [
          closedRow({
            'Position ID': '2700000002',
            Action: 'Buy USD/JPY',
            'Long / Short': 'Long',
            Amount: 100,
            'Units / Contracts': 1000,
            'Open Date': '03/02/2025 10:00:00',
            'Close Date': '04/02/2025 10:00:00',
            Leverage: 10,
            'Profit(USD)': 6.62,
            'Open Rate': 150,
            'Close Rate': 151,
            Type: 'Currency',
          }),
        ],
      },
    });
    const result = await parseEtoroXlsx(buffer);
    const legs = result.transactions.filter((tx) => tx.id.startsWith('etoro-2700000002-'));
    expect(legs).toHaveLength(2);

    const currency = legs[0]!.type === 'BUY' || legs[0]!.type === 'SELL' ? legs[0]!.currency : '';
    // rozdíl 1 000 je v jenech; v USD je to 6,62
    if (currency === 'USD') expect(cashFlow(legs)).toBe('6.62');
    else expect(currency).toBe('JPY');
  });
});

describe('eToro: otevřená derivátová pozice z Account Activity', () => {
  /**
   * U pákové a krátké pozice je „Amount“ jen složená marže a „Units“ počet
   * kusů celé expozice (eToro API: `amount` = „USD amount allocated to the
   * position“, `leverage` = „Leverage multiplier applied to the position“).
   * `Amount / Units` tedy není cena, ale cena dělená pákou — a Account
   * Activity navíc neříká směr, takže i short se uloží jako nákup.
   *
   * Jakmile se pozice v dalším výpisu zavře, druhá síť dedupe (id pozice)
   * nechá stát už uloženou otevírací nohu. Výsledek pozice je pak nesmysl.
   * Otevřený derivát přitom žádný daňový dopad nemá (R-12e) a u MetaTraderu
   * se neimportuje vůbec (R-12r).
   */
  const importOverTwoStatements = async (
    first: Buffer,
    second: Buffer,
    positionId: string,
  ): Promise<Transaction[]> => {
    const stored = dedupeTransactions(ETORO_BROKER, (await parseEtoroXlsx(first)).transactions);
    const next = dedupeTransactions(
      ETORO_BROKER,
      (await parseEtoroXlsx(second)).transactions,
      stored.fresh.map((entry) => entry.key),
      stored.fresh.map((entry) => brokerIdKey(ETORO_BROKER, entry.tx)),
    );
    return [...stored.fresh, ...next.fresh]
      .map((entry) => entry.tx)
      .filter((tx) => tx.id.startsWith(`etoro-${positionId}-`));
  };

  const openActivity = (positionId: string): EtoroCellValue[] =>
    activityRow({
      Date: '10/11/2025 15:30:00',
      Type: 'Open Position',
      Details: 'NWD/USD',
      Amount: 100,
      Units: 5,
      'Realized Equity Change': 0,
      'Realized Equity': 1000,
      Balance: 900,
      'Position ID': positionId,
      'Asset type': 'CFD',
      NWA: 0,
    });

  it('long s pákou 5 otevřený v jednom výpisu a zavřený v dalším dá výsledek Profit(USD)', async () => {
    const first = await buildEtoroXlsx({ activity: { rows: [openActivity('2800000001')] } });
    const second = await buildEtoroXlsx({
      closed: {
        rows: [
          closedRow({
            'Position ID': '2800000001',
            Action: 'Buy Nordwind Corp (NWD)',
            'Long / Short': 'Long',
            Amount: 100,
            'Units / Contracts': 5,
            'Open Date': '10/11/2025 15:30:00',
            'Close Date': '12/01/2026 15:30:00',
            Leverage: 5,
            'Profit(USD)': 25,
            'Open Rate': 100,
            'Close Rate': 105,
            Type: 'CFD',
          }),
        ],
      },
    });

    // 5 kusů × (105 − 100) = 25 USD
    expect(cashFlow(await importOverTwoStatements(first, second, '2800000001'))).toBe('25');
  });

  it('short otevřený v jednom výpisu a zavřený v dalším nenechá po sobě nákup navíc', async () => {
    const first = await buildEtoroXlsx({ activity: { rows: [openActivity('2800000002')] } });
    const second = await buildEtoroXlsx({
      closed: {
        rows: [
          closedRow({
            'Position ID': '2800000002',
            Action: 'Sell Nordwind Corp (NWD)',
            'Long / Short': 'Short',
            Amount: 100,
            'Units / Contracts': 5,
            'Open Date': '10/11/2025 15:30:00',
            'Close Date': '12/01/2026 15:30:00',
            Leverage: 5,
            'Profit(USD)': 25,
            'Open Rate': 100,
            'Close Rate': 95,
            Type: 'CFD',
          }),
        ],
      },
    });

    const legs = await importOverTwoStatements(first, second, '2800000002');
    expect(legs.map((tx) => tx.type).sort()).toEqual(['BUY', 'SELL']);
    // 5 kusů × (100 − 95) = 25 USD
    expect(cashFlow(legs)).toBe('25');
  });
});

describe('eToro Dividends: řádek typu CFD není dividenda se zápočtem', () => {
  /**
   * List Dividends nese sloupec Type a u pozice přes CFD jde o dividendovou
   * úpravu z derivátového kontraktu — příjem § 10 (R-12a: „nikdy § 8“).
   * „Withholding Tax“ u ní není daň zaplacená cizímu státu, takže ji nejde
   * započíst (R-07c). Parser Type nečte a uloží DIVIDEND se sraženou daní.
   * Výklad je na docs/02; minimum je, aby řádek neprošel tiše.
   */
  it('dividendová úprava u CFD se neuloží jako DIVIDEND se sraženou daní', async () => {
    const buffer = await buildEtoroXlsx({
      dividends: {
        rows: [
          dividendRow({
            'Date of Payment': '14/03/2025',
            'Instrument Name': 'NWD/USD',
            'Net Dividend Received (USD)': 0.7,
            'Withholding Tax Rate (%)': 30,
            'Withholding Tax Amount (USD)': 0.3,
            'Position ID': '2800000003',
            Type: 'CFD',
            ISIN: '',
          }),
        ],
      },
    });
    const result = await parseEtoroXlsx(buffer);

    // R-12t: plnění z derivátu (§ 10), ne dividenda (§ 8) a bez zápočtu daně —
    // připsaných 0,70 USD je příjem druhu: otevření za 0, uzavření za 0,70
    expect(ofType(result.transactions, 'DIVIDEND')).toEqual([]);
    const legs = result.transactions.filter(
      (tx) => (tx.type === 'BUY' || tx.type === 'SELL') && tx.assetClass === 'DERIVATIVE',
    );
    expect(legs).toHaveLength(2);
    expect(cashFlow(legs)).toBe('0.7');
    expect(result.errors).toEqual([]);
  });
});

describe('eToro Account Activity: typy, které nejsou daňová událost', () => {
  /**
   * Zrušený výběr a začátek/konec kopírování jiného investora dnes končí
   * chybou „Neznámý typ operace … nahlaš nám ho“. Znění typů:
   * Hhanuska/etoro-tax-assistant (5/2026) a VladDuncea/InvestmentExportParser
   * (4/2026).
   */
  it.each([
    ['Withdraw Request Cancelled', 100.11],
    ['Withdraw Fee Cancelled', 5],
    ['Start Copy', -500],
    ['Stop Copy', 512.4],
  ])('„%s“ se přeskočí s vysvětlením, není to chyba', async (type, amount) => {
    const buffer = await buildEtoroXlsx({
      activity: {
        rows: [
          activityRow({
            Date: '03/02/2025 13:09:09',
            Type: type,
            Details: '-',
            Amount: amount,
            Units: '-',
            'Realized Equity Change': 0,
            'Realized Equity': 1000,
            Balance: 1000,
            'Position ID': '-',
            NWA: 0,
          }),
        ],
      },
    });
    const result = await parseEtoroXlsx(buffer);
    expect(result.errors).toEqual([]);
    expect(result.skipped).toHaveLength(1);
  });
});

describe('eToro Account Activity: poměr štěpení je ve výpisu', () => {
  /**
   * Řádek „corp action: Split“ nese poměr v Details („NVDA/USD 10:1“) a kusy
   * dříve otevřené pozice jsou v Account Activity PŘED štěpením. Doloženo:
   * github.com/McKeev/etoro-portfolio-analysis, `account_activity_seeded.csv`
   * (skutečný výpis s přenásobenými částkami, 2024).
   *
   * Parser dnes tvrdí opak — „eToro výpis neuvádí poměr splitu“ — a nechá
   * uživatele poměr dohledávat jinde.
   */
  it('poměr z Details se použije, nebo aspoň zazní; hláška netvrdí, že ve výpisu není', async () => {
    const buffer = await buildEtoroXlsx({
      activity: {
        rows: [
          activityRow({
            Date: '23/05/2025 13:31:00',
            Type: 'Open Position',
            Details: 'NWD/USD',
            Amount: 1300,
            Units: 1.3,
            'Realized Equity Change': 0,
            'Realized Equity': 5000,
            Balance: 800,
            'Position ID': '2900000001',
            'Asset type': 'Stocks',
            NWA: 0,
          }),
          activityRow({
            Date: '09/06/2025 06:17:00',
            Type: 'corp action: Split',
            Details: 'NWD/USD 10:1',
            Amount: 0,
            Units: '-',
            'Realized Equity Change': 0,
            'Realized Equity': 5000,
            Balance: 0,
            'Position ID': '2900000001',
            'Asset type': 'Stocks',
            NWA: 0,
          }),
        ],
      },
    });
    const result = await parseEtoroXlsx(buffer, { NWD: { isin: 'US0000000001' } });

    const [split] = ofType(result.transactions, 'CORPORATE_ACTION');
    const messages = [...result.warnings, ...result.errors].map((entry) => entry.message);
    if (split === undefined) {
      expect(messages.some((message) => message.includes('10:1'))).toBe(true);
    } else {
      expect(split.subtype).toBe('SPLIT');
      expect(split.ratio?.from.toString()).toBe('1');
      expect(split.ratio?.to.toString()).toBe('10');
    }
    expect(messages.some((message) => message.includes('neuvádí poměr'))).toBe(false);
  });
});

describe('eToro: výpis v jiném jazyce než v angličtině', () => {
  /**
   * eToro sešit překládá do jazyka rozhraní — i názvy listů a sloupců.
   * Doloženo: sebv593/etoro-taxdown-etl čte španělský sešit podle listů
   * „Posiciones cerradas“ a „Dividendos“ a sloupců „Fecha de apertura“,
   * „Fecha de cierre“; Koinly i Coinpanda v návodu píšou, že umí jen anglickou
   * verzi a že si má uživatel jazyk před exportem přepnout.
   *
   * Náš parser zná jen angličtinu a uživateli s českým rozhraním řekne, že
   * soubor „nevypadá jako výpis z eToro“. Správně má říct, co udělat.
   */
  it('sešit se španělskými listy dostane radu přepnout eToro do angličtiny', async () => {
    const workbook = new ExcelJS.Workbook();
    workbook
      .addWorksheet('Posiciones cerradas')
      .addRow(['Fecha de apertura', 'Fecha de cierre', 'Acción', 'Tipo', 'ISIN']);
    workbook.addWorksheet('Dividendos').addRow(['Fecha de pago', 'Nombre del instrumento']);
    const raw = await workbook.xlsx.writeBuffer();
    const buffer = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer);

    const result = await parseEtoroXlsx(buffer);
    expect(result.transactions).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toMatch(/anglič/i);
  });
});
