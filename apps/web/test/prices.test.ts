import { describe, expect, it } from 'vitest';
import { createPgliteDb } from '@/db';
import { user } from '@/db/schema';
import { loadInstrumentPrices, upsertInstrumentPrices } from '@/lib/prices';

/**
 * Ceny instrumentů z broker API. Brokeři posílají do číselných polí i `N/A`
 * (IBKR `markPrice="N/A"` u nástroje bez kotace) — a `new Decimal('N/A')`
 * vyhodí výjimku. Guard `isFinite()` byl původně AŽ ZA `d()`, takže se nikdy
 * nespustil a jediná nečíselná cena shodila zápis cen celého syncu
 * (nález A3-03; u IBKR je volání mimo try/catch). Stejná třída chyby jako
 * G-4 v `lib/cnb.ts`.
 */
describe('ceny instrumentů: nečíselná cena od brokera', () => {
  it('nečíselnou cenu přeskočí a zbytek dávky uloží', { timeout: 30_000 }, async () => {
    const db = await createPgliteDb();
    await db.insert(user).values({ id: 'u1', name: 'Test', email: 'u1@example.com' });

    const written = await upsertInstrumentPrices(
      db,
      'u1',
      'ibkr',
      [
        { isin: 'US0378331005', price: '190.5', currency: 'USD' },
        { isin: 'US5949181045', price: 'N/A', currency: 'USD' }, // tohle dřív shodilo všechno
        { isin: 'IE00B4L5Y983', price: '', currency: 'EUR' },
        { isin: 'GB0002374006', price: '1000', currency: 'GBX' },
      ],
      new Date('2026-08-07T00:00:00Z'),
    );

    expect(written).toBe(2);
    const prices = await loadInstrumentPrices(db, 'u1');
    expect(prices.get('US0378331005')?.price.toString()).toBe('190.5');
    // GBX = pence → normalizace na GBP (známá zrada T212)
    expect(prices.get('GB0002374006')?.price.toString()).toBe('10');
    expect(prices.get('GB0002374006')?.currency).toBe('GBP');
    expect(prices.has('US5949181045')).toBe(false);
  });
});
