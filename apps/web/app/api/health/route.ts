import { sql } from 'drizzle-orm';
import { databaseKind, getDb } from '@/db';
import { operatorContactComplete } from '@/lib/contact';
import { invalidSupportEnv, supportAvailable, supportFromEnv } from '@/lib/support';
import journal from '@/db/migrations/meta/_journal.json';
import { errorText, logEvent } from '@/lib/log';

export const dynamic = 'force-dynamic';
// health musí odpovědět rychle i při potížích — bez stropu by ho visící
// databáze držela až do default limitu funkce
export const maxDuration = 15;

/** Kolik migrací má zmigrovaná databáze mít — počet se zapeče při buildu. */
const EXPECTED_MIGRATIONS = journal.entries.length;

/** Nad tímhle už je databáze „nedostupná“, i kdyby nakrásně jen přemýšlela. */
const DB_TIMEOUT_MS = 5_000;

/** Chybějící identifikace provozovatele už v tomhle procesu v logu je. */
let operatorContactLogged = false;

class HealthTimeoutError extends Error {}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    work,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new HealthTimeoutError(`databáze neodpověděla do ${ms} ms`)), ms).unref?.();
    }),
  ]);
}

/** Počet aplikovaných migrací; drizzle si je vede ve vlastním schématu. */
async function appliedMigrations(): Promise<number> {
  const db = await getDb();
  const result = await db.transaction(async (tx) => {
    // ať dotaz nevisí na serveru dál, i když už jsme klientovi odpověděli
    await tx.execute(sql`SET LOCAL statement_timeout = 4000`);
    return tx.execute(sql`SELECT count(*)::int AS applied FROM drizzle.__drizzle_migrations`);
  });
  // postgres.js vrací pole řádků, PGlite objekt s `rows` — health musí umět obojí
  const rows = (Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? [])) as
    Array<{ applied?: number | string }>;
  return Number(rows[0]?.applied ?? 0);
}

/**
 * Health endpoint pro monitoring (G10c) — ověří dostupnost DB. Bez auth
 * (monitorovací služby), ale bez jakýchkoli dat: jen stav a latence.
 *
 * G-7: samotné `SELECT 1` nestačilo. Nezmigrovaná databáze na něj odpoví
 * a health hlásil `200 ok`, zatímco aplikace všude padala na chybějící sloupec.
 */
export async function GET(): Promise<Response> {
  const startedAt = performance.now();
  try {
    const applied = await withTimeout(appliedMigrations(), DB_TIMEOUT_MS);
    const dbLatencyMs = Math.round(performance.now() - startedAt);
    const migrations = { applied, expected: EXPECTED_MIGRATIONS };

    if (applied < EXPECTED_MIGRATIONS) {
      logEvent('error', 'health.migrations_behind', { ...migrations });
      return Response.json(
        { status: 'error', db: 'ok', migrations, dbLatencyMs },
        { status: 503 },
      );
    }
    if (applied > EXPECTED_MIGRATIONS) {
      // databáze je napřed před kódem (rollback nasazení) — aplikace jede,
      // ale je to stav, o kterém chceme vědět
      logEvent('warn', 'health.migrations_ahead', { ...migrations });
    }
    // Chybějící identifikace provozovatele je porušení čl. 13 GDPR (a u
    // podnikatele § 435 OZ). Údaje jdou z prostředí (aby nebyly v public
    // repozitáři), takže je zapomenutelná — health je jediné místo, kde se to
    // pozná dřív než od úřadu. Nevalí to 503: služba běží, jen má díru
    // v povinných údajích.
    // Do logu jen jednou za běh procesu: sonda chodí po 15 s a tisíce stejných
    // chybových řádků denně by přehlušily skutečné chyby (L10-10). Odpověď
    // sama nese `operatorContact` při každém volání.
    const operatorContact = operatorContactComplete() ? 'ok' : 'incomplete';
    if (operatorContact === 'incomplete' && !operatorContactLogged) {
      operatorContactLogged = true;
      logEvent('error', 'health.operator_contact_incomplete', {});
    }
    // Překlep v čísle účtu pro dobrovolný příspěvek se na webu neprojeví
    // chybou — sekce prostě zmizí. Tady je vidět, která proměnná je vadná.
    const invalidSupport = invalidSupportEnv();
    const support =
      invalidSupport.length > 0
        ? 'invalid'
        : supportAvailable(supportFromEnv())
          ? 'ok'
          : 'off';
    if (support === 'invalid') {
      logEvent('error', 'health.support_env_invalid', { error: invalidSupport.join(', ') });
    }
    return Response.json({
      status: 'ok',
      db: 'ok',
      // `postgres` × `pglite`: vlastní instance spuštěná bez DATABASE_URL jede
      // nad souborem vedle aplikace a jinak by vypadala stejně (L10-09)
      dbDriver: databaseKind(),
      dbLatencyMs,
      migrations,
      operatorContact,
      support,
    });
  } catch (error) {
    const timedOut = error instanceof HealthTimeoutError;
    logEvent('error', 'health.db_failed', {
      error: errorText(error),
      dbLatencyMs: Math.round(performance.now() - startedAt),
    });
    return Response.json(
      { status: 'error', db: timedOut ? 'timeout' : 'unreachable' },
      { status: 503 },
    );
  }
}
