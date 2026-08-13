import { describe, expect, it } from 'vitest';
import { createPgliteDb } from '@/db';
import { taxpayerProfiles, user } from '@/db/schema';
import { importCsvText } from '@/lib/import-service';
import { analyzeForUser, getProfile, loadTransactions } from '@/lib/portfolio';

/**
 * R-13 přes celý řetěz: šablona → import → JSONB → rehydratace → engine.
 *
 * Značka `positionEffect` je jediné, co odlišuje prodej nakrátko od neúplné
 * historie. Kdyby se cestou ztratila (chybí ve schématu, spadne pod
 * `JSON.stringify`, rozejde se název sloupce), engine by z shortu udělal prodej
 * bez pozice — ocenil by ho nulou a zdanil celý výnos. Tenhle test hlídá,
 * že projde až do výpočtu.
 */

const HLAVICKA =
  'type,date,settlement_date,isin,ticker,name,asset_class,settlement_style,position_effect,quantity,price,currency,fee,fee_currency,amount,withholding_tax,source_country,subtype,ratio_from,ratio_to,new_isin,acquisition_date,acquisition_price,acquisition_currency,note';

const SHORT_CSV = [
  HLAVICKA,
  'SELL,2026-02-10,2026-02-11,US0378331005,AAPL,Apple Inc,,,open,100,3000.00,USD,,,,,,,,,,,,,prodej nakrátko',
  'BUY,2026-04-20,2026-04-21,US0378331005,AAPL,Apple Inc,,,close,100,2500.00,USD,,,,,,,,,,,,,pokrytí shortu',
].join('\n');

describe('prodej nakrátko projde od šablony až do výpočtu', () => {
  it('značka přežije uložení a engine short spočítá, ne že hlásí neúplnou historii', {
    timeout: 30_000,
  }, async () => {
    const db = await createPgliteDb();
    await db.insert(user).values({ id: 'u1', name: 'Test', email: 'short@danero.cz' });
    await db.insert(taxpayerProfiles).values({ userId: 'u1', regime: 'PAUSAL' });

    const batch = await importCsvText(db, 'u1', 'short.csv', SHORT_CSV);
    expect(batch.errors).toEqual([]);
    expect(batch.added).toBe(2);

    // značka musí přežít JSONB round-trip
    const txs = await loadTransactions(db, 'u1');
    const efekty = txs
      .filter((tx) => tx.type === 'BUY' || tx.type === 'SELL')
      .map((tx) => (tx.type === 'BUY' || tx.type === 'SELL' ? tx.positionEffect : undefined));
    expect(efekty.sort()).toEqual(['CLOSE', 'OPEN']);

    const profile = await getProfile(db, 'u1');
    const analysis = analyzeForUser(txs, profile!, 2026, '2026-12-31');

    // tržba 300 000 Kč (kurzem) je nad stovkou → daní se rozdíl proti pokrytí
    expect(analysis.result.shortSales.items).toHaveLength(2);
    expect(analysis.result.securities.base10Czk.gt(0)).toBe(true);
    // a hlavně: žádné „prodáno víc, než známe z historie“
    expect(analysis.result.warnings.some((w) => w.code === 'NEGATIVE_POSITION')).toBe(false);
    expect(analysis.positions).toEqual([]);
  });
});
