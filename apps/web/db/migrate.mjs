/**
 * Migrace produkční databáze (M-4).
 *
 * Proti `drizzle-kit migrate` dělá jedinou věc navíc: když migrace selže,
 * vypíše chybu CELOU — SQLSTATE, detail, hint, pozici i dotaz, na kterém to
 * spadlo. Bez toho zbyde po neúspěšné produkční migraci pár set bajtů logu
 * bez jediného vodítka, co je špatně.
 *
 *   DATABASE_URL=… node db/migrate.mjs
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL není nastavená.');
  process.exit(1);
}

/** Pole, která postgres.js nese na chybě — právě ta v logu chybějí. */
const FIELDS = [
  'code',
  'severity',
  'detail',
  'hint',
  'position',
  'where',
  'schema_name',
  'table_name',
  'column_name',
  'constraint_name',
  'routine',
  'query',
];

function printError(error, depth = 0) {
  const prefix = ' '.repeat(depth * 2);
  console.error(`${prefix}${error?.name ?? 'Error'}: ${error?.message ?? String(error)}`);
  for (const field of FIELDS) {
    if (error?.[field] !== undefined && error[field] !== null) {
      console.error(`${prefix}  ${field}: ${error[field]}`);
    }
  }
  if (error?.stack) console.error(`${prefix}  stack: ${error.stack}`);
  // drizzle chybu obaluje — SQLSTATE bývá až v příčině
  if (error?.cause) printError(error.cause, depth + 1);
}

const sql = postgres(url, { max: 1, prepare: false });
try {
  await migrate(drizzle(sql), { migrationsFolder: process.argv[2] ?? 'db/migrations' });
  console.log('Migrace hotové.');
} catch (error) {
  console.error('Migrace SELHALA — databáze zůstala na předchozím stavu:');
  printError(error);
  process.exitCode = 1;
} finally {
  await sql.end();
}
