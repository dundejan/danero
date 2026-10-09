import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDb, logPostgresNotice } from '@/db';

type DbGlobals = { __daneroDb?: unknown; __daneroPgliteWarned?: unknown };

/** Řádky logu (`logEvent` píše jeden JSON na řádek) s daným názvem události. */
function loggedEvents(
  spy: { mock: { calls: unknown[][] } },
  event: string,
): Array<Record<string, unknown>> {
  return spy.mock.calls
    .map(([line]) => {
      try {
        return JSON.parse(String(line)) as Record<string, unknown>;
      } catch {
        return {};
      }
    })
    .filter((entry) => entry.event === event);
}

/**
 * Připojení k databázi se memoizuje do globálu, aby serverless funkce nedělaly
 * nové spojení při každém requestu. Odmítnutý pokus se ale zacachovat nesmí:
 * jinak jednorázový výpadek databáze při startu zamkne instanci natrvalo.
 */
describe('inicializace databáze', () => {
  afterEach(() => {
    delete process.env.DATABASE_URL;
    delete (globalThis as DbGlobals).__daneroDb;
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

/**
 * L10-09: produkční start bez `DATABASE_URL` mlčky spadl na PGlite — data
 * skončila v souboru vedle aplikace a v logu o tom nebyl jediný řádek. Start se
 * neblokuje (`pnpm test:e2e:prod` takhle běží záměrně), jen to má být vidět.
 */
describe('produkční start bez DATABASE_URL (L10-09)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    delete (globalThis as DbGlobals).__daneroDb;
    delete (globalThis as DbGlobals).__daneroPgliteWarned;
  });

  it('zaloguje varování, a to jednou za běh procesu', { timeout: 30_000 }, async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('DATABASE_URL', '');
    vi.stubEnv('PGLITE_DATA_DIR', ':memory:');
    const warnings = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(await getDb()).toBeDefined();
    // druhá inicializace v témže procesu (po výpadku se cache zahazuje)
    delete (globalThis as DbGlobals).__daneroDb;
    expect(await getDb()).toBeDefined();

    const logged = loggedEvents(warnings, 'db.pglite_in_production');
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ level: 'warn', dataDir: ':memory:' });
  });

  it('mimo produkci mlčí — vývoj a testy nad PGlite jsou běžný stav', { timeout: 30_000 }, async () => {
    vi.stubEnv('DATABASE_URL', '');
    vi.stubEnv('PGLITE_DATA_DIR', ':memory:');
    const warnings = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(await getDb()).toBeDefined();

    expect(loggedEvents(warnings, 'db.pglite_in_production')).toHaveLength(0);
  });
});

/**
 * L10-10: migrátor při každém startu kromě prvního dostane od Postgresu dvě
 * NOTICE („schema "drizzle" already exists, skipping“ a totéž pro tabulku
 * migrací). postgres.js je bez `onnotice` vypíše přes `console.log` jako
 * víceřádkový objekt — proti slibu „jeden JSON řádek na událost“.
 */
describe('NOTICE od Postgresu (L10-10)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    delete (globalThis as DbGlobals).__daneroDb;
  });

  it('očekávaná NOTICE migrátoru se zahodí, jiná jde do logu jedním řádkem', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const plain = vi.spyOn(console, 'log').mockImplementation(() => {});

    logPostgresNotice({
      severity: 'NOTICE',
      code: '42P06',
      message: 'schema "drizzle" already exists, skipping',
    });
    logPostgresNotice({
      severity: 'NOTICE',
      code: '42P07',
      message: 'relation "__drizzle_migrations" already exists, skipping',
    });
    expect(info).not.toHaveBeenCalled();

    logPostgresNotice({
      severity: 'NOTICE',
      code: '42622',
      message: 'identifier "zkusebni_nazev" will be truncated',
      file: 'scansup.c',
      line: '99',
      routine: 'truncate_identifier',
    });
    expect(plain).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledTimes(1);
    const line = String(info.mock.calls[0]![0]);
    expect(line).not.toContain('\n');
    expect(JSON.parse(line)).toMatchObject({
      level: 'info',
      event: 'db.notice',
      code: '42622',
      severity: 'NOTICE',
      message: 'identifier "zkusebni_nazev" will be truncated',
    });
  });

  // Citlivé na driver: PGlite žádné NOTICE přes klienta neposílá, takže zapojení
  // `onnotice` jde ověřit jen proti opravdovému Postgresu (v CI `TEST_DATABASE_URL`).
  // Nemigruje se a nic se nezakládá — schéma `public` už existuje vždycky.
  it.skipIf(!process.env.TEST_DATABASE_URL)(
    'klient z getDb() nepustí NOTICE na konzoli jako objekt',
    { timeout: 30_000 },
    async () => {
      vi.stubEnv('DATABASE_URL', process.env.TEST_DATABASE_URL!);
      vi.stubEnv('DANERO_MIGRATE_ON_START', '');
      const plain = vi.spyOn(console, 'log').mockImplementation(() => {});
      const info = vi.spyOn(console, 'info').mockImplementation(() => {});

      const db = await getDb();
      try {
        await db.execute(sql`CREATE SCHEMA IF NOT EXISTS public`);
        await db.execute(sql`DO $$ BEGIN RAISE NOTICE 'zkusebni oznameni'; END $$`);
      } finally {
        await (db as unknown as { $client: { end: () => Promise<void> } }).$client.end();
      }

      expect(plain).not.toHaveBeenCalled();
      const logged = loggedEvents(info, 'db.notice');
      expect(logged).toHaveLength(1);
      expect(logged[0]).toMatchObject({ severity: 'NOTICE', message: 'zkusebni oznameni' });
    },
  );
});
