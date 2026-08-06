import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import type { Db } from '@/db';
import journal from '@/db/migrations/meta/_journal.json';

/**
 * G-7: health dělal jen `SELECT 1` — nezmigrovaná databáze na něj odpoví
 * a monitoring viděl `200 ok`, zatímco aplikace všude padala. A protože
 * nebyl žádný timeout, visící databáze držela health až do limitu funkce.
 */
const stav = vi.hoisted(() => ({ db: null as unknown as Db }));

vi.mock('@/db', async () => {
  const actual = await vi.importActual<typeof import('@/db')>('@/db');
  return { ...actual, getDb: async () => stav.db };
});

describe('health endpoint (G-7)', () => {
  beforeEach(async () => {
    const { createPgliteDb } = await vi.importActual<typeof import('@/db')>('@/db');
    stav.db = await createPgliteDb();
  }, 30_000);

  it('zmigrovaná databáze → 200 a počet migrací sedí', { timeout: 30_000 }, async () => {
    const { GET } = await import('@/app/api/health/route');
    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe('ok');
    expect(body.migrations).toEqual({
      applied: journal.entries.length,
      expected: journal.entries.length,
    });
  });

  it('chybějící migrace → 503, ne „ok“', { timeout: 30_000 }, async () => {
    // simulace nezmigrované produkce: záznam poslední migrace zmizí
    await stav.db.execute(
      sql`DELETE FROM drizzle.__drizzle_migrations WHERE id = (SELECT max(id) FROM drizzle.__drizzle_migrations)`,
    );
    const { GET } = await import('@/app/api/health/route');
    const response = await GET();
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.status).toBe('error');
    expect(body.migrations.applied).toBe(journal.entries.length - 1);
  });

  it('visící databáze → 503 do pár sekund, ne čekání do limitu funkce', async () => {
    // nikdy nedokončený dotaz = přesně chování nedostupného Neonu
    stav.db = {
      transaction: () => new Promise(() => {}),
    } as unknown as Db;
    const { GET } = await import('@/app/api/health/route');

    const startedAt = Date.now();
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ db: 'timeout' });
    expect(Date.now() - startedAt).toBeLessThan(10_000);
  }, 20_000);
});
