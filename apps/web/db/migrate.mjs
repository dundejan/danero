/**
 * Migrace produkční databáze (M-4).
 *
 * Proti `drizzle-kit migrate` dělá jedinou věc navíc: když migrace selže,
 * vypíše chybu CELOU — SQLSTATE, detail, hint, pozici i dotaz, na kterém to
 * spadlo. Bez toho zbyde po neúspěšné produkční migraci pár set bajtů logu
 * bez jediného vodítka, co je špatně.
 *
 * Výjimka: v GitHub Actions (`GITHUB_ACTIONS=true`) je log veřejný, a tak se
 * tam z chyby tiskne jen SQLSTATE, názvy objektů, pozice a text dotazu —
 * hláška, detail, hint, kontext ani stack ne, protože nesou hodnoty z řádků
 * uživatelů (L9-08). Co kam smí, rozhoduje `db/error-report.mjs`.
 *
 *   DATABASE_URL=… node db/migrate.mjs
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { formatMigrationError, isPublicLog, PUBLIC_LOG_NOTICE } from './error-report.mjs';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL není nastavená.');
  process.exit(1);
}

const sql = postgres(url, { max: 1, prepare: false });
try {
  await migrate(drizzle(sql), { migrationsFolder: process.argv[2] ?? 'db/migrations' });
  console.log('Migrace hotové.');
} catch (error) {
  const publicLog = isPublicLog();
  console.error('Migrace SELHALA — databáze zůstala na předchozím stavu:');
  if (publicLog) console.error(PUBLIC_LOG_NOTICE);
  for (const line of formatMigrationError(error, { publicLog })) console.error(line);
  process.exitCode = 1;
} finally {
  await sql.end();
}
