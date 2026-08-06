'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { authClient } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/field';

export function AuthForm({ mode }: { mode: 'prihlaseni' | 'registrace' }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [unverified, setUnverified] = useState<{ email: string; resent: boolean } | null>(null);
  const [pending, setPending] = useState(false);
  const [totpStep, setTotpStep] = useState(false);

  const finish = () => {
    // registrace nevytváří session — účet čeká na potvrzení e-mailu, teprve
    // odkaz z něj přihlásí a pustí do onboarding průvodce (G9a)
    router.push('/prehled');
    router.refresh();
  };

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const form = new FormData(event.currentTarget);

    if (totpStep) {
      const result = await authClient.twoFactor.verifyTotp({
        code: String(form.get('kod') ?? ''),
      });
      setPending(false);
      if (result.error) {
        setError('Kód nesedí. Zkontroluj aplikaci autentikátoru a zkus to znovu.');
        return;
      }
      finish();
      return;
    }

    const email = String(form.get('email') ?? '');
    const password = String(form.get('heslo') ?? '');

    // callbackURL u registrace = kam vede odkaz z ověřovacího e-mailu; bez něj
    // by Better Auth poslal ověřeného uživatele na landing místo do onboardingu.
    // U přihlášení ho NEposílat: klient by na něj skočil i po úspěšném loginu
    // a normální přihlášení by končilo v onboardingu místo na přehledu.
    const result =
      mode === 'registrace'
        ? await authClient.signUp.email({
            email,
            password,
            name: String(form.get('jmeno') ?? '') || email.split('@')[0]!,
            callbackURL: '/overeni-emailu',
          })
        : await authClient.signIn.email({ email, password });

    setPending(false);
    if (result.error) {
      // Nepotvrzený účet — pošli nový odkaz. Schválně jen podle kódu: na 403
      // končí i neshoda originu (BETTER_AUTH_URL vs. doména) a tu by tahle
      // hláška zamaskovala.
      if (result.error.code === 'EMAIL_NOT_VERIFIED') {
        const resend = await authClient.sendVerificationEmail({
          email,
          callbackURL: '/overeni-emailu',
        });
        setUnverified({ email, resent: !resend.error });
        return;
      }
      setError(
        mode === 'registrace'
          ? 'Registrace se nepodařila. Zkontroluj e-mail a zvol heslo o délce aspoň 10 znaků.'
          : 'Přihlášení se nepodařilo. Zkontroluj e-mail a heslo.',
      );
      return;
    }
    if (mode === 'registrace') {
      router.push(`/overeni-emailu?email=${encodeURIComponent(email)}`);
      return;
    }
    if (result.data && 'twoFactorRedirect' in result.data && result.data.twoFactorRedirect) {
      setTotpStep(true);
      return;
    }
    finish();
  }

  if (unverified) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-linka bg-plocha p-4 text-sm">
          <p className="font-medium">Účet ještě není potvrzený.</p>
          <p className="mt-2 text-inkoust-tlumeny">
            {unverified.resent
              ? `Poslali jsme ti na ${unverified.email} nový ověřovací odkaz. Klikni na něj a jsi uvnitř.`
              : 'Potvrď adresu odkazem, který ti přišel po registraci. Nový si můžeš nechat poslat níž.'}
          </p>
        </div>
        <Link
          href={`/overeni-emailu?email=${encodeURIComponent(unverified.email)}`}
          className="text-sm font-medium text-ruzova-text underline underline-offset-2"
        >
          Nepřišel? Poslat znovu
        </Link>
      </div>
    );
  }

  if (totpStep) {
    return (
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <Label htmlFor="kod">Kód z autentikátoru</Label>
          <Input
            id="kod"
            name="kod"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            required
            autoFocus
            className="font-mono tracking-widest"
          />
        </div>
        {error && <p className="text-sm text-cervena">{error}</p>}
        <Button type="submit" disabled={pending} className="w-full">
          {pending ? 'Ověřuji…' : 'Ověřit kód'}
        </Button>
      </form>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {mode === 'registrace' && (
        <div>
          <Label htmlFor="jmeno">
            Jméno{' '}
            <span className="font-normal text-inkoust-tlumeny">
              (nepovinné — jak ti máme říkat)
            </span>
          </Label>
          <Input id="jmeno" name="jmeno" autoComplete="name" />
        </div>
      )}
      <div>
        <Label htmlFor="email">E-mail</Label>
        <Input id="email" name="email" type="email" required autoComplete="email" />
      </div>
      <div>
        <Label htmlFor="heslo">{mode === 'registrace' ? 'Heslo (min. 10 znaků)' : 'Heslo'}</Label>
        <Input
          id="heslo"
          name="heslo"
          type="password"
          // validace délky patří jen k registraci — při loginu uživatel zadává
          // heslo, které zná; hlídat mu jeho tvar nedává smysl (chybné heslo
          // stejně odmítne server jednotnou hláškou)
          {...(mode === 'registrace' ? { required: true, minLength: 10 } : {})}
          autoComplete={mode === 'registrace' ? 'new-password' : 'current-password'}
        />
      </div>
      {error && <p className="text-sm text-cervena">{error}</p>}
      <Button type="submit" disabled={pending} className="w-full">
        {pending
          ? mode === 'registrace'
            ? 'Vytvářím účet…'
            : 'Přihlašuji…'
          : mode === 'registrace'
            ? 'Vytvořit účet'
            : 'Přihlásit se'}
      </Button>
    </form>
  );
}
