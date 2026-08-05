import { headers } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Logo } from '@/components/logo';
import { ResendVerificationForm } from '@/components/resend-verification-form';
import { getAuth } from '@/lib/auth';

export const metadata = { title: 'Potvrzení e-mailu — Danero' };

/**
 * Dvě role naráz: rozcestník po registraci a cíl odkazu z ověřovacího e-mailu.
 * Po úspěšném ověření je uživatel díky autoSignInAfterVerification přihlášený,
 * takže ho rovnou pošleme do onboardingu; při chybě nabídneme nový odkaz.
 */
export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; error?: string }>;
}) {
  const { email: emailParam, error } = await searchParams;
  // parametr z URL se propisuje do textu stránky — ber ho jen když opravdu
  // vypadá jako e-mail, ať se přes odkaz nedá do stránky vsunout cizí text
  const email = emailParam && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailParam) ? emailParam : undefined;

  if (!error) {
    const requestHeaders = await headers();
    const auth = await getAuth();
    const session = await auth.api.getSession({ headers: requestHeaders });
    if (session?.user.emailVerified) redirect('/vitejte');
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-8 px-6">
      <div>
        <Link href="/" className="mb-8 inline-block" aria-label="Danero — na úvodní stránku">
          <Logo className="text-lg" />
        </Link>
        <h1 className="font-display text-3xl font-bold">
          {error ? 'Odkaz už neplatí' : 'Potvrď svůj e-mail'}
        </h1>
        <p className="mt-2 text-sm text-inkoust-tlumeny">
          {error ? (
            <>Ověřovací odkaz vypršel nebo už byl použitý. Nech si poslat nový.</>
          ) : (
            <>
              Poslali jsme ti odkaz{email ? ` na ${email}` : ''}. Klikni na něj a jsi uvnitř —
              odkaz platí 24 hodin.
            </>
          )}
        </p>
      </div>

      <ResendVerificationForm defaultEmail={email} />

      <p className="text-xs leading-relaxed text-inkoust-tlumeny">
        Nepřišel? Zkontroluj spam. Potvrzení chceme proto, že na tuhle adresu ti budou chodit
        upozornění na limity a termíny — a taky obnova hesla, kdybys ho zapomněl.
      </p>
      <p className="text-sm text-inkoust-tlumeny">
        <Link href="/prihlaseni" className="font-medium text-ruzova-text">
          Zpátky na přihlášení
        </Link>
      </p>
    </main>
  );
}
