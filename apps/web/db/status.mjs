/**
 * Stav produkční databáze: počet tabulek a aplikovaných migrací. Nevypisuje
 * připojovací řetězec — hodí se do CI logu i do terminálu.
 *   DATABASE_URL=… node db/status.mjs
 *
 * MUSÍ projít i nad čerstvou, ještě nezmigrovanou databází: v
 * .github/workflows/migrate.yml běží jako krok „Stav před" PŘED migrací, takže
 * kdyby padal na chybějící `drizzle.__drizzle_migrations`, workflow by skončil
 * dřív, než se k migraci dostane — a nová databáze by se přes CI nikdy
 * nezmigrovala (audit G-M1).
 */
import postgres from 'postgres';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL není nastavená.');
  process.exit(1);
}

const sql = postgres(url, { max: 1, prepare: false });

/** Existuje relace? `to_regclass` vrací NULL místo chyby 42P01 (i u chybějícího schématu). */
async function tableExists(name) {
  const [row] = await sql`SELECT to_regclass(${name}) IS NOT NULL AS present`;
  return row.present;
}

try {
  const [tables] = await sql`
    SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema = 'public'`;
  console.log(`tabulek:              ${tables.count}`);

  if (await tableExists('drizzle.__drizzle_migrations')) {
    const [migrations] = await sql`
      SELECT count(*)::int AS count, max(created_at) AS last FROM drizzle.__drizzle_migrations`;
    console.log(`aplikovaných migrací: ${migrations.count}`);
    console.log(
      `poslední migrace:     ${migrations.last ? new Date(Number(migrations.last)).toISOString() : '—'}`,
    );
  } else {
    console.log('aplikovaných migrací: 0 (databáze ještě nebyla migrovaná)');
  }

  if (await tableExists('public."user"')) {
    const [users] = await sql`SELECT count(*)::int AS count FROM "user"`;
    console.log(`účtů:                 ${users.count}`);
  } else {
    console.log('účtů:                 — (schéma ještě nevzniklo)');
  }
} catch (error) {
  // hláška i SQLSTATE, ale bez stack trace — ten je v CI logu jen šum
  console.error(`Stav databáze se nepodařilo zjistit: ${error.message}`);
  if (error.code) console.error(`SQLSTATE: ${error.code}`);
  process.exitCode = 1;
} finally {
  await sql.end();
}
