import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { getAuth } from '@/lib/auth';

type Auth = Awaited<ReturnType<typeof getAuth>>;

/**
 * Registrace + potvrzení e-mailu. Od zavedení `requireEmailVerification` se bez
 * potvrzení nedá přihlásit, takže testy, které ověřují něco jiného, si tímhle
 * projdou skutečný odkaz z e-mailu (přes testovací výstup DANERO_EMAIL_LOG).
 */
export async function signUpVerified(
  auth: Auth,
  { email, password, name }: { email: string; password: string; name: string },
): Promise<void> {
  const logPath = join(mkdtempSync(join(tmpdir(), 'danero-test-')), 'emails.log');
  process.env.DANERO_EMAIL_LOG = logPath;
  try {
    await auth.api.signUpEmail({ body: { email, password, name } });
    const token = verificationTokenFrom(logPath);
    await auth.api.verifyEmail({ query: { token } });
  } finally {
    delete process.env.DANERO_EMAIL_LOG;
  }
}

export interface LoggedEmail {
  to: string;
  subject: string;
  text: string;
}

/** Zprávy z testovacího výstupu; dokud nic neodešlo, soubor neexistuje. */
export function emailsIn(logPath: string): LoggedEmail[] {
  if (!existsSync(logPath)) return [];
  return readFileSync(logPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as LoggedEmail);
}

/**
 * Požadavek přes HTTP router, tedy stejnou cestou jako formulář v prohlížeči.
 * Serverové `auth.api.*` požadavek nemá (`ctx.request` je `undefined`), takže
 * háčky, které čtou tělo, by přes něj dostaly něco jiného než v provozu.
 */
export function postAuth(
  auth: Auth,
  path: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return auth.handler(
    new Request(`http://localhost:3000/api/auth${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

/** Token z posledního e-mailu v testovacím výstupu. */
export function verificationTokenFrom(logPath: string): string {
  const url = emailsIn(logPath).at(-1)?.text.match(/https?:\/\/\S+/)?.[0];
  if (!url) throw new Error('E-mail neobsahuje odkaz');
  const token = new URL(url).searchParams.get('token');
  if (!token) throw new Error(`Odkaz neobsahuje token: ${url}`);
  return token;
}
