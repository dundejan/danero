'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { authClient } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/field';

export function AuthForm({ mode }: { mode: 'prihlaseni' | 'registrace' }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [totpStep, setTotpStep] = useState(false);

  const finish = () => {
    // po registraci vede cesta přes onboarding průvodce (G9a)
    router.push(mode === 'registrace' ? '/vitejte' : '/prehled');
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

    const result =
      mode === 'registrace'
        ? await authClient.signUp.email({
            email,
            password,
            name: String(form.get('jmeno') ?? '') || email.split('@')[0]!,
          })
        : await authClient.signIn.email({ email, password });

    setPending(false);
    if (result.error) {
      setError(
        mode === 'registrace'
          ? 'Registrace se nepodařila. Zkontroluj e-mail a zvol heslo o délce aspoň 10 znaků.'
          : 'Přihlášení se nepodařilo. Zkontroluj e-mail a heslo.',
      );
      return;
    }
    if (result.data && 'twoFactorRedirect' in result.data && result.data.twoFactorRedirect) {
      setTotpStep(true);
      return;
    }
    finish();
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
          <Label htmlFor="jmeno">Jméno</Label>
          <Input id="jmeno" name="jmeno" autoComplete="name" />
        </div>
      )}
      <div>
        <Label htmlFor="email">E-mail</Label>
        <Input id="email" name="email" type="email" required autoComplete="email" />
      </div>
      <div>
        <Label htmlFor="heslo">Heslo</Label>
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
