import Link from 'next/link';
import { AuthForm } from '@/components/auth-form';
import { Logo } from '@/components/logo';

export const metadata = { title: 'Registrace — Danero' };

export default function SignUpPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-8 px-6">
      <div>
        <Link href="/" className="mb-8 inline-block" aria-label="Danero — na úvodní stránku">
          <Logo className="text-lg" />
        </Link>
        <h1 className="font-display text-3xl font-bold">Registrace</h1>
        <p className="mt-2 text-sm text-inkoust-tlumeny">
          Teď v betě všechno zdarma. Bez karty, stačí e-mail.
        </p>
        <p className="mt-1 text-sm text-inkoust-tlumeny">
          Už máš účet?{' '}
          <Link href="/prihlaseni" className="font-medium text-ruzova-text">
            Přihlas se
          </Link>
        </p>
      </div>
      <div>
        <AuthForm mode="registrace" />
        <p className="mt-3 text-center text-sm text-inkoust-tlumeny">
          Za 2 minuty připojíš brokera a uvidíš svoje limity.
        </p>
        {/* B-1 právního auditu: podmínky se do smlouvy včleňují odkazem při
            registraci (§ 1751 OZ) a GDPR informace patří ke sběru údajů (čl. 13);
            věta o betě = výslovné seznámení s rozsahem služby (§ 2389i/2 OZ) */}
        <p className="mt-4 text-center text-xs leading-relaxed text-inkoust-tlumeny">
          Vytvořením účtu souhlasíš s{' '}
          <Link href="/podminky" className="font-medium text-ruzova-text">
            podmínkami užití
          </Link>{' '}
          a potvrzuješ, že víš,{' '}
          <Link href="/soukromi" className="font-medium text-ruzova-text">
            jak nakládáme s tvými daty
          </Link>
          . Danero je teď v betě — služba se může měnit a výpočty si vždy můžeš
          zkontrolovat proti podkladům, které ti ukážeme.
        </p>
      </div>
    </main>
  );
}
