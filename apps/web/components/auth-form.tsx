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

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const form = new FormData(event.currentTarget);
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
          ? 'Registrace se nepodařila. Zkontroluj e-mail a zvol heslo aspoň o 10 znacích.'
          : 'Přihlášení se nepodařilo. Zkontroluj e-mail a heslo.',
      );
      return;
    }
    router.push('/prehled');
    router.refresh();
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
          required
          minLength={10}
          autoComplete={mode === 'registrace' ? 'new-password' : 'current-password'}
        />
      </div>
      {error && <p className="text-sm text-cervena">{error}</p>}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? 'Pracuji…' : mode === 'registrace' ? 'Vytvořit účet' : 'Přihlásit se'}
      </Button>
    </form>
  );
}
