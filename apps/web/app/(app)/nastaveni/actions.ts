'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/db';
import { accountFailure, type AccountFailure } from '@/lib/account-errors';
import { logAudit } from '@/lib/audit';
import { errorText, logEvent } from '@/lib/log';
import { afterProfileSaveUrl, hasAnyTransaction } from '@/lib/onboarding';
import { isCommonPassword } from '@/lib/password-strength';
import { unpinTaxYear } from '@/lib/portfolio';
import type { AutoSaveOutcome } from '@/lib/save-queue';
import { authApi, requireUser } from '@/lib/session';
import {
  notificationPrefsOutcome,
  profileOutcome,
  saveNotificationPrefs,
  saveProfile,
} from './save';

/**
 * První uložení daňového profilu tlačítkem. Auto-save už existujícího profilu
 * jde přes `autoSaveProfileAction` — nikam nepřesměrovává, takže nemění
 * adresu ani historii prohlížeče.
 */
export async function saveProfileAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const result = await saveProfile(user.id, formData);
  if (!result.ok) redirect(`/nastaveni?chyba=${result.error}`);
  revalidatePath('/prehled');
  revalidatePath('/nastaveni');
  revalidatePath('/import');
  // první uložení = cesta nového uživatele pokračuje krokem 2 (přidat data),
  // případně přehledem, když už data má. Profil, který mezitím vznikl jinde
  // (formulář prvního uložení otevřený ve dvou panelech), zůstává v Nastavení.
  redirect(
    afterProfileSaveUrl({
      firstSave: result.firstSave,
      // na data se ptáme jen při prvním uložení
      hasData: result.firstSave && (await hasAnyTransaction(await getDb(), user.id)),
    }),
  );
}

/**
 * Auto-save daňového profilu: uloží a vrátí výsledek, který formulář ukáže
 * sám (`AutoSubmit`). Bez přesměrování — potvrzení v adrese přidávalo každou
 * změnou krok do historie prohlížeče a Zpět z Nastavení chtělo tolik stisků,
 * kolik bylo změn (změřeno 11. 10. 2026).
 */
export async function autoSaveProfileAction(formData: FormData): Promise<AutoSaveOutcome> {
  const user = await requireUser();
  return profileOutcome(await saveProfile(user.id, formData));
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

/** Kód hlášky (`settings-toast.tsx`) podle toho, proč operace s účtem selhala. */
const PASSWORD_ERROR_CODES: Record<AccountFailure, string> = {
  password: 'heslo-spatne',
  limit: 'heslo-limit',
  other: 'heslo-selhalo',
};
const DELETE_ERROR_CODES: Record<AccountFailure, string> = {
  password: 'smazani-heslo',
  limit: 'smazani-limit',
  other: 'smazani-selhalo',
};

const ChangePasswordSchema = z.object({
  'stavajici-heslo': z.string().min(1),
  'nove-heslo': z.string().min(10),
});

export async function changePasswordAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const parsed = ChangePasswordSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) redirect('/nastaveni/ucet?chyba=heslo');
  // R21: totéž odmítne i server (háček v lib/auth-hooks.ts); tady kvůli vlastní
  // hlášce — z chyby `changePassword` níž se „heslo nesedí“ od tohohle nepozná
  if (isCommonPassword(parsed.data['nove-heslo'])) redirect('/nastaveni/ucet?chyba=heslo-bezne');
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
    // „heslo nesedí“ jen tehdy, když to Better Auth opravdu řekl — limit
    // pokusů ani výpadek se za špatné heslo vydávat nesmí
    redirect(`/nastaveni/ucet?chyba=${PASSWORD_ERROR_CODES[accountFailure(error)]}`);
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
  // L6b-05: oznámení o změně má dvě znění podle toho, jestli původní adresu kdy
  // někdo potvrdil — nepotvrzená může být překlep, tedy cizí schránka, a té
  // se „vrácení účtu“ nenabízí (lib/email.ts, `emailChangedEmail`).
  let previousEmailVerified = false;
  try {
    const db = await getDb();
    const { user: userTable } = await import('@/db/schema');
    const [current] = await db
      .select({ emailVerified: userTable.emailVerified })
      .from(userTable)
      .where(eq(userTable.id, user.id));
    previousEmailVerified = current?.emailVerified ?? false;
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
  // L21-01: odkazy na obnovu hesla vydané na starou adresu padají se změnou
  // e-mailu, stejně jako po změně hesla (D-02 v lib/auth-hooks.ts). E-mail se
  // mění i proto, že starou schránku už uživatel neovládá — a kdo ji má, by
  // jinak ještě hodinu od vydání odkazu přepsal heslo a vlastníka odhlásil.
  // Až po úspěšném UPDATE: špatné heslo ani obsazená adresa nesmí nikomu
  // zavřít záchrannou cestu. A mimo `try` výš, protože selhání tady není
  // „e-mail se nepodařilo změnit“ — ten už změněný je.
  const { revokePasswordResetTokens } = await import('@/lib/auth-hooks');
  await revokePasswordResetTokens(await getDb(), user.id);
  await logAudit(await getDb(), user.id, 'EMAIL_CHANGE');
  // L6b-05 (R19): původní adresa se o změně dozví. Bez toho majitel účtu, jehož
  // heslo zná někdo další, potichu přijde o přihlášení i o obnovu hesla.
  // Selhání odeslání nesmí shodit už provedenou změnu.
  const newEmail = parsed.data['novy-email'].toLowerCase();
  if (user.email.toLowerCase() !== newEmail) {
    try {
      const { emailChangedEmail, resolveEmailSender } = await import('@/lib/email');
      await resolveEmailSender()({
        to: user.email,
        ...emailChangedEmail(newEmail, { previousVerified: previousEmailVerified }),
      });
    } catch (error) {
      logEvent('error', 'account.change_email_notice_failed', {
        userId: user.id,
        error: errorText(error),
      });
    }
  }
  // ověřovací odkaz na novou adresu; selhání odeslání nesmí shodit už provedenou
  // změnu — uživatel si odkaz vyžádá znovu na /overeni-emailu
  try {
    const { authApi } = await import('@/lib/session');
    const { api } = await authApi();
    await api.sendVerificationEmail({
      body: { email: parsed.data['novy-email'].toLowerCase(), callbackURL: '/overeni-emailu/hotovo' },
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
    redirect(`/nastaveni/ucet?chyba=${DELETE_ERROR_CODES[accountFailure(error)]}`);
  }

  // K4-07 / K4-08: co po smazání zůstává mimo cizí klíče (odkaz na obnovu
  // hesla ve `verification`, adresa v `waitlist`) — proč právě tyhle dvě
  // tabulky, vysvětluje `lib/account-cleanup.ts`. Až tady: heslo ověřuje
  // teprve `deleteUser` a špatné heslo nesmí nikomu nic mazat.
  const { purgeAfterAccountDeletion } = await import('@/lib/account-cleanup');
  await purgeAfterAccountDeletion(await getDb(), { userId: user.id, email: user.email });

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

/** Auto-save nastavení upozornění — stejně jako u profilu bez přesměrování. */
export async function autoSaveNotificationPrefsAction(
  formData: FormData,
): Promise<AutoSaveOutcome> {
  const user = await requireUser();
  await saveNotificationPrefs(user.id, formData);
  return notificationPrefsOutcome();
}
