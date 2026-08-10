import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createPgliteDb } from '@/db';
import { instrumentPrices, user } from '@/db/schema';
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

/**
 * F-3-12: zápis cen běžel jeden `INSERT` na instrument — u 500 pozic to bylo
 * 500 round-tripů, na Neonu (~3 ms) 1,5 s po každém syncu.
 */
describe('ceny se zapisují dávkově (F-3-12)', () => {
  it('velké portfolio se uloží celé a druhý běh hodnoty přepíše', { timeout: 30_000 }, async () => {
    const db = await createPgliteDb();
    await db.insert(user).values({
      id: 'u1',
      name: 'Test',
      email: 'u1@danero.cz',
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const prices = Array.from({ length: 600 }, (_, i) => ({
      isin: `CZ${String(i).padStart(10, '0')}`,
      price: '100',
      currency: 'CZK',
    }));

    const asOf = new Date('2026-08-10T10:00:00Z');
    expect(await upsertInstrumentPrices(db, 'u1', 'trading212', prices, asOf)).toBe(600);

    const znovu = prices.map((p) => ({ ...p, price: '250' }));
    const pozdeji = new Date('2026-08-10T11:00:00Z');
    expect(await upsertInstrumentPrices(db, 'u1', 'trading212', znovu, pozdeji)).toBe(600);

    const rows = await db
      .select({ price: instrumentPrices.price })
      .from(instrumentPrices)
      .where(eq(instrumentPrices.userId, 'u1'));
    expect(rows).toHaveLength(600);
    expect(new Set(rows.map((r) => r.price))).toEqual(new Set(['250']));
  });

  it('tentýž ISIN dvakrát v jedné dávce nespadne — vyhraje poslední', { timeout: 30_000 }, async () => {
    const db = await createPgliteDb();
    await db.insert(user).values({
      id: 'u2',
      name: 'Test',
      email: 'u2@danero.cz',
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const written = await upsertInstrumentPrices(
      db,
      'u2',
      'trading212',
      [
        { isin: 'CZ0000000001', price: '100', currency: 'CZK' },
        { isin: 'CZ0000000001', price: '300', currency: 'CZK' },
      ],
      new Date('2026-08-10T10:00:00Z'),
    );
    expect(written).toBe(1);
    const [row] = await db
      .select({ price: instrumentPrices.price })
      .from(instrumentPrices)
      .where(eq(instrumentPrices.userId, 'u2'));
    expect(row!.price).toBe('300');
  });
});
