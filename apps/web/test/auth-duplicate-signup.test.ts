import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { and, eq, like } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
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
 * s jiným heslem, adresa se označí za spornou. Dokud ji nikdo nepotvrdí,
 * nemění se nic. Kdo ji potvrdí, dostane účet bez hesla (nastaví si ho přes
 * „Zapomenuté heslo“) a bez relací, které v něm byly otevřené.
 * Schválně se heslo NEPŘEPISUJE tím novým: vyhrával by poslední zapisující
 * a útočníkovi by stačilo zaregistrovat se jako druhý.
 *
 * D01-R1-01 až R1-03 (recenze opravy): nepotvrzený je i ZAVEDENÝ účet po změně
 * e-mailu — má data, heslo, které jeho držitel zná, a živou relaci. Proto se
 * rozhoduje až při potvrzení (do té doby držitel o nic nepřijde a překlep
 * v adrese si opraví) a proto potvrzení ruší i relace (jinak by v účtu zůstal
 * ten, kdo si adresu „zabral“ změnou e-mailu).
 *
 * Registrace jde přes `auth.handler` (HTTP router), protože háček čte heslo
 * z těla požadavku a serverové `auth.api.signUpEmail` žádný požadavek nemá.
 * Server actions z Nastavení běží skutečné; podvržené je jen to, co dodává
 * Next (hlavičky požadavku, redirect, cache).
 *
 * Známá vlastnost, ne vada: kdo zná adresu nepotvrzeného účtu, umí způsobit,
 * že po jejím potvrzení přestane platit heslo a skončí otevřené relace, a umí
 * vyvolat další ověřovací e-mail (strop registrace je 5 za minutu na IP).
 */
const requestState = vi.hoisted(() => ({ cookie: '' }));

vi.mock('next/headers', () => ({
  headers: async () => new Headers(requestState.cookie ? { cookie: requestState.cookie } : {}),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

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

/** Přihlásí se a vrátí hodnotu hlavičky `cookie`, jakou by poslal prohlížeč. */
async function signInCookie(auth: Auth, email: string, password: string): Promise<string> {
  const response = await postAuth(auth, '/sign-in/email', { email, password });
  expect(response.status).toBe(200);
  return response.headers
    .getSetCookie()
    .map((entry) => entry.split(';')[0])
    .join('; ');
}

/** Hodnota hlavičky `cookie`, jakou by prohlížeč poslal po téhle odpovědi. */
const browserCookie = (response: Response): string =>
  response.headers
    .getSetCookie()
    .map((entry) => entry.split(';')[0])
    .join('; ');

/**
 * Klikne na poslední ověřovací odkaz, který na danou adresu přišel. S `cookie`
 * kliká prohlížeč, který o odkaz sám požádal — jen toho potvrzení přihlásí
 * (R1, test/auth-verify-browser.test.ts); bez ní kdokoli jiný.
 */
async function confirmAddress(
  auth: Auth,
  logPath: string,
  address: string,
  cookie = '',
): Promise<void> {
  const link = emailsTo(logPath, address)
    .map((message) => message.text.match(/https?:\/\/\S*verify-email\S*/)?.[0])
    .filter((found): found is string => Boolean(found))
    .at(-1);
  if (!link) throw new Error(`Na ${address} nepřišel ověřovací odkaz`);
  const response = await auth.handler(new Request(link, { headers: cookie ? { cookie } : {} }));
  expect(response.status).toBe(302);
}

/** Kam server action přesměrovala (každá z Nastavení končí redirectem). */
async function redirectTarget(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith('REDIRECT:')) return message.slice('REDIRECT:'.length);
    throw error;
  }
  throw new Error('volání neskončilo redirectem');
}

const form = (values: Record<string, string>): FormData => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.append(key, value);
  return data;
};

/** Změna e-mailu skutečnou server action, s cookie přihlášeného držitele. */
async function changeEmail(cookie: string, newEmail: string, password: string): Promise<string> {
  const { changeEmailAction } = await import('@/app/(app)/nastaveni/actions');
  requestState.cookie = cookie;
  try {
    return await redirectTarget(() =>
      changeEmailAction(form({ 'novy-email': newEmail, 'stavajici-heslo': password })),
    );
  } finally {
    requestState.cookie = '';
  }
}

async function accountState(email: string) {
  const { getDb } = await import('@/db');
  const { account, auditLog, session, user } = await import('@/db/schema');
  const db = await getDb();
  const users = await db.select().from(user).where(eq(user.email, email));
  const [row] = users;
  if (!row) throw new Error(`Účet ${email} neexistuje`);
  const [credential] = await db
    .select({ hash: account.password })
    .from(account)
    .where(and(eq(account.userId, row.id), eq(account.providerId, 'credential')));
  const audit = await db.select().from(auditLog).where(eq(auditLog.userId, row.id));
  const sessions = await db.select().from(session).where(eq(session.userId, row.id));
  return {
    userCount: users.length,
    id: row.id,
    name: row.name,
    emailVerified: row.emailVerified,
    hash: credential?.hash ?? null,
    sessionCount: sessions.length,
    passwordAudits: audit.filter((entry) => entry.type === 'PASSWORD_CHANGE'),
  };
}

/** Záznamy o sporných adresách (v tabulce `verification`), všechny naráz. */
async function contestRows() {
  const { getDb } = await import('@/db');
  const { verification } = await import('@/db/schema');
  const db = await getDb();
  return db.select().from(verification).where(like(verification.identifier, 'signup-contest:%'));
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
    requestState.cookie = '';
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

      // samotná registrace nic neruší — rozhoduje se až při potvrzení adresy
      const contested = await accountState(email);
      expect(contested.hash).toBe(before.hash);
      expect(contested.passwordAudits).toHaveLength(0);

      // a klikne na odkaz, který má ve schránce (poslední, ať je z kterékoli registrace)
      await confirmAddress(auth, log, email, browserCookie(second));

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
      // jediná relace je ta, kterou potvrzení otevřelo tomu, kdo klikl
      expect(after.sessionCount).toBe(1);
    },
  );

  it(
    'obrácené pořadí: cizí registrace až po majiteli mu heslo taky nenechá, ale své mu nevnutí',
    { timeout: 30_000 },
    async () => {
      const email = 'druhy-zapisujici@priklad.test';
      const log = startEmailLog();
      const contestsBefore = (await contestRows()).length;

      await signUp(auth, email, FIRST_PASSWORD, 'Majitel');
      await signUp(auth, email, SECOND_PASSWORD, 'Cizí');
      // třetí pokus nesmí nic „vrátit“ ani přidat
      await signUp(auth, email, SECOND_PASSWORD, 'Cizí');
      expect(emailsTo(log, email)).toHaveLength(3);
      // adresa je sporná jednou, ať na ni přišlo pokusů kolik chtělo
      expect((await contestRows()).length).toBe(contestsBefore + 1);

      await confirmAddress(auth, log, email);
      expect(await signInStatus(auth, email, SECOND_PASSWORD)).toBe(401);
      expect(await signInStatus(auth, email, FIRST_PASSWORD)).toBe(401);
      // audit se píše jednou — při zrušení hesla, ne při každém pokusu (D01-R1-03)
      expect((await accountState(email)).passwordAudits).toHaveLength(1);
      // potvrzením je spor vyřízený
      expect((await contestRows()).length).toBe(contestsBefore);
    },
  );

  it(
    'opakovaná registrace stejným heslem heslo nezruší a pošle nový odkaz',
    { timeout: 30_000 },
    async () => {
      const email = 'stejne-heslo@priklad.test';
      const log = startEmailLog();
      const contestsBefore = (await contestRows()).length;

      await signUp(auth, email, FIRST_PASSWORD, 'Majitel');
      const before = await accountState(email);
      expect((await signUp(auth, email, FIRST_PASSWORD, 'Majitel')).status).toBe(200);

      const after = await accountState(email);
      expect(after.hash).toBe(before.hash);
      expect(after.passwordAudits).toHaveLength(0);
      expect(emailsTo(log, email)).toHaveLength(2);
      expect((await contestRows()).length).toBe(contestsBefore);

      await confirmAddress(auth, log, email);
      expect(await signInStatus(auth, email, FIRST_PASSWORD)).toBe(200);
      expect((await accountState(email)).passwordAudits).toHaveLength(0);
    },
  );

  it(
    'registrace stejným heslem spor nesmaže — první registrující si heslo „nepotvrdí“ zpátky',
    { timeout: 30_000 },
    async () => {
      const email = 'spor-zustava@priklad.test';
      const log = startEmailLog();

      await signUp(auth, email, FIRST_PASSWORD, 'Cizí');
      await signUp(auth, email, SECOND_PASSWORD, 'Majitel');
      // první registrující zkusí spor shodit tím, že se zaregistruje znovu svým heslem
      await signUp(auth, email, FIRST_PASSWORD, 'Cizí');

      await confirmAddress(auth, log, email);
      expect(await signInStatus(auth, email, FIRST_PASSWORD)).toBe(401);
    },
  );

  it('spor, který vypršel, už heslo neruší', { timeout: 30_000 }, async () => {
    const email = 'vyprsely-spor@priklad.test';
    const log = startEmailLog();

    await signUp(auth, email, FIRST_PASSWORD, 'Majitel');
    await signUp(auth, email, SECOND_PASSWORD, 'Cizí');

    // jediný řádek, který přibyl, je spor o tuhle adresu — posuň mu konec do minulosti
    const { getDb } = await import('@/db');
    const { verification } = await import('@/db/schema');
    const db = await getDb();
    const rows = await contestRows();
    const newest = rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]!;
    expect(newest.expiresAt.getTime()).toBeGreaterThan(Date.now() + 24 * 60 * 60 * 1000);
    // v řádku není adresa ani nic, z čeho by šla přečíst
    expect(`${newest.identifier} ${newest.value}`).not.toContain('@');
    expect(`${newest.identifier} ${newest.value}`).not.toContain('vyprsely-spor');
    await db
      .update(verification)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(verification.id, newest.id));

    await confirmAddress(auth, log, email);
    expect(await signInStatus(auth, email, FIRST_PASSWORD)).toBe(200);
  });

  it(
    'registrace na potvrzený účet nic nezmění, nic neodešle a odpovídá stejně jako nová',
    { timeout: 30_000 },
    async () => {
      const email = 'potvrzeny@priklad.test';
      await signUpVerified(auth, { email, password: FIRST_PASSWORD, name: 'Majitel' });
      const before = await accountState(email);
      const contestsBefore = (await contestRows()).length;
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
      // potvrzená adresa se za spornou neoznačí — jinak by ji cizí člověk
      // „otrávil“ pro případ, že se na ni majitel někdy vrátí změnou e-mailu
      expect((await contestRows()).length).toBe(contestsBefore);
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
      await auth.api.signUpEmail({ body: { email, password: FIRST_PASSWORD, name: 'Majitel' } });
      expect(emailsTo(log, email)).toHaveLength(2);

      await confirmAddress(auth, log, email);
      expect(await signInStatus(auth, email, FIRST_PASSWORD)).toBe(401);
      expect((await accountState(email)).passwordAudits).toHaveLength(1);
    },
  );

  it(
    'D01-R2-01: heslo z dokončené obnovy potvrzení sporné adresy přežije, heslo z předregistrace ne',
    { timeout: 60_000 },
    async () => {
      const email = 'majitel-obnova@priklad.test';
      const resetPassword = 'heslo-z-obnovy-2026-03';
      const contestsBefore = (await contestRows()).length;
      const log = startEmailLog();

      // cizí předregistrace, pak registrace majitele vlastním heslem → adresa je sporná
      await signUp(auth, email, FIRST_PASSWORD, 'Cizí');
      await signUp(auth, email, SECOND_PASSWORD, 'Majitel');
      expect((await contestRows()).length).toBe(contestsBefore + 1);

      // majitel odkaz přehlédne a zkusí se přihlásit: v účtu je pořád heslo
      // z předregistrace, takže čte „špatné heslo“ a jde na „Zapomenuté heslo“
      expect(await signInStatus(auth, email, SECOND_PASSWORD)).toBe(401);
      await auth.api.requestPasswordReset({ body: { email } });
      const resetToken = emailsTo(log, email)
        .at(-1)
        ?.text.match(/\/reset-password\/([^?\s]+)/)?.[1];
      expect(resetToken).toBeTruthy();
      await auth.api.resetPassword({ body: { newPassword: resetPassword, token: resetToken! } });

      // obnova udělala totéž, co by udělalo potvrzení sporné adresy: heslo zná
      // jen ten, kdo otevřel odkaz ze schránky, a relace v účtu nejsou — spor
      // tedy nemá co hlídat
      const afterReset = await accountState(email);
      expect(afterReset.sessionCount).toBe(0);
      expect((await contestRows()).length).toBe(contestsBefore);
      expect(await signInStatus(auth, email, resetPassword)).toBe(403);

      await confirmAddress(auth, log, email);

      const after = await accountState(email);
      expect(after.emailVerified).toBe(true);
      expect(after.hash).toBe(afterReset.hash);
      expect(await signInStatus(auth, email, resetPassword)).toBe(200);
      // heslo z předregistrace neplatí — přepsala ho už obnova
      expect(await signInStatus(auth, email, FIRST_PASSWORD)).toBe(401);
      // v historii je jen obnova, žádné „zrušeno“
      expect(after.passwordAudits.map((entry) => entry.detail)).toEqual([
        'obnova přes odkaz v e-mailu',
      ]);
    },
  );

  it(
    'D01-R2-01: obnova hesla uzavře jen spor adresy vlastního účtu, cizí nechá být',
    { timeout: 60_000 },
    async () => {
      const contestedEmail = 'cizi-spor@priklad.test';
      const otherEmail = 'jiny-ucet-obnova@priklad.test';
      const log = startEmailLog();

      await signUp(auth, contestedEmail, FIRST_PASSWORD, 'Cizí');
      await signUp(auth, contestedEmail, SECOND_PASSWORD, 'Majitel');
      const contests = (await contestRows()).length;

      // obnova hesla na jiném účtu se sporu o tuhle adresu netýká
      await signUp(auth, otherEmail, FIRST_PASSWORD, 'Jiný');
      await auth.api.requestPasswordReset({ body: { email: otherEmail } });
      const resetToken = emailsTo(log, otherEmail)
        .at(-1)
        ?.text.match(/\/reset-password\/([^?\s]+)/)?.[1];
      await auth.api.resetPassword({
        body: { newPassword: 'heslo-jineho-uctu-2026-04', token: resetToken! },
      });
      expect((await contestRows()).length).toBe(contests);

      // potvrzení sporné adresy heslo z předregistrace dál ruší
      await confirmAddress(auth, log, contestedEmail);
      expect(await signInStatus(auth, contestedEmail, FIRST_PASSWORD)).toBe(401);
      expect(await signInStatus(auth, contestedEmail, SECOND_PASSWORD)).toBe(401);
    },
  );

  it(
    'D01-R2-03: další neshodná registrace lhůtu sporu obnoví',
    { timeout: 30_000 },
    async () => {
      const email = 'obnovena-lhuta@priklad.test';
      const known = new Set((await contestRows()).map((row) => row.identifier));
      startEmailLog();

      await signUp(auth, email, FIRST_PASSWORD, 'Majitel');
      await signUp(auth, email, SECOND_PASSWORD, 'Cizí');
      const [contest] = (await contestRows()).filter((row) => !known.has(row.identifier));
      expect(contest).toBeDefined();

      // spor těsně před vypršením…
      const { getDb } = await import('@/db');
      const { verification } = await import('@/db/schema');
      const db = await getDb();
      await db
        .update(verification)
        .set({ expiresAt: new Date(Date.now() + 60 * 1000) })
        .where(eq(verification.identifier, contest!.identifier));

      // …a další neshodná registrace: lhůta běží znovu od začátku
      await signUp(auth, email, 'uplne-jine-heslo-05', 'Cizí');
      const refreshed = (await contestRows()).filter(
        (row) => row.identifier === contest!.identifier,
      );
      expect(refreshed).toHaveLength(1);
      expect(refreshed[0]!.expiresAt.getTime()).toBeGreaterThan(
        Date.now() + 24 * 60 * 60 * 1000,
      );
    },
  );
});

describe('účet čekající na potvrzení po změně e-mailu (D01-R1-01 až R1-03)', () => {
  let auth: Auth;

  beforeAll(async () => {
    process.env.PGLITE_DATA_DIR = ':memory:';
    const { getAuth } = await import('@/lib/auth');
    auth = await getAuth();
  }, 30_000);

  afterEach(() => {
    delete process.env.DANERO_EMAIL_LOG;
    requestState.cookie = '';
  });

  it(
    'R1-01: kdo si cizí adresu zabral změnou e-mailu, přijde po potvrzení majitelem o heslo i o relaci',
    { timeout: 60_000 },
    async () => {
      const holderEmail = 'prvni-drzitel@priklad.test';
      const ownerEmail = 'majitel-schranky@priklad.test';
      const holderPassword = 'heslo-prvniho-drzitele-01';
      const ownerPassword = 'heslo-majitele-schranky-02';

      // cizí člověk má vlastní potvrzený účet, je v něm přihlášený a změní si
      // e-mail na adresu budoucího uživatele (stačí mu vlastní heslo)
      await signUpVerified(auth, { email: holderEmail, password: holderPassword, name: 'Cizí' });
      const holderCookie = await signInCookie(auth, holderEmail, holderPassword);
      const log = startEmailLog();
      expect(await changeEmail(holderCookie, ownerEmail, holderPassword)).toBe(
        '/nastaveni/ucet?ok=email',
      );

      // majitel adresy se později registruje sám, vlastním heslem
      const ownerSignUp = await signUp(auth, ownerEmail, ownerPassword, 'Majitel');
      expect(ownerSignUp.status).toBe(200);
      // do potvrzení se držiteli nic nestalo: relace žije
      expect(
        (await auth.api.getSession({ headers: new Headers({ cookie: holderCookie }) }))?.user.email,
      ).toBe(ownerEmail);

      await confirmAddress(auth, log, ownerEmail, browserCookie(ownerSignUp));

      // heslo držitele neplatí a heslo z registrace se nevnutilo
      expect(await signInStatus(auth, ownerEmail, holderPassword)).toBe(401);
      expect(await signInStatus(auth, ownerEmail, ownerPassword)).toBe(401);

      // jádro nálezu: relace prvního držitele potvrzení majitelem nepřežije
      expect(
        await auth.api.getSession({ headers: new Headers({ cookie: holderCookie }) }),
      ).toBeNull();
      // a neprojde ani strážcem aplikačních stránek (přehled, export, nastavení)
      const { requireUser } = await import('@/lib/session');
      requestState.cookie = holderCookie;
      expect(await redirectTarget(() => requireUser())).toBe('/prihlaseni');
      requestState.cookie = '';

      const state = await accountState(ownerEmail);
      expect(state.emailVerified).toBe(true);
      // zůstala jen relace, kterou potvrzení otevřelo tomu, kdo klikl
      expect(state.sessionCount).toBe(1);
      expect(state.passwordAudits).toHaveLength(1);

      // majitel si heslo nastaví odkazem, který chodí jen do jeho schránky
      await auth.api.requestPasswordReset({ body: { email: ownerEmail } });
      const resetToken = emailsTo(log, ownerEmail)
        .at(-1)
        ?.text.match(/\/reset-password\/([^?\s]+)/)?.[1];
      await auth.api.resetPassword({
        body: { newPassword: 'heslo-po-obnove-2026', token: resetToken! },
      });
      expect(await signInStatus(auth, ownerEmail, 'heslo-po-obnove-2026')).toBe(200);
      expect(await signInStatus(auth, ownerEmail, holderPassword)).toBe(401);
    },
  );

  it(
    'D01-R2-01 × R1-01: obnova hesla na účtu, který na spornou adresu přešel změnou e-mailu, spor neuzavře',
    { timeout: 60_000 },
    async () => {
      const ownEmail = 'zabral-obnova@priklad.test';
      const takenEmail = 'majitel-zabrane-obnova@priklad.test';
      const password = 'heslo-toho-kdo-zabral-01';
      const resetPassword = 'heslo-z-obnovy-2026-06';

      await signUpVerified(auth, { email: ownEmail, password, name: 'Cizí' });
      const cookie = await signInCookie(auth, ownEmail, password);
      const log = startEmailLog();
      expect(await changeEmail(cookie, takenEmail, password)).toBe('/nastaveni/ucet?ok=email');
      const contestsBefore = (await contestRows()).length;
      await signUp(auth, takenEmail, SECOND_PASSWORD, 'Majitel');
      expect((await contestRows()).length).toBe(contestsBefore + 1);

      // Obnova na účtu, který adresu kdy změnil, nedokládá dnešní schránku:
      // odkaz mohl odejít na tu předchozí a adresa se změnit až během obnovy.
      // Spor proto zůstává a rozhodne potvrzení adresy.
      await auth.api.requestPasswordReset({ body: { email: takenEmail } });
      const resetToken = emailsTo(log, takenEmail)
        .at(-1)
        ?.text.match(/\/reset-password\/([^?\s]+)/)?.[1];
      await auth.api.resetPassword({ body: { newPassword: resetPassword, token: resetToken! } });
      expect((await contestRows()).length).toBe(contestsBefore + 1);

      await confirmAddress(auth, log, takenEmail);
      expect(await signInStatus(auth, takenEmail, resetPassword)).toBe(401);
      expect(await signInStatus(auth, takenEmail, password)).toBe(401);
      expect((await contestRows()).length).toBe(contestsBefore);
    },
  );

  it(
    'R1-01: spor patří k adrese, ne k účtu — smazání a nové založení účtu ho neshodí',
    { timeout: 60_000 },
    async () => {
      const holderEmail = 'druhy-drzitel@priklad.test';
      const ownerEmail = 'majitel-dve@priklad.test';
      const holderPassword = 'heslo-druheho-drzitele-01';

      await signUpVerified(auth, { email: holderEmail, password: holderPassword, name: 'Cizí' });
      const holderCookie = await signInCookie(auth, holderEmail, holderPassword);
      const log = startEmailLog();
      await changeEmail(holderCookie, ownerEmail, holderPassword);

      // majitel se registruje a odkaz mu leží ve schránce
      await signUp(auth, ownerEmail, 'heslo-majitele-dve-02', 'Majitel');
      const firstAccountId = (await accountState(ownerEmail)).id;

      // držitel účet smaže a adresu si vzápětí předregistruje znovu, týmž heslem
      const { deleteAccountAction } = await import('@/app/(app)/nastaveni/actions');
      requestState.cookie = holderCookie;
      expect(
        await redirectTarget(() =>
          deleteAccountAction(form({ heslo: holderPassword, potvrzeni: 'SMAZAT' })),
        ),
      ).toBe('/?smazano=1');
      requestState.cookie = '';
      await signUp(auth, ownerEmail, holderPassword, 'Cizí');
      expect((await accountState(ownerEmail)).id).not.toBe(firstAccountId);

      await confirmAddress(auth, log, ownerEmail);
      expect(await signInStatus(auth, ownerEmail, holderPassword)).toBe(401);
    },
  );

  it(
    'R1-02: po cizí registraci na adresu s překlepem si uživatel e-mail opraví, heslo změní i účet smaže',
    { timeout: 90_000 },
    async () => {
      const originalEmail = 'uzivatel@priklad.test';
      const typoEmail = 'uzivatel@prilkad.test';
      const password = 'heslo-uzivatele-s-daty-01';
      const newPassword = 'uplne-nove-heslo-03';

      await signUpVerified(auth, { email: originalEmail, password, name: 'Uživatel' });
      const cookie = await signInCookie(auth, originalEmail, password);
      const log = startEmailLog();

      // uživatel změní e-mail a udělá v něm překlep
      expect(await changeEmail(cookie, typoEmail, password)).toBe('/nastaveni/ucet?ok=email');
      const before = await accountState(typoEmail);

      // komu ta adresa patří, dostal „Potvrď svůj e-mail“ a zkusí se zaregistrovat
      expect((await signUp(auth, typoEmail, 'heslo-ciziho-cloveka-02', 'Cizí')).status).toBe(200);
      const contested = await accountState(typoEmail);
      expect(contested.hash).toBe(before.hash);
      expect(contested.passwordAudits).toHaveLength(0);
      expect(contested.sessionCount).toBe(before.sessionCount);

      // uživatel si překlepu všimne a opraví ho — svým (správným) heslem
      expect(await changeEmail(cookie, originalEmail, password)).toBe('/nastaveni/ucet?ok=email');

      // potvrdí svou adresu z jiného zařízení: spor o adresu s překlepem se ho
      // netýká, takže mu zůstane heslo i původní relace
      await confirmAddress(auth, log, originalEmail);
      expect(await signInStatus(auth, originalEmail, password)).toBe(200);
      expect(
        (await auth.api.getSession({ headers: new Headers({ cookie }) }))?.user.email,
      ).toBe(originalEmail);
      expect((await accountState(originalEmail)).passwordAudits).toHaveLength(0);

      // změna hesla i smazání účtu fungují dál
      const { changePasswordAction, deleteAccountAction } = await import(
        '@/app/(app)/nastaveni/actions'
      );
      requestState.cookie = cookie;
      expect(
        await redirectTarget(() =>
          changePasswordAction(form({ 'stavajici-heslo': password, 'nove-heslo': newPassword })),
        ),
      ).toBe('/nastaveni/ucet?ok=heslo');
      // změna hesla ostatní relace ruší a tu vlastní vymění — přihlas se znovu
      requestState.cookie = await signInCookie(auth, originalEmail, newPassword);
      expect(
        await redirectTarget(() =>
          deleteAccountAction(form({ heslo: newPassword, potvrzeni: 'SMAZAT' })),
        ),
      ).toBe('/?smazano=1');
    },
  );

  it(
    'R1-03: opakované registrace historii účtu nezaplní',
    { timeout: 60_000 },
    async () => {
      const ownEmail = 'historie@priklad.test';
      const newEmail = 'historie-nova@priklad.test';
      const password = 'heslo-pro-historii-uctu-01';

      await signUpVerified(auth, { email: ownEmail, password, name: 'Uživatel' });
      const cookie = await signInCookie(auth, ownEmail, password);
      const log = startEmailLog();
      await changeEmail(cookie, newEmail, password);

      // L6b-05 (R19): původní adresa se o změně dozví — a nová v té zprávě
      // nestojí celá (původní schránku už uživatel nemusí ovládat)
      const notices = emailsTo(log, ownEmail);
      expect(notices).toHaveLength(1);
      expect(notices[0]!.subject).toContain('se změnil');
      expect(notices[0]!.text).toContain('h***@priklad.test');
      expect(notices[0]!.text).not.toContain(newEmail);
      expect(notices[0]!.text).not.toMatch(/https?:\/\/\S*(token|verify)/);

      const { getDb } = await import('@/db');
      const { recentAuditEvents } = await import('@/lib/audit');
      const db = await getDb();
      const { id } = await accountState(newEmail);
      const typesBefore = (await recentAuditEvents(db, id)).map((entry) => entry.type);
      expect(typesBefore).toContain('EMAIL_CHANGE');

      for (let attempt = 0; attempt < 4; attempt += 1) {
        await signUp(auth, newEmail, `uplne-jine-heslo-${attempt}`, 'Cizí');
      }

      // čtyři pokusy nezapsaly do historie nic — není co oznamovat, nic se nezrušilo
      expect((await recentAuditEvents(db, id)).map((entry) => entry.type)).toEqual(typesBefore);

      // zápis je jeden, až když heslo opravdu přestane platit
      await confirmAddress(auth, log, newEmail);
      const after = await accountState(newEmail);
      expect(after.passwordAudits).toHaveLength(1);
      expect(after.passwordAudits[0]!.detail).toContain('zrušeno');
    },
  );
});
