'use client';

import { useState } from 'react';
import { authClient } from '@/lib/auth-client';
import { FormPage } from '@/components/form-page';
import { Button } from '@/components/ui/button';
import { describedByError, Field, Input } from '@/components/ui/field';
import { TextLink } from '@/components/ui/link';

const ERROR_ID = 'zapomenute-heslo-error';

const BACK_TO_SIGN_IN = <TextLink href="/prihlaseni">Zpátky na přihlášení</TextLink>;

export function ForgotPasswordForm() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const email = String(new FormData(event.currentTarget).get('email') ?? '');

    try {
      const result = await authClient.requestPasswordReset({
        email,
        // odkaz z e-mailu projde ověřením tokenu na serveru a skončí tady
        redirectTo: '/nove-heslo',
      });
      if (result.error) {
        setError(
          result.error.status === 429
            ? 'Zkoušel jsi to příliš často. Zkus to prosím za pár minut.'
            : 'E-mail se nepodařilo odeslat. Zkus to prosím za chvíli znovu.',
        );
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

  // Záměrně stejná odpověď bez ohledu na to, jestli účet existuje — jinak by
  // formulář prozrazoval, kdo Danero používá.
  if (sent) {
    return (
      <FormPage title="Zkontroluj schránku" footer={BACK_TO_SIGN_IN}>
        <div role="status" className="space-y-2 text-pretty">
          <p>Pokud u nás účet s touhle adresou je, poslali jsme na ni odkaz.</p>
          <p className="type-callout text-ink-muted">
            Platí hodinu a použít ho jde jednou. Podívej se i do spamu.
          </p>
        </div>
      </FormPage>
    );
  }

  return (
    <FormPage
      title="Zapomenuté heslo"
      lede="Pošleme ti odkaz na nastavení nového hesla."
      footer={BACK_TO_SIGN_IN}
    >
      <form onSubmit={onSubmit} className="space-y-5">
        <Field label="E-mail" htmlFor="email" error={error} errorId={ERROR_ID}>
          <Input
            id="email"
            name="email"
            type="email"
            required
            autoFocus
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            {...describedByError(error !== null, ERROR_ID)}
          />
        </Field>
        <Button type="submit" disabled={pending} className="w-full">
          {pending ? 'Odesílám…' : 'Poslat odkaz'}
        </Button>
      </form>
    </FormPage>
  );
}
