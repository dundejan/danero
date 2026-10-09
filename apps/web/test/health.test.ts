import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

/**
 * L10-09: vlastní instance spuštěná bez `DATABASE_URL` běží nad PGlite v souboru
 * vedle aplikace, zmigrovaný Postgres zůstane prázdný — a health vracel v obou
 * případech tutéž odpověď. Pole jen přibývá, ostatní klíče se nemění.
 */
describe('health endpoint — nad jakou databází instance běží (L10-09)', () => {
  beforeEach(async () => {
    const { createPgliteDb } = await vi.importActual<typeof import('@/db')>('@/db');
    stav.db = await createPgliteDb();
  }, 30_000);

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('bez DATABASE_URL hlásí pglite a dosavadní klíče zůstávají', { timeout: 30_000 }, async () => {
    vi.stubEnv('DATABASE_URL', '');
    const { GET } = await import('@/app/api/health/route');
    const body = await (await GET()).json();
    expect(body.dbDriver).toBe('pglite');
    expect(Object.keys(body).sort()).toEqual([
      'db',
      'dbDriver',
      'dbLatencyMs',
      'migrations',
      'operatorContact',
      'status',
      'support',
    ]);
    expect(body).toMatchObject({ status: 'ok', db: 'ok', operatorContact: 'ok', support: 'off' });
  });

  it('s DATABASE_URL hlásí postgres', { timeout: 30_000 }, async () => {
    // `getDb` je v tomhle souboru podvržený, na adresu se nikdo nepřipojí
    vi.stubEnv('DATABASE_URL', 'postgres://nikdo:nic@127.0.0.1:1/neexistuje');
    const { GET } = await import('@/app/api/health/route');
    const body = await (await GET()).json();
    expect(body.dbDriver).toBe('postgres');
  });
});

/**
 * L10-10: healthcheck v compose běží po 15 s a každý zapsal řádek úrovně error
 * o chybějící identifikaci provozovatele — tisíce stejných řádků denně, ve
 * kterých se skutečná chyba ztratí. Stačí to říct jednou za běh procesu;
 * odpověď sama nese `operatorContact` dál při každém volání.
 */
describe('health endpoint — chybějící identifikace se loguje jednou (L10-10)', () => {
  beforeEach(async () => {
    const { createPgliteDb } = await vi.importActual<typeof import('@/db')>('@/db');
    stav.db = await createPgliteDb();
  }, 30_000);

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('dvě sondy → jeden záznam, pole v odpovědi pokaždé', { timeout: 30_000 }, async () => {
    // identifikace se čte při načtení modulu — proto čerstvé moduly
    vi.stubEnv('DANERO_OPERATOR_ICO', '');
    vi.resetModules();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { GET } = await import('@/app/api/health/route');

    const first = await (await GET()).json();
    const second = await (await GET()).json();

    expect(first.operatorContact).toBe('incomplete');
    expect(second.operatorContact).toBe('incomplete');
    const logged = errors.mock.calls
      .map(([line]) => JSON.parse(String(line)) as { event?: string })
      .filter((entry) => entry.event === 'health.operator_contact_incomplete');
    expect(logged).toHaveLength(1);
  });
});
