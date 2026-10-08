import { describe, expect, it } from 'vitest';
import { parseUniversalCsv, UNIVERSAL_TEMPLATE_CSV } from '@danero/importers';
import { GET } from '@/app/api/sablona/route';
import { createPgliteDb } from '@/db';
import { transactions, user } from '@/db/schema';
import { detectAndParseExport, importFile } from '@/lib/import-service';

/**
 * L2c-02: co uživatel dostane po kliknutí na „Stáhnout šablonu“.
 *
 * Soubor se otevírá dvojklikem v českém Excelu — čárkové CSV bez BOM tam
 * skončí celé ve sloupci A s rozbitou diakritikou (změřeno ve skutečném
 * Excelu). Posíláme proto tvar se středníkem a BOM. Test jde přes BAJTY
 * z route až do importu: právě na téhle cestě (dekódování, autodetekce,
 * parser) se dá tvar rozbít, aniž by si toho všiml test samotného parseru.
 */
describe('/api/sablona', () => {
  const download = async (): Promise<{ response: Response; bytes: Uint8Array }> => {
    const response = GET();
    return { response, bytes: new Uint8Array(await response.arrayBuffer()) };
  };

  it('posílá CSV ke stažení v UTF-8 s BOM (bez něj Excel rozbije diakritiku)', async () => {
    const { response, bytes } = await download();
    expect(response.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(response.headers.get('content-disposition')).toContain('danero-sablona.csv');
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it('sloupce dělí středník, který český Excel rozloží do sloupců', async () => {
    const { bytes } = await download();
    const header = new TextDecoder('utf-8').decode(bytes).split('\n')[0]!;
    expect(header.split(';')).toEqual(UNIVERSAL_TEMPLATE_CSV.split('\n')[0]!.split(','));
  });

  it('autodetekce stažený soubor pozná jako naši šablonu, ne jako cizí výpis', async () => {
    const { bytes } = await download();
    // text tak, jak ho po nahrání uvidí autodetekce (BOM spolkne dekodér)
    const { outcome, unrecognized } = detectAndParseExport(new TextDecoder('utf-8').decode(bytes));
    expect(outcome.broker).toBe('universal');
    expect(unrecognized).toBe(false);
    expect(outcome.errors).toEqual([]);
    expect(outcome.transactions).toHaveLength(17);
  });

  it('bajty z route projdou importem beze změny: 17 transakcí, 0 chyb', { timeout: 30_000 }, async () => {
    const db = await createPgliteDb();
    await db.insert(user).values({ id: 'u1', name: 'Test', email: 'test@danero.cz' });

    const { bytes } = await download();
    const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const summary = await importFile(db, 'u1', 'danero-sablona.csv', data);

    expect(summary.broker).toBe('universal');
    expect(summary.errors).toEqual([]);
    expect(summary.warnings).toEqual([]);
    expect(summary.added).toBe(17);
    expect(summary.unrecognized).toBeFalsy();
    expect(await db.select().from(transactions)).toHaveLength(17);

    // a je to tatáž šablona jako čárková konstanta: druhé nahrání nic nepřidá
    const again = await importFile(
      db,
      'u1',
      'sablona-carkova.csv',
      new TextEncoder().encode(UNIVERSAL_TEMPLATE_CSV).buffer as ArrayBuffer,
    );
    expect(again.errors).toEqual([]);
    expect(again.added).toBe(0);
    expect(again.duplicates).toBe(parseUniversalCsv(UNIVERSAL_TEMPLATE_CSV).transactions.length);
  });
});
