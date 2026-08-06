'use client';

import { useState } from 'react';
import { authClient } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import { describedByError, FieldError, Input, Label } from '@/components/ui/field';

const ERROR_ID = 'zapomenute-heslo-error';

export function ForgotPasswordForm() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const email = String(new FormData(event.currentTarget).get('email') ?? '');

    const result = await authClient.requestPasswordReset({
      email,
      // odkaz z e-mailu projde ověřením tokenu na serveru a skončí tady
      redirectTo: '/nove-heslo',
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

  // Záměrně stejná odpověď bez ohledu na to, jestli účet existuje — jinak by
  // formulář prozrazoval, kdo Danero používá.
  if (sent) {
    return (
      <div className="rounded-lg border border-linka bg-plocha p-4 text-sm">
        <p className="font-medium">Pokud u nás účet s touhle adresou je, poslali jsme na ni odkaz.</p>
        <p className="mt-2 text-inkoust-tlumeny">
          Zkontroluj schránku i spam. Odkaz platí hodinu a použít ho jde jednou.
        </p>
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
          autoFocus
          autoComplete="email"
          {...describedByError(error !== null, ERROR_ID)}
        />
      </div>
      {error && <FieldError id={ERROR_ID}>{error}</FieldError>}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? 'Odesílám…' : 'Poslat odkaz'}
      </Button>
    </form>
  );
}
