import { ForgotPasswordForm } from '@/components/forgot-password-form';
import { NOINDEX } from '@/lib/site';

export const metadata = { title: 'Zapomenuté heslo — Danero', robots: NOINDEX };

export default function ForgotPasswordPage() {
  return <ForgotPasswordForm />;
}
