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
        <p className="mt-1 text-sm text-inkoust-tlumeny">
          Už máš účet?{' '}
          <Link href="/prihlaseni" className="font-medium text-ruzova">
            Přihlas se
          </Link>
        </p>
      </div>
      <AuthForm mode="registrace" />
    </main>
  );
}
