import { createRequire } from 'node:module';
import { beforeAll, describe, expect, it } from 'vitest';
import { createPgliteDb, type Db } from '@/db';
import { user } from '@/db/schema';
import { PLATFORMS } from '@/lib/brokers-catalog';
import { detectAndParse, importFileIsolated } from '@/lib/import-service';

/**
 * Degiro a eToro (audit 13. 10. 2026) — webová vrstva: autodetekce a návod
 * v katalogu. Komentáře popisují vadu, kterou test hlídá. Parserová část
 * a odkazy na zdroje jsou v
 * `packages/importers/test/degiro-etoro-real-layouts.test.ts`.
 */

/** Minimum z API exceljs, které test potřebuje. */
interface WorkbookBuilder {
  addWorksheet(name: string): { addRow(values: string[]): unknown };
  xlsx: { writeBuffer(): Promise<ArrayBuffer | Buffer> };
}

/**
 * exceljs je závislost balíčku importérů, ne webu — sešit se tu proto staví
 * knihovnou půjčenou od něj (stejně jako fixtury, které web z importérů bere).
 */
const requireFromImporters = createRequire(
  new URL('../../../packages/importers/package.json', import.meta.url),
);
const newWorkbook = (): WorkbookBuilder => {
  const exceljs = requireFromImporters('exceljs') as { Workbook: new () => WorkbookBuilder };
  return new exceljs.Workbook();
};

describe('autodetekce: český výpis Degiro', () => {
  /**
   * Hlavička českého „Přehledu účtu“ tak, jak ji Degiro posílá
   * (github.com/yardee/degiro-cz-taxes, `test_dane_degiro.py`, 4/2026; totéž
   * české PDF v testech Portfolio Performance): sloupec částky se jmenuje
   * „Pohyb“. Sniffer zná jen „Změna“, takže soubor propadne až na „Formát
   * nepoznáváme“ — český uživatel s českým rozhraním nenahraje dividendy
   * vůbec.
   */
  it('Account.csv se sloupci „Pohyb“ a „Zůstatek“ skončí u parseru Degiro', () => {
    const csv = [
      'Datum,Čas,Datum,Produkt,ISIN,Popis,Kurz,Pohyb,,Zůstatek,,ID objednávky',
      '12-03-2026,09:14,11-03-2026,NORDWIND CORP,US0000000001,Dividenda,,USD,"10,00",USD,"10,00",',
      '12-03-2026,09:14,11-03-2026,NORDWIND CORP,US0000000001,Daň z dividendy,,USD,"-1,50",USD,"8,50",',
    ].join('\n');

    const result = detectAndParse(csv);
    expect(result.broker).toBe('degiro');
    expect(result.transactions).toHaveLength(1);
  });

  /**
   * České Transakce mají cenu ve sloupci „Cena“ (hlavička českého PDF
   * v testech Portfolio Performance, `Transakce01.txt`; pro CSV silná
   * domněnka — u NL, EN a DE se názvy v PDF a CSV shodují). Sniffer soubor
   * pozná, parser ho pak odmítne celý: „chybí sloupce datum/ISIN/počet/kurz“.
   */
  it('Transactions.csv se sloupcem „Cena“ se pozná i přečte', () => {
    const csv = [
      'Datum,Čas,Produkt,ISIN,Reference,Venue,Počet,Cena,,Hodnota v domácí měně,,Hodnota,,Směnný kurz,Transaction and/or third party fees,,Celkem,,ID objednávky',
      '08-09-2025,16:42,NORDWIND CORP,US0000000001,NSY,CDED,16,"14,82",USD,"-237,12",USD,"-232,29",EUR,"1,0208","-0,50",EUR,"-232,79",EUR,7b1e0c52-0000-4000-8000-00000000c002',
    ].join('\n');

    const result = detectAndParse(csv);
    expect(result.broker).toBe('degiro');
    expect(result.errors).toEqual([]);
    expect(result.transactions).toHaveLength(1);
  });
});

describe('eToro: výpis v jazyce rozhraní', () => {
  /**
   * eToro překládá sešit do jazyka rozhraní včetně názvů listů (španělský má
   * „Posiciones cerradas“ a „Dividendos“ — github.com/sebv593/etoro-taxdown-etl;
   * Koinly i Coinpanda v návodu radí přepnout před exportem do angličtiny).
   * Parser umí jen anglické názvy, takže to musí říct návod i hláška.
   */
  it('návod v katalogu říká, že je před stažením potřeba přepnout eToro do angličtiny', () => {
    const etoro = PLATFORMS.find((platform) => platform.id === 'etoro');
    expect(etoro?.guide).toMatch(/anglič/i);
  });

  describe('nahrání sešitu se španělskými listy', () => {
    let db: Db;
    beforeAll(async () => {
      db = await createPgliteDb();
      await db.insert(user).values({ id: 'u1', name: 'Test', email: 'audit-etoro@example.com' });
    }, 60_000);

    it('hláška poradí přepnout jazyk, ne jen „XLSX nepoznáváme“', { timeout: 30_000 }, async () => {
      const workbook = newWorkbook();
      workbook
        .addWorksheet('Posiciones cerradas')
        .addRow(['Fecha de apertura', 'Fecha de cierre', 'Acción', 'Tipo', 'ISIN']);
      workbook.addWorksheet('Dividendos').addRow(['Fecha de pago', 'Nombre del instrumento']);
      const raw = await workbook.xlsx.writeBuffer();
      const buffer = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer);
      const data = buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength,
      ) as ArrayBuffer;

      const summary = await importFileIsolated(db, 'u1', 'etoro-account-statement.xlsx', data);
      expect(summary.errors[0]?.message).toMatch(/anglič/i);
    });
  });
});
