import { describe, expect, it } from 'vitest';

describe('auth flow přes Better Auth API (in-memory PGlite)', () => {
  it('registrace → přihlášení → špatné heslo selže', { timeout: 30_000 }, async () => {
    process.env.PGLITE_DATA_DIR = ':memory:';
    const { getAuth } = await import('@/lib/auth');
    const auth = await getAuth();

    const signUp = await auth.api.signUpEmail({
      body: { email: 'jan@test.cz', password: 'superbezpecneheslo', name: 'Jan' },
    });
    expect(signUp.user.email).toBe('jan@test.cz');

    const signIn = await auth.api.signInEmail({
      body: { email: 'jan@test.cz', password: 'superbezpecneheslo' },
    });
    expect(signIn.user.id).toBe(signUp.user.id);

    await expect(
      auth.api.signInEmail({ body: { email: 'jan@test.cz', password: 'spatne-heslo-123' } }),
    ).rejects.toThrow();

    // krátké heslo odmítne už registrace (minPasswordLength 10)
    await expect(
      auth.api.signUpEmail({ body: { email: 'kratke@test.cz', password: 'kratke', name: 'K' } }),
    ).rejects.toThrow();
  });
});
