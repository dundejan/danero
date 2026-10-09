import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { and, eq, gt } from 'drizzle-orm';
import type { Db } from '@/db';
import { account, session, verification } from '@/db/schema';
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
 * Pravidlo má dva kroky:
 *
 * 1. **Registrace s jiným heslem adresu označí za spornou** (`markContested`)
 *    a pošle na ni nový ověřovací odkaz. Na účtu se v tu chvíli NIC nemění.
 * 2. **Kdo spornou adresu potvrdí, dostane účet bez hesla a bez relací**
 *    (`settleSignupContest`, háček `beforeEmailVerification`): uložený otisk
 *    nahradí otisk náhodného tajemství, které nikdo nezná, a zruší se všechny
 *    relace účtu. Heslo si nastaví přes „Zapomenuté heslo“ — odkaz chodí jen do
 *    jeho schránky. Přihlášený zůstane: Better Auth mu po potvrzení otevře
 *    novou relaci.
 *
 * Proč až při potvrzení a proč i relace (D01-R1-01, R1-02): nepotvrzený není
 * jen účet z předregistrace, ale i ZAVEDENÝ účet po změně e-mailu
 * (`changeEmailAction` nastavuje `emailVerified = false`). Ten má data, heslo,
 * které jeho držitel zná, a živou relaci.
 *  - Kdyby heslo padlo už při cizí registraci, uživatel, který v nové adrese
 *    udělal překlep, by ji už neopravil, heslo nezměnil a účet nesmazal — to
 *    všechno chce stávající heslo a obnova chodí na adresu s překlepem.
 *  - Kdyby padlo jen heslo, zůstal by v účtu ten, kdo si cizí adresu „zabral“
 *    změnou e-mailu: jeho relace by přežila potvrzení adresy majitelem.
 * Do potvrzení tedy držitel o nic nepřijde; po potvrzení patří účet tomu, kdo
 * doložil schránku.
 *
 * ⚠️ Heslo se schválně NEPŘEPISUJE tím z nového pokusu. Vyhrával by poslední
 * zapisující, takže útočníkovi by stačilo zaregistrovat se jako druhý. A odkaz
 * nejde svázat s konkrétním pokusem: ověřovací token je JWT jen s adresou.
 *
 * ⚠️ Spor patří k ADRESE, ne k účtu. Ověřovací odkaz taky nese jen adresu,
 * takže platí i pro účet, který na ní vznikl později: kdyby spor visel na id
 * účtu, držitel by ho shodil tím, že účet smaže a adresu si předregistruje
 * znovu (a stejně tak změnou e-mailu jinam a zpátky). Ze stejného důvodu spor
 * neruší registrace stejným heslem, zrušení účtu ani jeho odchod z adresy —
 * končí potvrzením adresy, vypršením, nebo tím, že předregistrovaný účet na ní
 * projde obnovou hesla (`closeSignupContestAfterPasswordReset`, D01-R2-01): ta
 * dokládá schránku stejně jako potvrzení a udělá s účtem totéž.
 *
 * Potvrzeného účtu se tohle netýká vůbec — tam o hesle rozhoduje jen majitel.
 *
 * Vědomá cena: kdo zná adresu nepotvrzeného účtu, umí způsobit, že po jejím
 * potvrzení přestane platit heslo a skončí otevřené relace, a umí vyvolat další
 * ověřovací e-mail (strop registrace je 5 za minutu na IP). Proti převzetí účtu
 * je to přijatelná výměna.
 */

/** Kam vede odkaz z ověřovacího e-mailu — totéž, co posílá registrační formulář. */
const VERIFICATION_CALLBACK_URL = '/overeni-emailu/hotovo';

/**
 * Spor se drží v tabulce `verification` (obecné úložiště Better Authu pro
 * „čeká na ověření“) — prošlé řádky z ní maže noční úklid (`pruneVerifications`).
 * Identifikátor je otisk adresy, ne adresa: řádek přežije i zrušení účtu
 * a nemá nést nic, z čeho jde adresa přečíst.
 */
const CONTEST_PREFIX = 'signup-contest:';

/**
 * Jak dlouho spor platí. Musí přežít každý odkaz, který si na adresu může
 * nechat poslat držitel nepotvrzeného účtu — jinak by stačilo počkat a poslat
 * majiteli odkaz nový. Zároveň to není navždy: adresa, kterou nikdo nepotvrdí,
 * po sobě nemá nechávat stopu bez konce. Každá další neshodná registrace lhůtu
 * obnoví.
 */
const CONTEST_LIFETIME_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * O kolik se smí lišit `updatedAt` od `createdAt` u účtu, který od založení
 * nikdo nezměnil: Better Auth obě hodnoty bere dvěma voláními `new Date()` po
 * sobě. Změna e-mailu se do toho nevejde — mezi založením účtu a ní leží
 * potvrzení adresy, přihlášení a dvojí ověření hesla (scrypt).
 */
const UNTOUCHED_TOLERANCE_MS = 50;

interface ExistingUser {
  id: string;
  email: string;
  emailVerified: boolean;
}

const contestIdentifier = (email: string): string =>
  `${CONTEST_PREFIX}${createHash('sha256').update(email.trim().toLowerCase()).digest('hex')}`;

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
 * Označí adresu za spornou. Jeden řádek na adresu, ať přijde pokusů kolik chce
 * (D01-R1-03: dřív každý pokus přepsal otisk a zapsal audit, takže dvacet
 * registrací vytlačilo z historie účtu všechno ostatní).
 */
async function markContested(db: Db, email: string): Promise<void> {
  const identifier = contestIdentifier(email);
  await db.delete(verification).where(eq(verification.identifier, identifier));
  await db.insert(verification).values({
    id: randomUUID(),
    identifier,
    value: 'contested',
    expiresAt: new Date(Date.now() + CONTEST_LIFETIME_MS),
  });
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
  // potvrzený účet se nemění, nic se na něj neposílá a jeho adresa se
  // neoznačuje — jinak by ji cizí člověk „otrávil“ pro případ, že se na ni
  // majitel někdy vrátí změnou e-mailu
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
    if (!samePerson) await markContested(db, user.email);

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

/**
 * Háček `emailAndPassword.onPasswordReset` (D01-R2-01): dokončená obnova hesla
 * spor adresy účtu uzavře.
 *
 * Spor říká „v účtu může být heslo a relace někoho, kdo schránku nevlastní“.
 * Po obnově to neplatí: odkaz přišel jen do schránky, heslo zná jen ten, kdo
 * ho otevřel, a relace jsou pryč. Bez tohohle by potvrzení adresy zrušilo
 * heslo, které si majitel před chvílí sám nastavil — přesně to se stane tomu,
 * kdo ověřovací e-mail přehlédne, přihlášení mu ohlásí „špatné heslo“ (v účtu
 * je ještě to z předregistrace) a on jde na „Zapomenuté heslo“.
 *
 * ⚠️ Relace se ruší TADY a dřív než spor, i když je Better Auth ruší taky
 * (`revokeSessionsOnPasswordReset`): ten to dělá až PO tomhle háčku, takže
 * kdyby jeho mazání selhalo, zůstal by účet bez sporu a s cizí relací. Když
 * selže cokoli tady, spor zůstane a rozhodne se až při potvrzení adresy.
 *
 * ⚠️ Jen u účtu, který od založení NIKDO NEZMĚNIL (`updatedAt` = `createdAt`),
 * tedy u předregistrace. Obnova dokládá schránku, do které odkaz ODEŠEL, a ta
 * nemusí být ta dnešní: Better Auth odkaz spotřebuje, pak stovky milisekund
 * počítá otisk hesla a účet si přečte až potom. Kdo má zavedený účet, nechal
 * by si odkaz poslat na vlastní adresu a souběžně s obnovou přešel změnou
 * e-mailu na spornou cizí — spor by zavřel heslem, které zná on, a majitel by
 * pak svým odkazem potvrdil účet s cizím heslem (D01-R1-01). `changeEmailAction`
 * zapisuje `updatedAt` týmž příkazem jako novou adresu, takže účet, který kdy
 * adresu změnil, touhle podmínkou neprojde ani při souběhu; účet, který ji
 * nezměnil, má adresu od založení stejnou a odkaz jinam odejít nemohl.
 * U zavedeného účtu tedy spor zůstává a rozhodne potvrzení adresy.
 */
export async function closeSignupContestAfterPasswordReset(
  db: Db,
  user: { id: string; email: string; createdAt: Date; updatedAt: Date },
): Promise<void> {
  if (user.updatedAt.getTime() - user.createdAt.getTime() > UNTOUCHED_TOLERANCE_MS) return;
  const identifier = contestIdentifier(user.email);
  const [contest] = await db
    .select({ id: verification.id })
    .from(verification)
    .where(eq(verification.identifier, identifier))
    .limit(1);
  if (!contest) return;
  await db.delete(session).where(eq(session.userId, user.id));
  await db.delete(verification).where(eq(verification.identifier, identifier));
}

/**
 * Háček `emailVerification.beforeEmailVerification`: potvrzuje-li se sporná
 * adresa, účet přijde o heslo i o všechny relace dřív, než se stane potvrzeným.
 *
 * ⚠️ Schválně PŘED potvrzením a schválně bez `try/catch`: když se heslo nebo
 * relace zrušit nepodaří, výjimka potvrzení zastaví a adresa zůstane
 * nepotvrzená i sporná — kliknutí jde zopakovat. V háčku „po potvrzení“ by
 * selhání nechalo potvrzený účet s cizím heslem i relací. Spor se proto maže až
 * jako poslední zápis.
 *
 * Relace se ruší dřív, než Better Auth otevře novou tomu, kdo na odkaz klikl
 * (`autoSignInAfterVerification`), takže ten přihlášený zůstane.
 */
export async function settleSignupContest(
  db: Db,
  user: { id: string; email: string },
): Promise<void> {
  const identifier = contestIdentifier(user.email);
  const [contest] = await db
    .select({ id: verification.id })
    .from(verification)
    .where(and(eq(verification.identifier, identifier), gt(verification.expiresAt, new Date())))
    .limit(1);
  if (!contest) return;

  const unknowable = await hashPassword(randomBytes(32).toString('base64url'));
  await db
    .update(account)
    .set({ password: unknowable, updatedAt: new Date() })
    .where(and(eq(account.userId, user.id), eq(account.providerId, 'credential')));
  await db.delete(session).where(eq(session.userId, user.id));
  await db.delete(verification).where(eq(verification.identifier, identifier));
  await logAudit(
    db,
    user.id,
    'PASSWORD_CHANGE',
    'zrušeno — na tuhle adresu přišla před jejím potvrzením registrace s jiným heslem; ostatní přihlášení ukončena',
  );
}
