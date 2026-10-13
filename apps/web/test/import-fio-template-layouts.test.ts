/**
 * Fio a univerzální šablona (audit 13. 10. 2026) — webová vrstva: autodetekce
 * nahraného souboru. Komentáře popisují vadu, kterou test hlídá; parserové
 * nálezy jsou v `packages/importers/test/fio-portu-mt-template-real-layouts.test.ts`.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { UNIVERSAL_TEMPLATE_CSV } from '@danero/importers';
import { encodeCp1250 } from '../../../packages/importers/test/fixtures/fio';
import { buildSheetsXlsx } from '../../../packages/importers/test/fixtures/saxo';
import { createPgliteDb, type Db } from '@/db';
import { user } from '@/db/schema';
import { importFileIsolated } from '@/lib/import-service';

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

describe('nahrání souboru: Fio a univerzální šablona', () => {
  let db: Db;
  beforeAll(async () => {
    db = await createPgliteDb();
    await db.insert(user).values({ id: 'u1', name: 'Test', email: 'audit-cz@example.com' });
  }, 60_000);

  it(
    'Fio: export s preambulí („Přehled operací pro portfolio“, Vytvořeno, Období) se pozná jako Fio',
    { timeout: 30_000 },
    async () => {
      // Rozložení podle skutečného exportu (kacka.baldsoft.com/demo/TradeFio2011.csv,
      // soubor z 15. 9. 2016): tři řádky preambule, prázdný řádek, hlavička
      // zakončená středníkem, pod daty řádek „Součet“. Čísla jsou smyšlená.
      // Řádky bez symbolu — obchod by bez číselníku ISIN nic neuložil.
      const text = [
        'Přehled operací pro portfolio"Moje portfolio"',
        'Vytvořeno: 05.01.2026 10:00:00',
        'Období: 1.1.2025 - 31.12.2025',
        '',
        'Datum obchodu;Směr;Symbol;Cena;Počet;Měna;Objem v CZK;Poplatky v CZK;Objem v USD;Poplatky v USD;Objem v EUR;Poplatky v EUR;Text FIO;Datum vypořádání;',
        '07.12.2025 00:00;Bankovní převod;;;0,00;CZK;-12 500,00;0,00;;;;;Převod na účet - Fio banka 2000000001;07.12.2025;',
        '31.12.2025 00:00;;;;0,00;EUR;;;;;-0,68;0,68;Běžné úroky za čerpání měnového úvěru;31.12.2025;',
        ';;Součet;;;;-12 500,00;0,00;;;-0,68;0,68;;;',
        '',
      ].join('\r\n');

      const summary = await importFileIsolated(db, 'u1', 'obchody.csv', toArrayBuffer(encodeCp1250(text)));

      expect(summary.broker).toBe('fio');
      expect(summary.unrecognized).toBeFalsy();
      expect(summary.added).toBeGreaterThan(0);
    },
  );

  it(
    'šablona uložená z Excelu jako sešit .xlsx se načte, nebo hláška řekne, ať ji uživatel uloží jako CSV',
    { timeout: 30_000 },
    async () => {
      // Šablona se stahuje jako CSV a otevírá v Excelu; ten při ukládání
      // varuje, že CSV „nemusí zachovat všechny funkce“, a nabízí sešit.
      // Hláška dnes radí „použij univerzální šablonu“ — tu uživatel nahrál.
      // první tři řádky šablony nemají čárku uvnitř pole
      const rows = UNIVERSAL_TEMPLATE_CSV.split('\n')
        .slice(0, 3)
        .map((line) => line.split(','));
      const bytes = new Uint8Array(await buildSheetsXlsx({ sablona: rows }));

      const summary = await importFileIsolated(db, 'u1', 'sablona.xlsx', toArrayBuffer(bytes));

      const messages = summary.errors.map((error) => error.message).join('\n');
      const imported = summary.added > 0;
      const tellsWhatToDo = /CSV/.test(messages);
      expect(imported || tellsWhatToDo, messages).toBe(true);
    },
  );
});
