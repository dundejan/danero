import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { FormPage } from '@/components/form-page';
import { ResendVerificationForm } from '@/components/resend-verification-form';
import { TextLink } from '@/components/ui/link';
import { getAuth } from '@/lib/auth';
import { emailDeliveryConfigured } from '@/lib/email';

export const metadata = { title: 'Potvrzení e-mailu — Danero' };

/**
 * Dvě role naráz: rozcestník po registraci a cíl odkazu z ověřovacího e-mailu.
 * Po úspěšném ověření je přihlášený ten, kdo klikl v prohlížeči, ze kterého
 * o odkaz požádal (`signInVerificationBrowser` v lib/auth-hooks.ts) — toho
 * rovnou pošleme do onboardingu; při chybě nabídneme nový odkaz.
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

  // L10-01: vlastní instance bez Resendu nemá čím odeslat (každé odeslání
  // spadne), a stránka přitom tvrdila „poslali jsme ti odkaz“. Čte se při
  // požadavku — v Dockeru proměnné při buildu nejsou.
  const deliveryConfigured = emailDeliveryConfigured();
  const address = email ? (
    <>
      {' '}
      na <span className="break-all text-ink">{email}</span>
    </>
  ) : null;

  return (
    <FormPage
      title={
        error
          ? 'Odkaz už neplatí'
          : deliveryConfigured
            ? 'Potvrď svůj e-mail'
            : 'Ověřovací odkaz se neodeslal'
      }
      lede={
        error ? (
          <>Ověřovací odkaz vypršel nebo už byl použitý.</>
        ) : !deliveryConfigured ? (
          <>
            Tahle instance Danera nemá nastavené odesílání e-mailů, takže odkaz{address} neodešel.
            Účet půjde potvrdit, až ho nastaví ten, kdo ji provozuje.
          </>
        ) : (
          <>Poslali jsme ti odkaz{address}. Platí 24 hodin.</>
        )
      }
      footer={<TextLink href="/prihlaseni">Zpátky na přihlášení</TextLink>}
    >
      {!error && (
        <p className="type-footnote mb-3 text-pretty text-ink-muted">
          {deliveryConfigured ? (
            <>Nepřišel? Zkontroluj spam.</>
          ) : (
            <>
              Provozuješ ji ty? Nastav proměnnou RESEND_API_KEY (postup je v návodu k vlastní
              instanci, docs/16-selfhosting.md), spusť aplikaci znovu a nech si odkaz poslat
              tlačítkem níž.
            </>
          )}
        </p>
      )}
      <ResendVerificationForm defaultEmail={email} deliveryConfigured={deliveryConfigured} />
    </FormPage>
  );
}
