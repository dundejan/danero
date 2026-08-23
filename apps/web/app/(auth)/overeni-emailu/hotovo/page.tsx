import { headers } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Logo } from '@/components/logo';
import { ResendVerificationForm } from '@/components/resend-verification-form';
import { buttonVariants } from '@/components/ui/button';
import { getAuth } from '@/lib/auth';

export const metadata = { title: 'E-mail potvrzený — Danero' };

/**
 * Cíl odkazu z ověřovacího e-mailu (K8-05).
 *
 * Vlastní stránka existuje kvůli firemním bránám, které odkazy ve zprávách
 * předvybírají (M365 Safe Links, Proofpoint, Mimecast). Skener klikne první,
 * ověření se tím spotřebuje — a když pak klikne uživatel, přijde sem BEZ
 * relace. Rozcestník `/overeni-emailu` mu v takové chvíli tvrdil „Poslali jsme
 * ti odkaz, klikni na něj" a nabízel tlačítko, které u ověřené adresy nic
 * nepošle. Dvakrát po sobě nepravda, a přitom stačí jedno přihlášení.
 *
 * ⚠️ Text se schválně nerozhoduje podle toho, co je v databázi: kdyby stránka
 * hledala adresu, stalo by se z ní orákulum „tahle adresa u Danera existuje
 * a je ověřená". Bez relace říká totéž komukoli.
 */
export default async function EmailVerifiedPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  if (!error) {
    const session = await (await getAuth()).api.getSession({ headers: await headers() });
    if (session?.user.emailVerified) redirect('/vitejte');
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-8 px-6">
      <div>
        <Link href="/" className="mb-8 inline-block" aria-label="Danero — na úvodní stránku">
          <Logo className="text-lg" />
        </Link>
        <h1 className="font-display text-3xl font-bold">
          {error ? 'Odkaz už neplatí' : 'Adresu máme potvrzenou'}
        </h1>
        <p className="mt-2 text-sm text-inkoust-tlumeny">
          {error ? (
            <>Ověřovací odkaz vypršel nebo už byl použitý. Nech si poslat nový.</>
          ) : (
            <>
              Stačí se přihlásit a jsi uvnitř. Že tě odkaz rovnou nepustil dál, dělá obvykle
              firemní ochrana pošty — otevře si odkazy ve zprávě dřív než ty a ověření tím
              spotřebuje.
            </>
          )}
        </p>
      </div>

      {error ? (
        <>
          <ResendVerificationForm />
          <p className="text-sm text-inkoust-tlumeny">
            <Link href="/prihlaseni" className="font-medium text-ruzova-text">
              Zpátky na přihlášení
            </Link>
          </p>
        </>
      ) : (
        <Link href="/prihlaseni" className={buttonVariants({ className: 'w-full' })}>
          Přihlásit se
        </Link>
      )}
    </main>
  );
}
