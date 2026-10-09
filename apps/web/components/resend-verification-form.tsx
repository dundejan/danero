'use client';

import { useState } from 'react';
import { authClient } from '@/lib/auth-client';
import { resendVerificationErrorMessage } from '@/lib/auth-errors';
import { Button } from '@/components/ui/button';
import { describedByError, FieldError, Input, Label } from '@/components/ui/field';

const ERROR_ID = 'overeni-emailu-error';

export function ResendVerificationForm({
  defaultEmail,
  deliveryConfigured = true,
}: {
  defaultEmail?: string | undefined;
  /**
   * Má instance čím e-mail odeslat (`emailDeliveryConfigured`, zjišťuje stránka
   * na serveru)? Když ne, neúspěšné odeslání neradí „zkus to za chvíli“ (L10-01).
   * Výchozí hodnota platí pro `/overeni-emailu/hotovo`: tam vede jen odkaz
   * z e-mailu, takže odesílání fungovat muselo.
   */
  deliveryConfigured?: boolean;
}) {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const email = String(new FormData(event.currentTarget).get('email') ?? '');

    try {
      const result = await authClient.sendVerificationEmail({
        email,
        callbackURL: '/overeni-emailu/hotovo',
      });
      if (result.error) {
        setError(resendVerificationErrorMessage(result.error, deliveryConfigured));
        return;
      }
      setSent(true);
    } catch {
      // Bez tohohle bloku promise při výpadku sítě rejectla, `setPending(false)`
      // se neprovedlo a formulář zůstal zamčený navždy a beze slova (H2-01).
      setError('Nepodařilo se spojit se serverem. Zkontroluj připojení a zkus to znovu.');
    } finally {
      setPending(false);
    }
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
          {...describedByError(error !== null, ERROR_ID)}
        />
      </div>
      {error && <FieldError id={ERROR_ID}>{error}</FieldError>}
      <Button type="submit" disabled={pending} variant="secondary" className="w-full">
        {pending ? 'Odesílám…' : 'Poslat odkaz znovu'}
      </Button>
    </form>
  );
}
