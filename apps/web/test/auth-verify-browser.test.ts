import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { getAuth as GetAuth } from '@/lib/auth';
import { emailsIn, postAuth } from './auth-helpers';

/**
 * L8a-01, zbytek (rozhodnutí R1): kliknutí na ověřovací odkaz přihlásí jen
 * prohlížeč, který o odkaz sám požádal.
 *
 * Kdo si na cizí adresu založil účet a nepotvrdil ho, znal jeho heslo. Majitel
 * adresy, který se sám neregistroval a jen klikl na nevyžádaný e-mail „Potvrď
 * svůj e-mail“, byl po kliknutí rovnou přihlášený — do účtu s cizím heslem —
 * a nic ho nevarovalo. Teď po kliknutí přihlášený není: stránka mu řekne, ať
 * se přihlásí, heslo nezná, a „Zapomenuté heslo“ cizí heslo i relace zruší.
 *
 * Kdo se registroval sám (nebo se k nepotvrzenému účtu přihlásil heslem) a kliká ve stejném
 * prohlížeči, nepozná rozdíl: prohlížeč si z registrace nese podepsanou cookie
 * s otiskem adresy a potvrzení ho přihlásí jako dřív.
 */
type Auth = Awaited<ReturnType<typeof GetAuth>>;

const PASSWORD = 'heslo-pro-test-prohlizece-01';
const CALLBACK_URL = '/overeni-emailu/hotovo';

function startEmailLog(): string {
  const logPath = join(mkdtempSync(join(tmpdir(), 'danero-test-')), 'emails.log');
  process.env.DANERO_EMAIL_LOG = logPath;
  return logPath;
}

/** Hodnota hlavičky `cookie`, jakou by prohlížeč poslal po téhle odpovědi. */
const cookieFrom = (response: Response): string =>
  response.headers
    .getSetCookie()
    .map((entry) => entry.split(';')[0])
    .join('; ');

const signUp = (auth: Auth, email: string): Promise<Response> =>
  postAuth(auth, '/sign-up/email', { email, password: PASSWORD, name: 'Test', callbackURL: CALLBACK_URL });

/** Klikne na poslední ověřovací odkaz z e-mailu — přes HTTP router, s cookie prohlížeče. */
async function clickLink(auth: Auth, logPath: string, address: string, cookie = ''): Promise<Response> {
  const link = emailsIn(logPath)
    .filter((message) => message.to === address)
    .map((message) => message.text.match(/https?:\/\/\S*verify-email\S*/)?.[0])
    .filter((found): found is string => Boolean(found))
    .at(-1);
  if (!link) throw new Error(`Na ${address} nepřišel ověřovací odkaz`);
  return auth.handler(new Request(link, { headers: cookie ? { cookie } : {} }));
}

async function accountState(email: string) {
  const { getDb } = await import('@/db');
  const { session, user } = await import('@/db/schema');
  const db = await getDb();
  const [row] = await db.select().from(user).where(eq(user.email, email));
  if (!row) throw new Error(`Účet ${email} neexistuje`);
  const sessions = await db.select().from(session).where(eq(session.userId, row.id));
  return { emailVerified: row.emailVerified, sessionCount: sessions.length };
}

const setsSessionCookie = (response: Response): boolean =>
  response.headers.getSetCookie().some((entry) => /session_token=[^;]+/.test(entry));

describe('potvrzení adresy přihlásí jen prohlížeč, který o odkaz požádal (L8a-01, R1)', () => {
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
    'cizí předregistrace: majitel adresy po kliknutí na nevyžádaný odkaz přihlášený není',
    { timeout: 30_000 },
    async () => {
      const email = 'nevyzadany-odkaz@priklad.test';
      const log = startEmailLog();
      // cizí člověk založí účet na adresu budoucího uživatele ve SVÉM prohlížeči
      expect((await signUp(auth, email)).status).toBe(200);

      // majitel adresy klikne na e-mail v prohlížeči, který o nic nežádal
      const response = await clickLink(auth, log, email);

      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toBe(CALLBACK_URL);
      expect(setsSessionCookie(response)).toBe(false);
      const state = await accountState(email);
      // adresa potvrzená je — stránka `hotovo` ho pošle na přihlášení
      expect(state.emailVerified).toBe(true);
      expect(state.sessionCount).toBe(0);
    },
  );

  it(
    'vlastní registrace: kliknutí ve stejném prohlížeči přihlásí jako dřív',
    { timeout: 30_000 },
    async () => {
      const email = 'vlastni-registrace@priklad.test';
      const log = startEmailLog();
      const registration = await signUp(auth, email);
      const browser = cookieFrom(registration);
      expect(browser).not.toBe('');
      // cookie nenese adresu v čitelné podobě
      expect(decodeURIComponent(browser)).not.toContain(email);

      const response = await clickLink(auth, log, email, browser);

      expect(response.status).toBe(302);
      expect(setsSessionCookie(response)).toBe(true);
      expect((await accountState(email)).sessionCount).toBe(1);
    },
  );

  it(
    'cookie z registrace jiné adresy cizí účet neotevře',
    { timeout: 30_000 },
    async () => {
      const log = startEmailLog();
      const victim = 'obet-jine-adresy@priklad.test';
      expect((await signUp(auth, victim)).status).toBe(200);
      // prohlížeč, který se registroval na jinou adresu
      const other = cookieFrom(await signUp(auth, 'jina-adresa@priklad.test'));

      const response = await clickLink(auth, log, victim, other);

      expect(setsSessionCookie(response)).toBe(false);
      expect((await accountState(victim)).sessionCount).toBe(0);
    },
  );

  it(
    'odkaz vyžádaný znovu BEZ hesla nepřihlásí — formulář „poslat znovu“ nic nedokládá',
    { timeout: 30_000 },
    async () => {
      const email = 'znovu-bez-hesla@priklad.test';
      const log = startEmailLog();
      // cizí člověk založí účet na adresu budoucího uživatele
      expect((await signUp(auth, email)).status).toBe(200);
      // majiteli vypršel odkaz, na stránce „Odkaz už neplatí“ si nechá poslat nový
      const resend = await postAuth(auth, '/send-verification-email', {
        email,
        callbackURL: CALLBACK_URL,
      });
      expect(resend.status).toBe(200);
      expect(cookieFrom(resend)).toBe('');

      const response = await clickLink(auth, log, email, cookieFrom(resend));

      // jinak by byl přihlášený do účtu, jehož heslo zná ten, kdo ho založil
      expect(setsSessionCookie(response)).toBe(false);
      expect((await accountState(email)).sessionCount).toBe(0);
    },
  );

  it(
    'kdo se k nepotvrzenému účtu přihlásí správným heslem, toho nový odkaz přihlásí',
    { timeout: 30_000 },
    async () => {
      const email = 'jiny-prohlizec-heslem@priklad.test';
      const log = startEmailLog();
      expect((await signUp(auth, email)).status).toBe(200);
      // jiný prohlížeč (telefon): přihlášení skončí na nepotvrzené adrese,
      // ale heslo bylo správné — tím prohlížeč doložil, že je registrujícího
      const signIn = await postAuth(auth, '/sign-in/email', { email, password: PASSWORD });
      expect(signIn.status).toBe(403);
      const phone = cookieFrom(signIn);
      expect(phone).not.toBe('');
      // formulář si po takovém přihlášení nechá poslat nový odkaz sám
      const resend = await auth.handler(
        new Request('http://localhost:3000/api/auth/send-verification-email', {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie: phone },
          body: JSON.stringify({ email, callbackURL: CALLBACK_URL }),
        }),
      );
      expect(resend.status).toBe(200);

      const response = await clickLink(auth, log, email, phone);

      expect(setsSessionCookie(response)).toBe(true);
    },
  );

  it(
    'špatné heslo k nepotvrzenému účtu cookie nevydá',
    { timeout: 30_000 },
    async () => {
      const email = 'spatne-heslo-nepotvrzeny@priklad.test';
      startEmailLog();
      expect((await signUp(auth, email)).status).toBe(200);
      const signIn = await postAuth(auth, '/sign-in/email', {
        email,
        password: 'uplne-jine-heslo-nez-pri-registraci',
      });
      expect(signIn.status).toBe(401);
      expect(cookieFrom(signIn)).toBe('');
    },
  );

  it(
    'účet s druhým faktorem potvrzení nepřihlásí ani ve vlastním prohlížeči',
    { timeout: 30_000 },
    async () => {
      const email = 'druhy-faktor@priklad.test';
      const log = startEmailLog();
      const browser = cookieFrom(await signUp(auth, email));
      // stav po změně e-mailu na účtu se zapnutým 2FA: adresa čeká na potvrzení
      const { getDb } = await import('@/db');
      const { user } = await import('@/db/schema');
      await (await getDb()).update(user).set({ twoFactorEnabled: true }).where(eq(user.email, email));

      const response = await clickLink(auth, log, email, browser);

      expect(setsSessionCookie(response)).toBe(false);
      const state = await accountState(email);
      expect(state.emailVerified).toBe(true);
      expect(state.sessionCount).toBe(0);
    },
  );

  it(
    'podvržená (nepodepsaná) cookie nepřihlásí',
    { timeout: 30_000 },
    async () => {
      const email = 'podvrzena-cookie@priklad.test';
      const log = startEmailLog();
      const browser = cookieFrom(await signUp(auth, email));
      const [name, value] = browser.split('=') as [string, string];
      // tatáž hodnota bez podpisu (část za tečkou je HMAC)
      const forged = `${name}=${decodeURIComponent(value).split('.')[0]}`;

      const response = await clickLink(auth, log, email, forged);

      expect(setsSessionCookie(response)).toBe(false);
    },
  );
});
