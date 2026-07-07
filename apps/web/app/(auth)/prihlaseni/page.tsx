import Link from 'next/link';
import { AuthForm } from '@/components/auth-form';

export default function SignInPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-8 px-6">
      <div>
        <h1 className="font-display text-3xl font-bold">Přihlášení</h1>
        <p className="mt-1 text-sm text-inkoust-tlumeny">
          Nemáš účet?{' '}
          <Link href="/registrace" className="font-medium text-ruzova">
            Zaregistruj se
          </Link>
        </p>
      </div>
      <AuthForm mode="prihlaseni" />
    </main>
  );
}
