import Link from 'next/link';
import { FormPage } from '@/components/form-page';
import { NewPasswordForm } from '@/components/new-password-form';
import { buttonVariants } from '@/components/ui/button';
import { NOINDEX } from '@/lib/site';

export const metadata = { title: 'Nové heslo — Danero', robots: NOINDEX };

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

  if (token && !error) return <NewPasswordForm token={token} />;

  return (
    <FormPage
      title="Odkaz už neplatí"
      lede="Odkaz na obnovu hesla platí hodinu a použít ho jde jen jednou."
    >
      <Link href="/zapomenute-heslo" className={buttonVariants({ className: 'w-full' })}>
        Poslat nový odkaz
      </Link>
    </FormPage>
  );
}
