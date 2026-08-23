/**
 * Vypnutí dvoufaktorového ověření na žádost uživatele (K2-01).
 *
 * Nástroj pro provozovatele, ne pro uživatele. Kdo přijde o telefon i o záložní
 * kódy, nemá jak dovnitř: obnova hesla druhý faktor NEOBEJDE (nové heslo pořád
 * žádá kód z autentikátoru). Bez tohohle skriptu zbývalo jen ruční SQL nad
 * produkční databází, a to je přesně ta operace, u které se člověk uklikne.
 *
 * Spuštění (z apps/web; proti produkci s DATABASE_URL v prostředí):
 *   pnpm --filter @danero/web exec tsx scripts/two-factor.ts status <e-mail>
 *   pnpm --filter @danero/web exec tsx scripts/two-factor.ts disable <e-mail>
 *
 * ⚠️ Vypnutí je bezpečnostní ústupek: kdo umí napsat e-mail „přišel jsem
 * o telefon", tím obejde druhý faktor. Ověř totožnost dřív, než to spustíš —
 * skript proto chce ještě potvrzení `--potvrzuji` a zapíše se do auditu účtu,
 * aby to uživatel v Nastavení viděl.
 *
 * ⚠️ Bez `DATABASE_URL` sáhne na lokální PGlite — ta snese **jediné připojení**,
 * takže souběžně běžící dev server skript zablokuje (a naopak).
 */
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { session, twoFactor, user } from '@/db/schema';
import { logAudit } from '@/lib/audit';

const [command, ...args] = process.argv.slice(2);

function usage(): never {
  console.error('Použití: two-factor status <e-mail> | disable <e-mail> --potvrzuji');
  process.exit(1);
}

/** Povinný argument — chybějící e-mail je překlep, ne prázdná hodnota. */
function required(index: number): string {
  return args[index] ?? usage();
}

async function findUser(email: string) {
  const db = await getDb();
  const [found] = await db
    .select()
    .from(user)
    .where(eq(user.email, email.toLowerCase()));
  if (!found) {
    console.error(`Účet ${email} neexistuje.`);
    process.exit(1);
  }
  return { db, found };
}

async function status(email: string): Promise<void> {
  const { db, found } = await findUser(email);
  const rows = await db.select().from(twoFactor).where(eq(twoFactor.userId, found.id));
  console.log(
    [
      `účet:            ${found.email} (${found.id})`,
      `2FA zapnuté:     ${found.twoFactorEnabled ? 'ano' : 'ne'}`,
      `řádků two_factor: ${rows.length}`,
      ...rows.map(
        (row) =>
          `  ověřené: ${row.verified ? 'ano' : 'ne'} · nezdařených pokusů: ${row.failedVerificationCount}` +
          (row.lockedUntil ? ` · zamčeno do ${row.lockedUntil.toISOString()}` : ''),
      ),
    ].join('\n'),
  );
}

async function disable(email: string): Promise<void> {
  if (!args.includes('--potvrzuji')) {
    console.error(
      'Vypnutí druhého faktoru je bezpečnostní ústupek — ověř totožnost žadatele\n' +
        'a spusť to znovu s `--potvrzuji`.',
    );
    process.exit(1);
  }
  const { db, found } = await findUser(email);
  if (!found.twoFactorEnabled) {
    console.log(`${found.email}: 2FA není zapnuté, není co vypínat.`);
    return;
  }
  await db.delete(twoFactor).where(eq(twoFactor.userId, found.id));
  await db.update(user).set({ twoFactorEnabled: false }).where(eq(user.id, found.id));
  // Relace zahazujeme schválně: kdyby účet mezitím někdo ovládl, ať mu vypnutí
  // faktoru neponechá živé přihlášení.
  const revoked = await db
    .delete(session)
    .where(eq(session.userId, found.id))
    .returning({ id: session.id });
  await logAudit(db, found.id, 'TWO_FACTOR_DISABLED', 'vypnul provozovatel na žádost uživatele');
  console.log(
    `${found.email}: 2FA vypnuté, zahozeno relací: ${revoked.length}. ` +
      'Uživatel se přihlásí heslem a může si faktor zapnout znovu.',
  );
}

// obal místo top-level await: apps/web není ESM balík, takže tsx tenhle
// soubor překládá do CJS a top-level await by se do něj nevešel
async function main(): Promise<void> {
  switch (command) {
    case 'status':
      return status(required(0));
    case 'disable':
      return disable(required(0));
    default:
      usage();
  }
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(error);
    process.exit(1);
  },
);
