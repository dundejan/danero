import Link from 'next/link';
import { ForgotPasswordForm } from '@/components/forgot-password-form';
import { Logo } from '@/components/logo';

export const metadata = { title: 'Zapomenuté heslo — Danero' };

export default function ForgotPasswordPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-8 px-6">
      <div>
        <Link href="/" className="mb-8 inline-block" aria-label="Danero — na úvodní stránku">
          <Logo className="text-lg" />
        </Link>
        <h1 className="font-display text-3xl font-bold">Zapomenuté heslo</h1>
        <p className="mt-2 text-sm text-inkoust-tlumeny">
          Napiš e-mail, kterým se přihlašuješ. Pošleme ti odkaz na nastavení nového hesla — platí
          hodinu.
        </p>
      </div>
      <ForgotPasswordForm />
      <p className="text-sm text-inkoust-tlumeny">
        <Link href="/prihlaseni" className="font-medium text-ruzova-text">
          Zpátky na přihlášení
        </Link>
      </p>
    </main>
  );
}
