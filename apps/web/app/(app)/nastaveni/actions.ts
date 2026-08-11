'use server';

import { revalidatePath } from 'next/cache';
import { d } from '@danero/shared';
import { redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/db';
import { taxpayerProfiles } from '@/db/schema';
import { logAudit } from '@/lib/audit';
import { errorText, logEvent } from '@/lib/log';
import { unpinTaxYear } from '@/lib/portfolio';
import { authApi, requireUser } from '@/lib/session';

/**
 * Klíče schématu = `name` atributy formuláře, které jsou podle pravidla 1
 * z CLAUDE.md česky (uživatel je vidí v DOM). Na anglické identifikátory se
 * překlápějí hned níž, takže dál v kódu ani v databázi čeština není.
 */
const ProfileFormSchema = z.object({
  rezim: z.enum(['PAUSAL', 'ZAMESTNANEC', 'OSVC', 'JINE']),
  'obchodni-majetek': z.literal('on').optional(),
  'ostatni-prijmy': z
    .string()
    .transform((v) => v.replace(',', '.').trim() || '0')
    .refine((v) => /^\d+(\.\d{1,2})?$/.test(v), 'Zadej částku v Kč')
    // horní mez: bilion Kč — bez ní by nesmyslný vstup přetekl DB numeric(18,2)
    .refine((v) => d(v).lte('1000000000000'), 'Částka je nereálně vysoká — zkontroluj ji.'),
  parovani: z.enum(['FIFO', 'LIFO', 'MAX_PROFIT', 'MAX_LOSS']),
  kurzy: z.enum(['UNIFIED', 'CNB_DAILY']),
  'limit-100k': z.enum(['strict', 'lenient']),
  'zaklad-casoveho-testu': z.enum(['settlement', 'trade']),
  'derivaty-vydaje': z.enum(['restrictive', 'perType']),
  'emt-casovy-test': z.enum(['safe', 'lenient']),
});

export async function saveProfileAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const parsed = ProfileFormSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) redirect('/nastaveni?chyba=formular');

  const values = {
    regime: parsed.data.rezim,
    hasBusinessAssets: parsed.data['obchodni-majetek'] === 'on',
    otherIncomeCzk: parsed.data['ostatni-prijmy'],
    matchingMethod: parsed.data.parovani,
    fxMethod: parsed.data.kurzy,
    limit100kStrict: parsed.data['limit-100k'] === 'strict',
    timeTestBasis: parsed.data['zaklad-casoveho-testu'],
    derivativesExpensesPerType: parsed.data['derivaty-vydaje'] === 'perType',
    emtTimeTestExempt: parsed.data['emt-casovy-test'] === 'lenient',
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

/**
 * R-05c: zrušení fixace konfigurace za jeden rok. Uživatel se tím odemyká pro
 * dodatečné přiznání — rok se zase počítá podle profilu.
 * Potvrzení řeší formulář v UI (rozbalovací krok), tady se jen ověří rok.
 */
const UnpinFormSchema = z.object({
  rok: z.coerce.number().int().min(2000).max(2100),
});

export async function unpinTaxYearAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const parsed = UnpinFormSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) redirect('/nastaveni?chyba=fixace');
  const year = parsed.data.rok;

  const db = await getDb();
  await unpinTaxYear(db, user.id, year);
  await logAudit(db, user.id, 'PROFILE_CHANGE', `zrušena fixace výpočtu za rok ${year}`);

  revalidatePath('/prehled');
  revalidatePath('/report');
  revalidatePath('/nastaveni');
  redirect('/nastaveni?ok=fixace#fixace');
}

/* ── G8a: účet — změna hesla, e-mailu, smazání (GDPR práva z /soukromi) ──── */

/**
 * D-2/D-3: server actions volají `auth.api.*` napřímo, jenže rate limity
 * z `lib/auth.ts` visí na `router.onRequest`, tedy jen na `/api/auth/*` —
 * tudy se obejdou. Bez tohohle je z unesené session neomezený password oracle
 * (uhádnuté heslo = změna e-mailu i vypnutí 2FA) a formulář změny e-mailu je
 * rozesílač ověřovacích e-mailů na libovolné cizí adresy.
 *
 * Čítač je per ÚČET, ne per IP: útočníkovi nepomůže střídat adresy ani
 * podvrhávat `X-Forwarded-For`. Limity jsou stejné jako u odpovídajících
 * endpointů Better Authu, jen v okně 5 minut.
 */
const ACCOUNT_WINDOW_MS = 5 * 60_000;

async function limitAccountAction(
  userId: string,
  operation: string,
  max: number,
  errorCode: string,
): Promise<void> {
  const { checkRateLimit } = await import('@/lib/rate-limit');
  const allowed = await checkRateLimit(await getDb(), `${operation}:${userId}`, {
    max,
    windowMs: ACCOUNT_WINDOW_MS,
  });
  if (!allowed) {
    logEvent('warn', `account.${operation}_rate_limited`, { userId });
    redirect(`/nastaveni/ucet?chyba=${errorCode}`);
  }
}

const ChangePasswordSchema = z.object({
  'stavajici-heslo': z.string().min(1),
  'nove-heslo': z.string().min(10),
});

export async function changePasswordAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const parsed = ChangePasswordSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) redirect('/nastaveni/ucet?chyba=heslo');
  await limitAccountAction(user.id, 'password_change', 5, 'heslo-limit');

  const { api, requestHeaders } = await authApi();
  try {
    await api.changePassword({
      headers: requestHeaders,
      body: {
        currentPassword: parsed.data['stavajici-heslo'],
        newPassword: parsed.data['nove-heslo'],
        revokeOtherSessions: true, // po změně hesla odhlásit ostatní zařízení
      },
    });
  } catch (error) {
    // infrastrukturní chyba nesmí být němá — jinak „špatné heslo“ maskuje výpadek.
    // G-16: bez userId nejde v logu odlišit jeden opakovaně chybující účet
    // od stovky překlepů různých uživatelů
    logEvent('error', 'account.change_password_failed', { userId: user.id, error: errorText(error) });
    redirect('/nastaveni/ucet?chyba=heslo-spatne');
  }
  // audit PŘES id z úvodní session — po rotaci session by requireUser selhal
  await logAudit(await getDb(), user.id, 'PASSWORD_CHANGE');
  redirect('/nastaveni/ucet?ok=heslo');
}

const ChangeEmailSchema = z.object({
  'novy-email': z.email(),
  'stavajici-heslo': z.string().min(1),
});

export async function changeEmailAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const parsed = ChangeEmailSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) redirect('/nastaveni/ucet?chyba=email');
  // limit sedí i na odesílání ověřovacích e-mailů níž — jinak je z formuláře
  // rozesílač na cizí adresy jménem Danera
  await limitAccountAction(user.id, 'email_change', 3, 'email-limit');

  // re-autentizace heslem: bez verifikačních e-mailů (Resend čeká na klíč) by
  // unesená session mohla tiše přepsat identitu účtu — heslo to blokuje
  {
    const db = await getDb();
    const { account } = await import('@/db/schema');
    const [credential] = await db
      .select({ hash: account.password })
      .from(account)
      .where(and(eq(account.userId, user.id), eq(account.providerId, 'credential')));
    // stejná funkce jako v lib/auth.ts — otisky si počítá lib/password.ts
    // (scrypt s vlastními parametry), takže vestavěná verifyPassword
    // z Better Authu by je neověřila
    const { verifyPassword } = await import('@/lib/password');
    const valid =
      credential?.hash &&
      (await verifyPassword({ hash: credential.hash, password: parsed.data['stavajici-heslo'] }));
    if (!valid) redirect('/nastaveni/ucet?chyba=email-heslo');
  }

  // endpoint /change-email je vypnutý (obcházel kontrolu hesla) — e-mail se
  // mění přímo tady, unikátnost hlídá DB constraint
  try {
    const db = await getDb();
    const { user: userTable } = await import('@/db/schema');
    await db
      .update(userTable)
      // nová adresa je nepotvrzená: kdyby v ní byl překlep, uživatel by jinak
      // tiše přišel o upozornění i o obnovu hesla (ta chodí právě sem)
      .set({ email: parsed.data['novy-email'].toLowerCase(), emailVerified: false, updatedAt: new Date() })
      .where(eq(userTable.id, user.id));
  } catch (error) {
    logEvent('error', 'account.change_email_failed', { userId: user.id, error: errorText(error) });
    // „obsazený e-mail“ jen při unique violation — infrastrukturní chybu (výpadek
    // DB apod.) nesmíme vydávat za obsazenou adresu
    const { isUniqueViolation } = await import('@/lib/db-errors');
    redirect(
      isUniqueViolation(error) ? '/nastaveni/ucet?chyba=email-obsazeny' : '/nastaveni/ucet?chyba=email-ulozeni',
    );
  }
  await logAudit(await getDb(), user.id, 'EMAIL_CHANGE');
  // ověřovací odkaz na novou adresu; selhání odeslání nesmí shodit už provedenou
  // změnu — uživatel si odkaz vyžádá znovu na /overeni-emailu
  try {
    const { authApi } = await import('@/lib/session');
    const { api } = await authApi();
    await api.sendVerificationEmail({
      body: { email: parsed.data['novy-email'].toLowerCase(), callbackURL: '/overeni-emailu' },
    });
  } catch (error) {
    logEvent('error', 'account.change_email_verification_failed', {
      userId: user.id,
      error: errorText(error),
    });
  }
  revalidatePath('/nastaveni/ucet');
  redirect('/nastaveni/ucet?ok=email');
}

const DeleteAccountSchema = z.object({
  heslo: z.string().min(1),
  potvrzeni: z.literal('SMAZAT'),
});

export async function deleteAccountAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const parsed = DeleteAccountSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) redirect('/nastaveni/ucet?chyba=smazani');
  await limitAccountAction(user.id, 'account_delete', 3, 'smazani-limit');

  // ID předplatného si přečteme PŘED smazáním (kaskáda řádek zahodí), ale zrušit
  // ho smíme až POTOM: heslo ověřuje teprve deleteUser a špatné heslo nesmí
  // nikomu zrušit placenou službu.
  const { pendingSubscriptionId, cancelStripeSubscription } = await import('@/lib/billing');
  const subscriptionId = await pendingSubscriptionId(await getDb(), user.id);

  const { api, requestHeaders } = await authApi();
  try {
    // hard delete: Better Auth smaže user/session/account, FK kaskády zbytek
    // (profil, transakce, šifrované broker klíče, notifikace, joby, ceny)
    await api.deleteUser({
      headers: requestHeaders,
      body: { password: parsed.data.heslo },
    });
  } catch (error) {
    logEvent('error', 'account.delete_failed', { userId: user.id, error: errorText(error) });
    redirect('/nastaveni/ucet?chyba=smazani-heslo');
  }

  // Bez tohohle by zákazníkovi bez účtu chodila platba dál a neměl by ji jak
  // zastavit — do zákaznického portálu se vchází jen přihlášením.
  if (subscriptionId) await cancelStripeSubscription(subscriptionId, user.id);
  redirect('/?smazano=1');
}

export async function revokeOtherSessionsAction(): Promise<void> {
  const user = await requireUser();
  const { api, requestHeaders } = await authApi();
  await api.revokeOtherSessions({ headers: requestHeaders });
  await logAudit(await getDb(), user.id, 'SESSIONS_REVOKED');
  revalidatePath('/nastaveni/ucet');
  redirect('/nastaveni/ucet?ok=odhlaseno');
}

/* ── G8d + H3: notifikační preference ────────────────────────────────────── */

export async function saveNotificationPrefsAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const db = await getDb();
  const { notificationPrefs } = await import('@/db/schema');
  const {
    DEADLINE_LEAD_OPTIONS,
    DEFAULT_NOTIFICATION_RULES,
    formatNumberList,
    LIMIT_THRESHOLD_OPTIONS,
    parseNumberList,
    pickOption,
    SUMMARY_FREQUENCIES,
    TIME_TEST_LEAD_OPTIONS,
  } = await import('@/lib/notification-rules');
  /** Zaškrtnuté volby → text pro DB; mimo nabídku se cokoli zahodí. */
  const checked = (name: string, allowed: readonly number[]): string =>
    formatNumberList(
      parseNumberList(formData.getAll(name).map(String).join(','), allowed, []),
    );
  const values = {
    emailEnabled: formData.get('emaily-zapnute') === 'on',
    timeTestEvents: formData.get('upozorneni-casove-testy') === 'on',
    limitEvents: formData.get('upozorneni-limity') === 'on',
    calendarEmails: formData.get('upozorneni-kalendar') === 'on',
    // hodnoty ze selectů a zaškrtávátek validujeme na whitelist — cokoli jiného
    // spadne na bezpečný default (formulář jde odeslat i mimo naše UI)
    emailFrequency: formData.get('frekvence-emailu') === 'WEEKLY' ? 'WEEKLY' : 'DAILY',
    timeTestLeadDays: checked('lhuta-casoveho-testu', TIME_TEST_LEAD_OPTIONS),
    timeTestDone: formData.get('osvobozeno-hotovo') === 'on',
    limitThresholdsPct: checked('hranice-limitu', LIMIT_THRESHOLD_OPTIONS),
    deadlineLeadDays: pickOption(
      Number(formData.get('lhuta-terminu')),
      DEADLINE_LEAD_OPTIONS,
      DEFAULT_NOTIFICATION_RULES.deadlineLeadDays,
    ),
    summaryFrequency: pickOption(
      formData.get('pravidelny-prehled'),
      SUMMARY_FREQUENCIES,
      DEFAULT_NOTIFICATION_RULES.summaryFrequency,
    ),
    urgentImmediately: formData.get('nalehave-hned') === 'on',
    updatedAt: new Date(),
  };
  await db
    .insert(notificationPrefs)
    .values({ userId: user.id, ...values })
    .onConflictDoUpdate({ target: notificationPrefs.userId, set: values });
  revalidatePath('/nastaveni/upozorneni');
  redirect('/nastaveni/upozorneni?ok=notifikace');
}
