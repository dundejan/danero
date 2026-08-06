import { afterEach, describe, expect, it } from 'vitest';
import { getDb } from '@/db';

/**
 * Připojení k databázi se memoizuje do globálu, aby serverless funkce nedělaly
 * nové spojení při každém requestu. Odmítnutý pokus se ale zacachovat nesmí:
 * jinak jednorázový výpadek databáze při startu zamkne instanci natrvalo.
 */
describe('inicializace databáze', () => {
  afterEach(() => {
    delete process.env.DATABASE_URL;
    delete (globalThis as { __daneroDb?: unknown }).__daneroDb;
  });

  it('neúspěšné připojení se nezacachuje a další pokus projde', { timeout: 30_000 }, async () => {
    // neexistující port → spojení selže (connect_timeout, ať test nečeká 30 s)
    process.env.DATABASE_URL = 'postgres://nikdo:nic@127.0.0.1:1/neexistuje?connect_timeout=2';
    process.env.DANERO_MIGRATE_ON_START = '1';
    await expect(getDb()).rejects.toThrow();
    delete process.env.DANERO_MIGRATE_ON_START;

    // databáze je zpátky (tady jako PGlite) — instance se musí vzpamatovat sama
    delete process.env.DATABASE_URL;
    const db = await getDb();
    expect(db).toBeDefined();
  });
});
