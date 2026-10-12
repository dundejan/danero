'use client';

import { useState } from 'react';
import { authClient } from '@/lib/auth-client';
import { resendVerificationErrorMessage } from '@/lib/auth-errors';
import { Button } from '@/components/ui/button';
import { describedByError, Field, FieldError, Input } from '@/components/ui/field';
import { StatusLabel } from '@/components/ui/status';

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
      <div role="status">
        <StatusLabel tone="success">Odkaz je na cestě.</StatusLabel>
      </div>
    );
  }

  return (
    <form method="post" onSubmit={onSubmit} className="space-y-5">
      {defaultEmail ? (
        // Adresu známe z registrace — pole by jen opakovalo to, co stojí
        // o řádek výš, takže zbývá jediné tlačítko.
        <>
          <input type="hidden" name="email" value={defaultEmail} />
          {error && <FieldError id={ERROR_ID}>{error}</FieldError>}
        </>
      ) : (
        <Field label="E-mail" htmlFor="email" error={error} errorId={ERROR_ID}>
          <Input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            {...describedByError(error !== null, ERROR_ID)}
          />
        </Field>
      )}
      <Button type="submit" disabled={pending} variant="secondary" className="w-full">
        {pending ? 'Odesílám…' : 'Poslat odkaz znovu'}
      </Button>
    </form>
  );
}
