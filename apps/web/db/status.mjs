/**
 * Stav produkční databáze: počet tabulek a aplikovaných migrací. Nevypisuje
 * připojovací řetězec — hodí se do CI logu i do terminálu.
 *   DATABASE_URL=… node db/status.mjs
 */
import postgres from 'postgres';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL není nastavená.');
  process.exit(1);
}

const sql = postgres(url, { max: 1, prepare: false });
try {
  const [tables] = await sql`
    SELECT count(*)::int AS pocet FROM information_schema.tables WHERE table_schema = 'public'`;
  const [migrations] = await sql`
    SELECT count(*)::int AS pocet, max(created_at) AS posledni FROM drizzle.__drizzle_migrations`;
  const [users] = await sql`SELECT count(*)::int AS pocet FROM "user"`;

  console.log(`tabulek:            ${tables.pocet}`);
  console.log(`aplikovaných migrací: ${migrations.pocet}`);
  console.log(
    `poslední migrace:   ${migrations.posledni ? new Date(Number(migrations.posledni)).toISOString() : '—'}`,
  );
  console.log(`účtů:               ${users.pocet}`);
} finally {
  await sql.end();
}
