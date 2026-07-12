'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/db';
import { taxpayerProfiles } from '@/db/schema';
import { logAudit } from '@/lib/audit';
import { logEvent } from '@/lib/log';
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
  emtTimeTestExempt: z.enum(['safe', 'lenient']),
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
    emtTimeTestExempt: parsed.data.emtTimeTestExempt === 'lenient',
    updatedAt: new Date(),
  };

  const db = await getDb();
  const existed = await db
    .select({ userId: taxpayerProfiles.userId })
    .from(taxpayerProfiles)
    .where(eq(taxpayerProfiles.userId, user.id));
  await db
    .insert(taxpayerProfiles)
    .values({ userId: user.id, ...values })
    .onConflictDoUpdate({ target: taxpayerProfiles.userId, set: values });
  await logAudit(db, user.id, 'PROFILE_CHANGE');

  revalidatePath('/prehled');
  revalidatePath('/nastaveni');
  // první uložení = onboarding pokračuje na přehled; další změny se ukládají
  // samy (auto-save) a uživatel zůstává u formuláře s potvrzením
  redirect(existed.length === 0 ? '/prehled' : '/nastaveni?ok=profil#dan');
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
  redirect('/nastaveni?ok=notifikace#notifikace');
}
