import { randomBytes } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '@/db';
import { account, user as userTable } from '@/db/schema';
import { logAudit } from '@/lib/audit';
import { errorText, logEvent } from '@/lib/log';
import { hashPassword, verifyPassword } from '@/lib/password';

/**
 * Registrace na adresu, která už účet má (L8a-01).
 *
 * Better Auth na ni při `requireEmailVerification` odpoví stejně jako na novou
 * (aby odpověď neprozradila, že adresa účet má), ale heslo nezmění a e-mail
 * nepošle. U NEPOTVRZENÉHO účtu z toho byla díra: kdo si cizí adresu
 * zaregistroval první, znal heslo účtu i poté, co adresu potvrdil její
 * skutečný majitel — ten byl po kliknutí na odkaz rovnou přihlášený, takže na
 * nefunkční vlastní heslo narazil až po vypršení relace, a do té doby nahrával
 * výpisy do účtu, kam se první registrující mohl kdykoli přihlásit.
 *
 * Pravidlo: heslo k nepotvrzenému účtu platí jen do chvíle, než na tutéž adresu
 * přijde registrace s JINÝM heslem. Pak neplatí heslo z žádného pokusu — uložený
 * otisk nahradí otisk náhodného tajemství, které nikdo nezná — a kdo adresu
 * potvrdí, nastaví si heslo přes „Zapomenuté heslo“ (odkaz chodí jen do jeho
 * schránky a zruší i všechny relace).
 *
 * ⚠️ Heslo se schválně NEPŘEPISUJE tím z nového pokusu. Vyhrával by poslední
 * zapisující, takže útočníkovi by stačilo zaregistrovat se jako druhý. A odkaz
 * nejde svázat s konkrétním pokusem: ověřovací token je JWT jen s adresou.
 *
 * Potvrzeného účtu se tohle netýká vůbec — tam o hesle rozhoduje jen majitel.
 *
 * Vědomá cena: kdo zná adresu nepotvrzeného účtu, umí jeho heslo zneplatnit
 * a vyvolat další ověřovací e-mail (strop registrace je 5 za minutu na IP).
 * Totéž platí pro účet, který čeká na potvrzení po změně e-mailu
 * (`changeEmailAction` nastavuje `emailVerified = false`): relace mu zůstane,
 * heslo si vrátí obnovou. Proti převzetí účtu je to přijatelná výměna.
 */

/** Kam vede odkaz z ověřovacího e-mailu — totéž, co posílá registrační formulář. */
const VERIFICATION_CALLBACK_URL = '/overeni-emailu/hotovo';

interface ExistingUser {
  id: string;
  email: string;
  emailVerified: boolean;
}

/**
 * Heslo z těla registrace. `null` = nejde zjistit (serverové volání bez
 * požadavku, jiné tělo než JSON) — volající to bere jako neshodu, protože bez
 * hesla není čím doložit, že se registruje tentýž člověk.
 */
async function passwordFrom(request: Request | undefined): Promise<string | null> {
  if (!request) return null;
  try {
    const body = (await request.json()) as { password?: unknown } | null;
    return typeof body?.password === 'string' ? body.password : null;
  } catch {
    return null;
  }
}

/**
 * Nahradí uložený otisk otiskem tajemství, které nikdo nezná. Vrací, jestli se
 * něco změnilo.
 *
 * Podmínky zápisu hlídají dva souběhy: účet mezitím někdo potvrdil (pak už se
 * hesla nedotýkáme), nebo heslo mezitím změnil majitel obnovou (pak v databázi
 * není otisk, který jsme posuzovali, a jeho nové heslo nesmíme zahodit).
 */
async function invalidatePassword(db: Db, userId: string, judgedHash: string): Promise<boolean> {
  const unknowable = await hashPassword(randomBytes(32).toString('base64url'));
  const stillUnverified = db
    .select({ id: userTable.id })
    .from(userTable)
    .where(and(eq(userTable.id, userId), eq(userTable.emailVerified, false)));
  const replaced = await db
    .update(account)
    .set({ password: unknowable, updatedAt: new Date() })
    .where(
      and(
        eq(account.userId, userId),
        eq(account.providerId, 'credential'),
        eq(account.password, judgedHash),
        inArray(account.userId, stillUnverified),
      ),
    )
    .returning({ id: account.id });
  return replaced.length > 0;
}

/**
 * Háček `emailAndPassword.onExistingUserSignUp`. Nikdy nevyhazuje: odpověď na
 * registraci musí vypadat stejně, ať se uvnitř stalo cokoli.
 */
export async function handleExistingUserSignUp(
  db: Db,
  user: ExistingUser,
  request: Request | undefined,
): Promise<void> {
  // potvrzený účet se nemění a nic se na něj neposílá
  if (user.emailVerified) return;
  try {
    const password = await passwordFrom(request);
    const [credential] = await db
      .select({ hash: account.password })
      .from(account)
      .where(and(eq(account.userId, user.id), eq(account.providerId, 'credential')));
    const storedHash = credential?.hash ?? null;

    const samePerson =
      password !== null &&
      storedHash !== null &&
      (await verifyPassword({ hash: storedHash, password }));
    if (!samePerson && storedHash !== null && (await invalidatePassword(db, user.id, storedHash))) {
      await logAudit(
        db,
        user.id,
        'PASSWORD_CHANGE',
        'zrušeno — na účet s nepotvrzeným e-mailem přišla registrace s jiným heslem',
      );
    }

    // Odkaz dostane i ten, kdo se registruje podruhé stejným heslem (první
    // e-mail mohl zapadnout). Skládá ho Better Auth sám, ne my — a potvrzený
    // účet přeskočí, kdyby ho mezitím někdo potvrdil. Import je líný kvůli
    // kruhu: `lib/auth.ts` tenhle modul zapojuje.
    const { getAuth } = await import('@/lib/auth');
    const auth = await getAuth();
    await auth.api.sendVerificationEmail({
      body: { email: user.email, callbackURL: VERIFICATION_CALLBACK_URL },
    });
  } catch (error) {
    logEvent('error', 'auth.existing_signup_failed', { userId: user.id, error: errorText(error) });
  }
}
