'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { after } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/db';
import { brokerAccounts, taxpayerProfiles } from '@/db/schema';
import { logAudit } from '@/lib/audit';
import { logEvent } from '@/lib/log';
import { encryptSecret } from '@/lib/crypto';
import { enqueueSyncJob, jobTypeForBroker, processJob } from '@/lib/jobs';
import { portfolioFromForm } from '@/lib/portfolio-context';
import { authApi, requireUser } from '@/lib/session';

const ProfileFormSchema = z.object({
  regime: z.enum(['PAUSAL', 'ZAMESTNANEC', 'OSVC', 'JINE']),
  hasBusinessAssets: z.literal('on').optional(),
  otherIncomeCzk: z
    .string()
    .transform((v) => v.replace(',', '.').trim() || '0')
    .refine((v) => /^\d+(\.\d{1,2})?$/.test(v), 'Zadej částku v Kč'),
  matchingMethod: z.enum(['FIFO', 'LIFO', 'MAX_PROFIT', 'MAX_LOSS']),
  fxMethod: z.enum(['UNIFIED', 'CNB_DAILY']),
  limit100kStrict: z.enum(['strict', 'lenient']),
  timeTestBasis: z.enum(['settlement', 'trade']),
  derivativesExpensesPerDruh: z.enum(['restrictive', 'perDruh']),
});



export async function saveProfileAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const parsed = ProfileFormSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) redirect('/nastaveni?chyba=formular');

  const values = {
    regime: parsed.data.regime,
    hasBusinessAssets: parsed.data.hasBusinessAssets === 'on',
    otherIncomeCzk: parsed.data.otherIncomeCzk,
    matchingMethod: parsed.data.matchingMethod,
    fxMethod: parsed.data.fxMethod,
    limit100kStrict: parsed.data.limit100kStrict === 'strict',
    timeTestBasis: parsed.data.timeTestBasis,
    derivativesExpensesPerDruh: parsed.data.derivativesExpensesPerDruh === 'perDruh',
    updatedAt: new Date(),
  };

  const db = await getDb();
  const portfolio = await portfolioFromForm(db, user.id, formData);
  await db
    .insert(taxpayerProfiles)
    .values({ userId: user.id, portfolioId: portfolio.id, ...values })
    .onConflictDoUpdate({ target: taxpayerProfiles.portfolioId, set: values });
  await logAudit(db, user.id, 'PROFILE_CHANGE');

  revalidatePath('/prehled');
  revalidatePath('/nastaveni');
  redirect('/prehled');
}

/** Uloží T212 API přístup (ID klíče + tajný klíč, šifrovaně) — jeden účet na uživatele. */
export async function saveTrading212KeyAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const keyId = String(formData.get('keyId') ?? '').trim();
  const secret = String(formData.get('secret') ?? '').trim();
  if (secret.length < 10) redirect('/nastaveni?chyba=api-klic');

  const db = await getDb();
  const portfolio = await portfolioFromForm(db, user.id, formData);
  await db
    .delete(brokerAccounts)
    .where(
      and(
        eq(brokerAccounts.userId, user.id),
        eq(brokerAccounts.portfolioId, portfolio.id),
        eq(brokerAccounts.broker, 'trading212'),
      ),
    );
  await db.insert(brokerAccounts).values({
    id: crypto.randomUUID(),
    userId: user.id,
    portfolioId: portfolio.id,
    broker: 'trading212',
    credentialsEncrypted: encryptSecret(JSON.stringify({ keyId: keyId || undefined, secret })),
  });

  await logAudit(db, user.id, 'BROKER_CONNECTED', 'Trading212');
  revalidatePath('/nastaveni');
  revalidatePath('/import');
  redirect('/import');
}

/** Uloží IBKR Flex přístup (token + query ID, šifrovaně) — jeden IBKR účet na uživatele. */
export async function saveIbkrKeyAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const token = String(formData.get('token') ?? '').trim();
  const queryId = String(formData.get('queryId') ?? '').trim();
  if (token.length < 10 || !/^\d+$/.test(queryId)) redirect('/nastaveni?chyba=ibkr');

  const db = await getDb();
  const portfolio = await portfolioFromForm(db, user.id, formData);
  await db
    .delete(brokerAccounts)
    .where(
      and(
        eq(brokerAccounts.userId, user.id),
        eq(brokerAccounts.portfolioId, portfolio.id),
        eq(brokerAccounts.broker, 'ibkr'),
      ),
    );
  await db.insert(brokerAccounts).values({
    id: crypto.randomUUID(),
    userId: user.id,
    portfolioId: portfolio.id,
    broker: 'ibkr',
    label: 'Interactive Brokers',
    credentialsEncrypted: encryptSecret(JSON.stringify({ token, queryId })),
  });

  await logAudit(db, user.id, 'BROKER_CONNECTED', 'Interactive Brokers');
  revalidatePath('/nastaveni');
  revalidatePath('/import');
  redirect('/import');
}

/** Odpojí jeden broker účet (multi-broker: každá karta má vlastní tlačítko). */
export async function disconnectBrokerAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const accountId = String(formData.get('accountId') ?? '');
  const db = await getDb();
  const deleted = await db
    .delete(brokerAccounts)
    .where(and(eq(brokerAccounts.userId, user.id), eq(brokerAccounts.id, accountId)))
    .returning({ id: brokerAccounts.id });
  // tiché „nic se nesmazalo“ nesmí vypadat jako úspěch (stale formulář apod.)
  if (deleted.length === 0) redirect('/nastaveni?chyba=zadny-ucet');
  await logAudit(db, user.id, 'BROKER_DISCONNECTED');
  revalidatePath('/nastaveni');
  revalidatePath('/import');
  redirect('/nastaveni');
}

/**
 * Ruční synchronizace broker účtu: zapíše background job a hned se vrátí —
 * samotný běh (klidně deset minut) startuje after() po odeslání odpovědi,
 * průběh polluje /import. Chyby běhu končí v jobs.error (viz lib/jobs.ts).
 */
export async function syncBrokerAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const accountId = String(formData.get('accountId') ?? '');
  const db = await getDb();
  const accounts = await db
    .select()
    .from(brokerAccounts)
    .where(and(eq(brokerAccounts.userId, user.id), eq(brokerAccounts.id, accountId)));
  const account = accounts[0];
  if (!account) redirect('/nastaveni?chyba=zadny-ucet');

  const job = await enqueueSyncJob(db, user.id, account.id, jobTypeForBroker(account.broker));
  if (job.status === 'pending') {
    after(() => processJob(db, job.id));
  }

  revalidatePath('/import');
  redirect('/import');
}

/* ── G8a: účet — změna hesla, e-mailu, smazání (GDPR práva z /soukromi) ──── */

const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(10),
});

export async function changePasswordAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const parsed = ChangePasswordSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) redirect('/nastaveni?chyba=heslo');

  const { api, requestHeaders } = await authApi();
  try {
    await api.changePassword({
      headers: requestHeaders,
      body: {
        currentPassword: parsed.data.currentPassword,
        newPassword: parsed.data.newPassword,
        revokeOtherSessions: true, // po změně hesla odhlásit ostatní zařízení
      },
    });
  } catch (error) {
    // infrastrukturní chyba nesmí být němá — jinak „špatné heslo“ maskuje výpadek
    logEvent('error', 'account.change_password_failed', { error: error instanceof Error ? error.message : String(error) });
    redirect('/nastaveni?chyba=heslo-spatne');
  }
  // audit PŘES id z úvodní session — po rotaci session by requireUser selhal
  await logAudit(await getDb(), user.id, 'PASSWORD_CHANGE');
  redirect('/nastaveni?ok=heslo');
}

const ChangeEmailSchema = z.object({
  newEmail: z.string().email(),
  currentPassword: z.string().min(1),
});

export async function changeEmailAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const parsed = ChangeEmailSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) redirect('/nastaveni?chyba=email');

  // re-autentizace heslem: bez verifikačních e-mailů (Resend čeká na klíč) by
  // unesená session mohla tiše přepsat identitu účtu — heslo to blokuje
  {
    const db = await getDb();
    const { account } = await import('@/db/schema');
    const [credential] = await db
      .select({ hash: account.password })
      .from(account)
      .where(and(eq(account.userId, user.id), eq(account.providerId, 'credential')));
    const { verifyPassword } = await import('better-auth/crypto');
    const valid =
      credential?.hash &&
      (await verifyPassword({ hash: credential.hash, password: parsed.data.currentPassword }));
    if (!valid) redirect('/nastaveni?chyba=email-heslo');
  }

  const { api, requestHeaders } = await authApi();
  try {
    await api.changeEmail({
      headers: requestHeaders,
      body: { newEmail: parsed.data.newEmail },
    });
  } catch (error) {
    logEvent('error', 'account.change_email_failed', { error: error instanceof Error ? error.message : String(error) });
    redirect('/nastaveni?chyba=email-obsazeny');
  }
  await logAudit(await getDb(), user.id, 'EMAIL_CHANGE');
  revalidatePath('/nastaveni');
  redirect('/nastaveni?ok=email');
}

const DeleteAccountSchema = z.object({
  password: z.string().min(1),
  potvrzeni: z.literal('SMAZAT'),
});

export async function deleteAccountAction(formData: FormData): Promise<void> {
  await requireUser();
  const parsed = DeleteAccountSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) redirect('/nastaveni?chyba=smazani');

  const { api, requestHeaders } = await authApi();
  try {
    // hard delete: Better Auth smaže user/session/account, FK kaskády zbytek
    // (profil, transakce, šifrované broker klíče, notifikace, joby, ceny)
    await api.deleteUser({
      headers: requestHeaders,
      body: { password: parsed.data.password },
    });
  } catch (error) {
    logEvent('error', 'account.delete_failed', { error: error instanceof Error ? error.message : String(error) });
    redirect('/nastaveni?chyba=smazani-heslo');
  }
  redirect('/?smazano=1');
}


export async function revokeOtherSessionsAction(): Promise<void> {
  const user = await requireUser();
  const { api, requestHeaders } = await authApi();
  await api.revokeOtherSessions({ headers: requestHeaders });
  await logAudit(await getDb(), user.id, 'SESSIONS_REVOKED');
  revalidatePath('/nastaveni');
  redirect('/nastaveni?ok=odhlaseno');
}

/* ── G8c: portfolia (více osob pod jedním účtem) ─────────────────────────── */

export async function switchPortfolioAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const portfolioId = String(formData.get('portfolioId') ?? '');
  const db = await getDb();
  const { listPortfolios, PORTFOLIO_COOKIE } = await import('@/lib/portfolio-context');
  const owned = await listPortfolios(db, user.id);
  if (!owned.some((p) => p.id === portfolioId)) redirect('/prehled');
  const { cookies } = await import('next/headers');
  (await cookies()).set(PORTFOLIO_COOKIE, portfolioId, {
    path: '/',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 365,
  });
  revalidatePath('/', 'layout');
  redirect(String(formData.get('zpet') ?? '/prehled'));
}

export async function createPortfolioAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const name = String(formData.get('nazev') ?? '').trim();
  if (name.length === 0 || name.length > 60) redirect('/nastaveni?chyba=portfolio-nazev');
  const db = await getDb();
  const { listPortfolios, PORTFOLIO_COOKIE } = await import('@/lib/portfolio-context');
  if ((await listPortfolios(db, user.id)).length >= 10) {
    redirect('/nastaveni?chyba=portfolio-limit');
  }
  const { portfolios } = await import('@/db/schema');
  const [created] = await db
    .insert(portfolios)
    .values({ userId: user.id, name })
    .returning();
  // nové portfolio rovnou aktivovat — uživatel jde typicky hned nastavit profil
  const { cookies } = await import('next/headers');
  (await cookies()).set(PORTFOLIO_COOKIE, created!.id, { path: '/', sameSite: 'lax', maxAge: 60 * 60 * 24 * 365 });
  revalidatePath('/', 'layout');
  redirect('/nastaveni?ok=portfolio');
}

export async function renamePortfolioAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const portfolioId = String(formData.get('portfolioId') ?? '');
  const name = String(formData.get('nazev') ?? '').trim();
  if (name.length === 0 || name.length > 60) redirect('/nastaveni?chyba=portfolio-nazev');
  const db = await getDb();
  const { portfolios } = await import('@/db/schema');
  await db
    .update(portfolios)
    .set({ name })
    .where(and(eq(portfolios.userId, user.id), eq(portfolios.id, portfolioId)));
  revalidatePath('/', 'layout');
  redirect('/nastaveni');
}

export async function deletePortfolioAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const portfolioId = String(formData.get('portfolioId') ?? '');
  if (String(formData.get('potvrzeni') ?? '') !== 'SMAZAT') {
    redirect('/nastaveni?chyba=portfolio-smazani');
  }
  const db = await getDb();
  const { listPortfolios, PORTFOLIO_COOKIE } = await import('@/lib/portfolio-context');
  const owned = await listPortfolios(db, user.id);
  // poslední portfolio smazat nejde — účet bez portfolia nedává smysl
  if (owned.length <= 1 || !owned.some((p) => p.id === portfolioId)) {
    redirect('/nastaveni?chyba=portfolio-posledni');
  }
  const { portfolios } = await import('@/db/schema');
  // FK kaskády smažou transakce, profil, broker účty (vč. klíčů) i notifikace
  await db
    .delete(portfolios)
    .where(and(eq(portfolios.userId, user.id), eq(portfolios.id, portfolioId)));
  (await cookies()).delete(PORTFOLIO_COOKIE);
  revalidatePath('/', 'layout');
  redirect('/nastaveni?ok=portfolio-smazano');
}

/* ── G8d + H3: notifikační preference ────────────────────────────────────── */

export async function saveNotificationPrefsAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const db = await getDb();
  const { notificationPrefs } = await import('@/db/schema');
  const values = {
    emailEnabled: formData.get('emailEnabled') === 'on',
    timeTestEvents: formData.get('timeTestEvents') === 'on',
    limitEvents: formData.get('limitEvents') === 'on',
    calendarEmails: formData.get('calendarEmails') === 'on',
    // radio validujeme na whitelist — cokoli jiného spadne na bezpečný default
    emailFrequency: formData.get('emailFrequency') === 'WEEKLY' ? 'WEEKLY' : 'DAILY',
    updatedAt: new Date(),
  };
  await db
    .insert(notificationPrefs)
    .values({ userId: user.id, ...values })
    .onConflictDoUpdate({ target: notificationPrefs.userId, set: values });
  revalidatePath('/nastaveni');
  redirect('/nastaveni?ok=notifikace');
}
