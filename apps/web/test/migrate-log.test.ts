import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import postgres from 'postgres';
import { formatMigrationError, isPublicLog, PUBLIC_LOG_NOTICE } from '../db/error-report.mjs';

/**
 * Log workflow „Migrace produkční databáze" čte každý, kdo je přihlášený na
 * GitHubu — repozitář je veřejný a log v něm leží 90 dní. `/soukromi` přitom
 * o GitHubu slibuje, že se tam z účtu v Daneru nedostane nic.
 *
 * Postgres ale do chyby skládá hodnoty z řádků: `detail` u porušené unikátnosti
 * nese klíč („Key (email)=(…) is duplicated."), u porušeného NOT NULL celý
 * řádek i s JSON payloadem, a u chyb třídy 22 je hodnota přímo v hlášce
 * („invalid input syntax for type integer: …"). Datová migrace, která na
 * produkci spadne, by tak do veřejného logu vypsala údaj skutečného uživatele.
 *
 * Proto má skript dva režimy: v GitHub Actions (`GITHUB_ACTIONS=true`) tiskne
 * jen to, co je na seznamu povoleného, a `db/status.mjs` vynechá počet účtů.
 * Ruční spuštění mimo Actions dál ukáže chybu celou (M-4).
 *
 * Všechny údaje v tomhle souboru jsou smyšlené.
 */

const ROW_EMAIL = 'vymysleny.clovek@example.test';
const ROW_PAYLOAD = '{"isin": "XX0000000001", "amount": "4711.25"}';
const MESSAGE_VALUE = '4711,25 korun';
const STATEMENT = 'UPDATE "transactions" SET "quantity" = "payload"->>\'amount\';';

/**
 * Chyba ve tvaru, v jakém ji z migrace dostaneme: drizzle obalí chybu driveru
 * do „Failed query: …" a pole Postgresu jsou až na příčině.
 */
function sampleError(): Error {
  const driverError = Object.assign(
    new Error(`invalid input syntax for type numeric: "${MESSAGE_VALUE}"`),
    {
      name: 'PostgresError',
      code: '22P02',
      severity: 'ERROR',
      detail: `Failing row contains (u1, ${ROW_EMAIL}, ${ROW_PAYLOAD}).`,
      hint: `Zkontroluj hodnotu ${MESSAGE_VALUE}.`,
      where: `PL/pgSQL function fix_amount(text) line 3, argument "${MESSAGE_VALUE}"`,
      position: '42',
      schema_name: 'public',
      table_name: 'transactions',
      column_name: 'quantity',
      constraint_name: 'transactions_quantity_check',
      routine: 'ExecConstraints',
      query: STATEMENT,
      // pole, které dnes na seznamu není — do veřejného výpisu se nesmí dostat samo
      parameters: [ROW_EMAIL],
    },
  );
  const wrapper = Object.assign(new Error(`Failed query: ${STATEMENT}\nparams: ${ROW_EMAIL}`), {
    query: STATEMENT,
    params: [ROW_EMAIL],
  });
  wrapper.cause = driverError;
  return wrapper;
}

describe('výpis chyby migrace: co smí do veřejného logu (L9-08)', () => {
  it('ve veřejném režimu nevypíše nic, co nese hodnoty z řádků', () => {
    const output = formatMigrationError(sampleError(), { publicLog: true }).join('\n');

    expect(output).not.toContain(ROW_EMAIL);
    expect(output).not.toContain(ROW_PAYLOAD);
    expect(output).not.toContain('4711');
    expect(output).not.toContain('invalid input syntax');
    expect(output).not.toContain('Failing row');
    expect(output).not.toMatch(/^\s*(detail|hint|where|stack|message|parameters|params):/m);
    // stack opakuje hlášku a vypisuje cesty — ve veřejném logu z něj nezbyde ani řádek
    expect(output).not.toMatch(/^\s+at /m);
  });

  it('ve veřejném režimu nechá všechno ze seznamu povoleného', () => {
    const lines = formatMigrationError(sampleError(), { publicLog: true });

    // přesně: nic navíc, co by příští verze driveru na chybu přidala
    expect(lines).toEqual([
      'Error',
      `  query: ${STATEMENT}`,
      '  PostgresError',
      '    code: 22P02',
      '    severity: ERROR',
      '    position: 42',
      '    schema_name: public',
      '    table_name: transactions',
      '    column_name: quantity',
      '    constraint_name: transactions_quantity_check',
      '    routine: ExecConstraints',
      `    query: ${STATEMENT}`,
    ]);
  });

  it('při ručním spuštění vypíše chybu celou — hlášku, detail, hint, kontext i stack (M-4)', () => {
    const output = formatMigrationError(sampleError(), { publicLog: false }).join('\n');

    expect(output).toContain(
      `PostgresError: invalid input syntax for type numeric: "${MESSAGE_VALUE}"`,
    );
    expect(output).toContain(`detail: Failing row contains (u1, ${ROW_EMAIL}, ${ROW_PAYLOAD}).`);
    expect(output).toContain(`hint: Zkontroluj hodnotu ${MESSAGE_VALUE}.`);
    expect(output).toContain('where: PL/pgSQL function fix_amount(text) line 3');
    expect(output).toContain('code: 22P02');
    expect(output).toContain('constraint_name: transactions_quantity_check');
    expect(output).toMatch(/^\s+stack: \w+: invalid input syntax/m);
    expect(output).toMatch(/^Error: Failed query: /m);
  });

  it('název třídy chyby pustí do veřejného logu, jen když jako název třídy vypadá', () => {
    const error = Object.assign(new Error('x'), {
      name: `Chyba u ${ROW_EMAIL}`,
      code: 'ECONNRESET',
    });

    expect(formatMigrationError(error, { publicLog: true })).toEqual([
      'Error',
      '  code: ECONNRESET',
    ]);
  });

  it('snese i hodnotu, která není Error', () => {
    expect(formatMigrationError(ROW_EMAIL, { publicLog: true })).toEqual(['Error']);
    expect(formatMigrationError(ROW_EMAIL, { publicLog: false })).toEqual([`Error: ${ROW_EMAIL}`]);
    expect(formatMigrationError(undefined, { publicLog: true })).toEqual(['Error']);
  });

  it('veřejný režim zapíná jen GITHUB_ACTIONS=true, jak ho nastavuje runner', () => {
    expect(isPublicLog({ GITHUB_ACTIONS: 'true' })).toBe(true);
    expect(isPublicLog({})).toBe(false);
    expect(isPublicLog({ GITHUB_ACTIONS: '' })).toBe(false);
    expect(isPublicLog({ GITHUB_ACTIONS: 'false' })).toBe(false);
    // obecné CI=true nastavuje kdeco, i lokální nástroje — to ještě veřejný log není
    expect(isPublicLog({ CI: 'true' })).toBe(false);
  });

  it('věta o zkráceném výpisu říká, kde vzít celý, a sama nic necituje', () => {
    expect(PUBLIC_LOG_NOTICE).toContain('mimo GitHub Actions');
  });
});

/** Jen cílová databáze a přepínač režimu — zděděné `GITHUB_ACTIONS` z CI by test rozhodlo za nás. */
function runScript(script: string, args: string[], databaseUrl: string, publicLog: boolean) {
  const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: databaseUrl };
  delete env.GITHUB_ACTIONS;
  if (publicLog) env.GITHUB_ACTIONS = 'true';
  const result = spawnSync('node', [script, ...args], { env, encoding: 'utf8' });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

/** Složka s jedinou migrací ve tvaru, jaký čte drizzle. */
function writeMigration(root: string, tag: string, statement: string): string {
  const dir = join(root, tag);
  mkdirSync(join(dir, 'meta'), { recursive: true });
  writeFileSync(join(dir, `${tag}.sql`), statement);
  writeFileSync(
    join(dir, 'meta/_journal.json'),
    JSON.stringify({
      version: '7',
      dialect: 'postgresql',
      entries: [{ idx: 0, version: '7', when: 1, tag, breakpoints: true }],
    }),
  );
  return dir;
}

const URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!URL)(
  'migrace a stav nad opravdovým Postgresem: co se dostane do logu (L9-08)',
  () => {
    const DUPLICATE_EMAIL = 'dvakrat.zapsana@example.test';
    const NOTE_VALUE = 'vymyslena poznamka 4711';
    const name = `migrate_log_${Date.now()}`;
    let admin: ReturnType<typeof postgres>;
    let databaseUrl = '';
    let root = '';
    let uniqueDir = '';
    let castDir = '';

    beforeAll(async () => {
      admin = postgres(URL!, { max: 1, prepare: false });
      await admin.unsafe(`CREATE DATABASE ${name}`);
      const target = new global.URL(URL!);
      target.pathname = `/${name}`;
      databaseUrl = target.toString();

      const seed = postgres(databaseUrl, { max: 1, prepare: false });
      try {
        await seed.unsafe(`CREATE TABLE "user" ("id" text PRIMARY KEY, "email" text, "note" text)`);
        await seed.unsafe(
          `INSERT INTO "user" VALUES ('u1', '${DUPLICATE_EMAIL}', '${NOTE_VALUE}'), ('u2', '${DUPLICATE_EMAIL}', '12')`,
        );
      } finally {
        await seed.end();
      }

      root = mkdtempSync(join(tmpdir(), 'danero-migrate-log-'));
      // porušená unikátnost → hodnota klíče v `detail`
      uniqueDir = writeMigration(
        root,
        '0000_unique_email',
        'CREATE UNIQUE INDEX "user_email_unique" ON "user" ("email");',
      );
      // chyba třídy 22 → hodnota z řádku přímo v hlášce
      castDir = writeMigration(
        root,
        '0000_note_to_integer',
        'ALTER TABLE "user" ALTER COLUMN "note" TYPE integer USING "note"::integer;',
      );
    }, 60_000);

    afterAll(async () => {
      if (root) rmSync(root, { recursive: true, force: true });
      await admin.unsafe(`DROP DATABASE IF EXISTS ${name}`);
      await admin.end();
    }, 60_000);

    it(
      'v GitHub Actions migrace nevypíše hodnotu klíče z `detail`, ale SQLSTATE, omezení i dotaz ano',
      {
        timeout: 60_000,
      },
      () => {
        const { status, output } = runScript('db/migrate.mjs', [uniqueDir], databaseUrl, true);

        expect(status).toBe(1);
        expect(output).toContain('Migrace SELHALA');
        expect(output).not.toContain(DUPLICATE_EMAIL);
        expect(output).not.toMatch(/^\s*(detail|hint|where|stack):/m);
        expect(output).toContain('23505'); // SQLSTATE: unique_violation
        expect(output).toContain('constraint_name: user_email_unique');
        expect(output).toContain('table_name: user');
        // text migrace je statické SQL z veřejného repozitáře
        expect(output).toContain('CREATE UNIQUE INDEX "user_email_unique"');
        // ať čtenář logu ví, že výpis není celý a kde celý získá
        expect(output).toContain('mimo GitHub Actions');
      },
    );

    it(
      'v GitHub Actions migrace nevypíše hlášku Postgresu — u chyb třídy 22 nese hodnotu z řádku',
      {
        timeout: 60_000,
      },
      () => {
        const { status, output } = runScript('db/migrate.mjs', [castDir], databaseUrl, true);

        expect(status).toBe(1);
        expect(output).not.toContain(NOTE_VALUE);
        expect(output).not.toContain('invalid input syntax');
        expect(output).toContain('22P02'); // SQLSTATE: invalid_text_representation
        expect(output).toContain('ALTER TABLE "user" ALTER COLUMN "note" TYPE integer');
      },
    );

    it(
      'mimo GitHub Actions zůstává výpis celý — hláška, detail i stack (M-4)',
      {
        timeout: 60_000,
      },
      () => {
        const unique = runScript('db/migrate.mjs', [uniqueDir], databaseUrl, false);
        expect(unique.status).toBe(1);
        expect(unique.output).toContain('23505');
        expect(unique.output).toContain(`detail: Key (email)=(${DUPLICATE_EMAIL}) is duplicated.`);
        expect(unique.output).toMatch(/^\s*stack:/m);
        expect(unique.output).not.toContain('mimo GitHub Actions');

        const cast = runScript('db/migrate.mjs', [castDir], databaseUrl, false);
        expect(cast.status).toBe(1);
        expect(cast.output).toContain(`invalid input syntax for type integer: "${NOTE_VALUE}"`);
      },
    );

    it(
      'stav databáze v GitHub Actions netiskne počet účtů, při ručním spuštění ano',
      {
        timeout: 60_000,
      },
      () => {
        const publicRun = runScript('db/status.mjs', [], databaseUrl, true);
        expect(publicRun.status).toBe(0);
        expect(publicRun.output).toContain('tabulek:');
        expect(publicRun.output).toContain('aplikovaných migrací:');
        expect(publicRun.output).not.toContain('účtů');

        const manualRun = runScript('db/status.mjs', [], databaseUrl, false);
        expect(manualRun.status).toBe(0);
        expect(manualRun.output).toContain('účtů:                 2');
      },
    );
  },
);
