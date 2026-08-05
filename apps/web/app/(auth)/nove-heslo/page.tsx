import Link from 'next/link';
import { Logo } from '@/components/logo';
import { NewPasswordForm } from '@/components/new-password-form';

export const metadata = { title: 'Nové heslo — Danero' };

/**
 * Cíl odkazu z e-mailu. Better Auth token nejdřív ověří na svém endpointu
 * a teprve pak sem přesměruje — buď s `token`, nebo s `error`.
 */
export default async function NewPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const { token, error } = await searchParams;

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-8 px-6">
      <div>
        <Link href="/" className="mb-8 inline-block" aria-label="Danero — na úvodní stránku">
          <Logo className="text-lg" />
        </Link>
        <h1 className="font-display text-3xl font-bold">Nové heslo</h1>
      </div>

      {token && !error ? (
        <NewPasswordForm token={token} />
      ) : (
        <div className="space-y-4">
          <div className="rounded-lg border border-linka bg-papir-tlumeny p-4 text-sm">
            <p className="font-medium">Odkaz už neplatí.</p>
            <p className="mt-2 text-inkoust-tlumeny">
              Odkaz na obnovu hesla platí hodinu a použít ho jde jen jednou. Nech si poslat nový.
            </p>
          </div>
          <Link
            href="/zapomenute-heslo"
            className="font-medium text-ruzova-text underline underline-offset-2"
          >
            Poslat nový odkaz
          </Link>
        </div>
      )}
    </main>
  );
}
