import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { getAuth as GetAuth } from '@/lib/auth';
import { emailsIn, postAuth, signUpVerified, type LoggedEmail } from './auth-helpers';

/**
 * L8a-01: předregistrace cizí adresy.
 *
 * Kdo si na cizí adresu založil účet jako první, znal jeho heslo i poté, co
 * adresu potvrdil skutečný majitel: druhá registrace téže adresy vracela 200,
 * ale heslo neměnila a e-mail neposílala, a ověření adresy heslo z nepotvrzené
 * registrace nezahazovalo. Majitel pak pracoval v účtu (po kliknutí na odkaz je
 * rovnou přihlášený) a první registrující se mohl kdykoli přihlásit svým heslem.
 *
 * Oprava (`lib/auth-signup.ts`): přijde-li na NEPOTVRZENÝ účet registrace
 * s jiným heslem, uložené heslo přestane platit — neplatí pak heslo z žádného
 * pokusu, a kdo adresu potvrdí, nastaví si heslo přes „Zapomenuté heslo“.
 * Schválně se heslo NEPŘEPISUJE tím novým: vyhrával by poslední zapisující
 * a útočníkovi by stačilo zaregistrovat se jako druhý.
 *
 * Všechno jde přes `auth.handler` (HTTP router), protože háček čte heslo z těla
 * požadavku a serverové `auth.api.signUpEmail` žádný požadavek nemá.
 *
 * Známé vlastnosti, ne vady: kdo zná adresu nepotvrzeného účtu, umí jeho heslo
 * zneplatnit a vyvolat další ověřovací e-mail (strop registrace je 5 za minutu
 * na IP). Totéž platí pro účet, který čeká na potvrzení po změně e-mailu.
 */
type Auth = Awaited<ReturnType<typeof GetAuth>>;

const FIRST_PASSWORD = 'heslo-prvniho-pokusu-01';
const SECOND_PASSWORD = 'heslo-druheho-pokusu-02';
const CALLBACK_URL = '/overeni-emailu/hotovo';

/** Čerstvý testovací výstup e-mailů; uklízí ho `afterEach`. */
function startEmailLog(): string {
  const logPath = join(mkdtempSync(join(tmpdir(), 'danero-test-')), 'emails.log');
  process.env.DANERO_EMAIL_LOG = logPath;
  return logPath;
}

const emailsTo = (logPath: string, address: string): LoggedEmail[] =>
  emailsIn(logPath).filter((message) => message.to === address);

const signUp = (auth: Auth, email: string, password: string, name: string): Promise<Response> =>
  postAuth(auth, '/sign-up/email', { email, password, name, callbackURL: CALLBACK_URL });

const signInStatus = async (auth: Auth, email: string, password: string): Promise<number> =>
  (await postAuth(auth, '/sign-in/email', { email, password })).status;

/** Klikne na ověřovací odkaz z posledního e-mailu na danou adresu. */
async function confirmAddress(auth: Auth, logPath: string, address: string): Promise<void> {
  const link = emailsTo(logPath, address)
    .at(-1)
    ?.text.match(/https?:\/\/\S*verify-email\S*/)?.[0];
  if (!link) throw new Error(`Na ${address} nepřišel ověřovací odkaz`);
  const token = new URL(link).searchParams.get('token');
  await auth.api.verifyEmail({ query: { token: token! } });
}

async function accountState(email: string) {
  const { getDb } = await import('@/db');
  const { account, auditLog, user } = await import('@/db/schema');
  const db = await getDb();
  const users = await db.select().from(user).where(eq(user.email, email));
  const [row] = users;
  if (!row) throw new Error(`Účet ${email} neexistuje`);
  const [credential] = await db
    .select({ hash: account.password })
    .from(account)
    .where(and(eq(account.userId, row.id), eq(account.providerId, 'credential')));
  const audit = await db.select().from(auditLog).where(eq(auditLog.userId, row.id));
  return {
    userCount: users.length,
    id: row.id,
    name: row.name,
    emailVerified: row.emailVerified,
    hash: credential?.hash ?? null,
    passwordAudits: audit.filter((entry) => entry.type === 'PASSWORD_CHANGE'),
  };
}

describe('druhá registrace téže adresy (L8a-01)', () => {
  let auth: Auth;

  beforeAll(async () => {
    process.env.PGLITE_DATA_DIR = ':memory:';
    const { getAuth } = await import('@/lib/auth');
    auth = await getAuth();
  }, 30_000);

  afterEach(() => {
    delete process.env.DANERO_EMAIL_LOG;
  });

  it(
    'heslo z cizí předregistrace po potvrzení adresy majitelem neplatí',
    { timeout: 30_000 },
    async () => {
      const email = 'predregistrace@priklad.test';
      const log = startEmailLog();

      // cizí člověk si založí účet na adresu budoucího uživatele a nepotvrdí ho
      expect((await signUp(auth, email, FIRST_PASSWORD, 'Cizí')).status).toBe(200);
      expect(emailsTo(log, email)).toHaveLength(1);
      const before = await accountState(email);

      // majitel adresy se později registruje sám, vlastním heslem
      const second = await signUp(auth, email, SECOND_PASSWORD, 'Majitel');
      expect(second.status).toBe(200);
      expect(((await second.json()) as { token: unknown }).token).toBeNull();

      // a klikne na odkaz, který má ve schránce (poslední, ať je z kterékoli registrace)
      await confirmAddress(auth, log, email);

      // jádro nálezu: první registrující se svým heslem do potvrzeného účtu nesmí
      expect(await signInStatus(auth, email, FIRST_PASSWORD)).toBe(401);
      // a nevyhrává ani poslední zapisující — heslo si majitel nastaví přes
      // „Zapomenuté heslo“, které chodí do jeho schránky
      expect(await signInStatus(auth, email, SECOND_PASSWORD)).toBe(401);

      // druhá registrace poslala vlastní odkaz, i když účet už existoval —
      // a vede tam, kam odkaz z první registrace
      const sent = emailsTo(log, email);
      expect(sent).toHaveLength(2);
      expect(sent[1]!.text).toContain('verify-email');
      expect(sent[1]!.text).toContain(encodeURIComponent(CALLBACK_URL));

      const after = await accountState(email);
      expect(after.userCount).toBe(1);
      expect(after.emailVerified).toBe(true);
      expect(after.hash).not.toBe(before.hash);
      // majitel o tom má stopu v historii účtu
      expect(after.passwordAudits).toHaveLength(1);
    },
  );

  it(
    'obrácené pořadí: cizí registrace až po majiteli mu heslo taky nenechá, ale své mu nevnutí',
    { timeout: 30_000 },
    async () => {
      const email = 'druhy-zapisujici@priklad.test';
      const log = startEmailLog();

      await signUp(auth, email, FIRST_PASSWORD, 'Majitel');
      await signUp(auth, email, SECOND_PASSWORD, 'Cizí');
      // třetí pokus už neporovnává s ničím, co kdo zná — a nesmí nic „vrátit“
      await signUp(auth, email, SECOND_PASSWORD, 'Cizí');
      expect(emailsTo(log, email)).toHaveLength(3);

      await confirmAddress(auth, log, email);
      expect(await signInStatus(auth, email, SECOND_PASSWORD)).toBe(401);
      expect(await signInStatus(auth, email, FIRST_PASSWORD)).toBe(401);
      // audit se píše jen při skutečném zneplatnění, ne při každém dalším pokusu
      expect((await accountState(email)).passwordAudits).toHaveLength(2);
    },
  );

  it(
    'opakovaná registrace stejným heslem heslo nezruší a pošle nový odkaz',
    { timeout: 30_000 },
    async () => {
      const email = 'stejne-heslo@priklad.test';
      const log = startEmailLog();

      await signUp(auth, email, FIRST_PASSWORD, 'Majitel');
      const before = await accountState(email);
      expect((await signUp(auth, email, FIRST_PASSWORD, 'Majitel')).status).toBe(200);

      const after = await accountState(email);
      expect(after.hash).toBe(before.hash);
      expect(after.passwordAudits).toHaveLength(0);
      expect(emailsTo(log, email)).toHaveLength(2);

      await confirmAddress(auth, log, email);
      expect(await signInStatus(auth, email, FIRST_PASSWORD)).toBe(200);
    },
  );

  it(
    'registrace na potvrzený účet nic nezmění, nic neodešle a odpovídá stejně jako nová',
    { timeout: 30_000 },
    async () => {
      const email = 'potvrzeny@priklad.test';
      await signUpVerified(auth, { email, password: FIRST_PASSWORD, name: 'Majitel' });
      const before = await accountState(email);
      const log = startEmailLog();

      const duplicate = await signUp(auth, email, SECOND_PASSWORD, 'Cizí');
      const fresh = await signUp(auth, 'novy-ucet@priklad.test', SECOND_PASSWORD, 'Cizí');

      // tvar odpovědi nesmí prozradit, že adresa už účet má
      const duplicateBody = (await duplicate.json()) as { token: unknown; user: object };
      const freshBody = (await fresh.json()) as { token: unknown; user: object };
      expect(duplicate.status).toBe(fresh.status);
      expect(duplicateBody.token).toBeNull();
      expect(freshBody.token).toBeNull();
      expect(Object.keys(duplicateBody).sort()).toEqual(Object.keys(freshBody).sort());
      expect(Object.keys(duplicateBody.user).sort()).toEqual(Object.keys(freshBody.user).sort());

      const after = await accountState(email);
      expect(after.hash).toBe(before.hash);
      expect(after.name).toBe('Majitel');
      expect(after.emailVerified).toBe(true);
      expect(after.passwordAudits).toHaveLength(0);
      expect(emailsTo(log, email)).toHaveLength(0);
      expect(await signInStatus(auth, email, FIRST_PASSWORD)).toBe(200);
      expect(await signInStatus(auth, email, SECOND_PASSWORD)).toBe(401);
    },
  );

  it(
    'bez požadavku se heslo nedá porovnat, takže platí jako neshoda',
    { timeout: 30_000 },
    async () => {
      const email = 'bez-pozadavku@priklad.test';
      const log = startEmailLog();

      // serverové volání háčku žádný požadavek nepředá — ani stejné heslo
      // tedy není důkaz, že jde o téhož člověka
      await auth.api.signUpEmail({ body: { email, password: FIRST_PASSWORD, name: 'Majitel' } });
      const before = await accountState(email);
      await auth.api.signUpEmail({ body: { email, password: FIRST_PASSWORD, name: 'Majitel' } });

      const after = await accountState(email);
      expect(after.hash).not.toBe(before.hash);
      expect(after.passwordAudits).toHaveLength(1);
      expect(emailsTo(log, email)).toHaveLength(2);
    },
  );

  it(
    'účet čekající na potvrzení po změně e-mailu: heslo padne, relace zůstane a heslo vrátí obnova',
    { timeout: 30_000 },
    async () => {
      const oldEmail = 'puvodni-adresa@priklad.test';
      const newEmail = 'nova-adresa@priklad.test';
      await signUpVerified(auth, { email: oldEmail, password: FIRST_PASSWORD, name: 'Majitel' });
      const signIn = await postAuth(auth, '/sign-in/email', {
        email: oldEmail,
        password: FIRST_PASSWORD,
      });
      const cookie = signIn.headers
        .getSetCookie()
        .map((entry) => entry.split(';')[0])
        .join('; ');
      expect(cookie).toContain('session_token');

      // stav, který po sobě nechává `changeEmailAction`: nová adresa, nepotvrzená
      const { getDb } = await import('@/db');
      const { user } = await import('@/db/schema');
      const db = await getDb();
      await db
        .update(user)
        .set({ email: newEmail, emailVerified: false })
        .where(eq(user.email, oldEmail));
      const before = await accountState(newEmail);
      const log = startEmailLog();

      // někdo cizí zkusí novou adresu zaregistrovat
      expect((await signUp(auth, newEmail, SECOND_PASSWORD, 'Cizí')).status).toBe(200);

      const after = await accountState(newEmail);
      expect(after.hash).not.toBe(before.hash);
      expect(after.passwordAudits).toHaveLength(1);
      expect(emailsTo(log, newEmail)).toHaveLength(1);

      // přihlášený majitel o relaci nepřijde
      const session = await auth.api.getSession({ headers: new Headers({ cookie }) });
      expect(session?.user.id).toBe(after.id);

      // a heslo si vrátí odkazem, který chodí jen do jeho schránky
      await confirmAddress(auth, log, newEmail);
      await auth.api.requestPasswordReset({ body: { email: newEmail } });
      const resetToken = emailsTo(log, newEmail)
        .at(-1)
        ?.text.match(/\/reset-password\/([^?\s]+)/)?.[1];
      await auth.api.resetPassword({
        body: { newPassword: 'heslo-po-obnove-2026', token: resetToken! },
      });
      expect(await signInStatus(auth, newEmail, 'heslo-po-obnove-2026')).toBe(200);
      expect(await signInStatus(auth, newEmail, SECOND_PASSWORD)).toBe(401);
      expect(await signInStatus(auth, newEmail, FIRST_PASSWORD)).toBe(401);
    },
  );
});
