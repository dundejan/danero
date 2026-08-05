'use client';

import Link from 'next/link';
import { useState } from 'react';
import { authClient } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/field';

export function NewPasswordForm({ token }: { token: string }) {
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const heslo = String(form.get('heslo') ?? '');
    if (heslo !== String(form.get('heslo2') ?? '')) {
      setError('Hesla se neshodují.');
      return;
    }

    setPending(true);
    setError(null);
    const result = await authClient.resetPassword({ newPassword: heslo, token });
    setPending(false);

    if (result.error) {
      setError(
        result.error.status === 429
          ? 'Zkoušel jsi to příliš často. Zkus to prosím za pár minut.'
          : 'Heslo se nepodařilo změnit — odkaz už nejspíš neplatí. Nech si poslat nový.',
      );
      return;
    }
    setDone(true);
  }

  if (done) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-linka bg-papir-tlumeny p-4 text-sm">
          <p className="font-medium">Heslo je změněné.</p>
          <p className="mt-2 text-inkoust-tlumeny">
            Pro jistotu jsme tě odhlásili ze všech zařízení — přihlas se prosím znovu.
          </p>
        </div>
        <Link
          href="/prihlaseni"
          className="font-medium text-ruzova-text underline underline-offset-2"
        >
          Přihlásit se
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <Label htmlFor="heslo">Nové heslo (min. 10 znaků)</Label>
        <Input
          id="heslo"
          name="heslo"
          type="password"
          required
          minLength={10}
          autoFocus
          autoComplete="new-password"
        />
      </div>
      <div>
        <Label htmlFor="heslo2">Nové heslo ještě jednou</Label>
        <Input
          id="heslo2"
          name="heslo2"
          type="password"
          required
          minLength={10}
          autoComplete="new-password"
        />
      </div>
      {error && <p className="text-sm text-cervena">{error}</p>}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? 'Ukládám…' : 'Nastavit heslo'}
      </Button>
    </form>
  );
}
