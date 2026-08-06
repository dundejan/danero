'use client';

import { useState } from 'react';
import { authClient } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/field';

export function ResendVerificationForm({ defaultEmail }: { defaultEmail?: string }) {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const email = String(new FormData(event.currentTarget).get('email') ?? '');

    const result = await authClient.sendVerificationEmail({
      email,
      callbackURL: '/overeni-emailu',
    });
    setPending(false);

    if (result.error) {
      setError(
        result.error.status === 429
          ? 'Zkoušel jsi to příliš často. Zkus to prosím za pár minut.'
          : 'E-mail se nepodařilo odeslat. Zkus to prosím za chvíli znovu.',
      );
      return;
    }
    setSent(true);
  }

  if (sent) {
    return (
      <div className="rounded-lg border border-linka bg-plocha p-4 text-sm">
        <p className="font-medium">Odkaz je na cestě.</p>
        <p className="mt-2 text-inkoust-tlumeny">Zkontroluj schránku i spam.</p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <Label htmlFor="email">E-mail</Label>
        <Input
          id="email"
          name="email"
          type="email"
          required
          defaultValue={defaultEmail}
          autoComplete="email"
        />
      </div>
      {error && <p className="text-sm text-cervena">{error}</p>}
      <Button type="submit" disabled={pending} variant="secondary" className="w-full">
        {pending ? 'Odesílám…' : 'Poslat odkaz znovu'}
      </Button>
    </form>
  );
}
