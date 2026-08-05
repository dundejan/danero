import { mkdtempSync, readFileSync } from 'node:fs';
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

/** Token z posledního e-mailu v testovacím výstupu. */
export function verificationTokenFrom(logPath: string): string {
  const messages = readFileSync(logPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { text: string });
  const url = messages.at(-1)?.text.match(/https?:\/\/\S+/)?.[0];
  if (!url) throw new Error('E-mail neobsahuje odkaz');
  const token = new URL(url).searchParams.get('token');
  if (!token) throw new Error(`Odkaz neobsahuje token: ${url}`);
  return token;
}
