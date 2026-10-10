import { AuthForm } from '@/components/auth-form';

export const metadata = { title: 'Přihlášení — Danero' };

export default function SignInPage() {
  return <AuthForm mode="prihlaseni" />;
}
