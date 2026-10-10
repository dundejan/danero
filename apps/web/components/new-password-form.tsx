'use client';

import Link from 'next/link';
import { useState } from 'react';
import { authClient } from '@/lib/auth-client';
import { COMMON_PASSWORD_CODE, COMMON_PASSWORD_MESSAGE } from '@/lib/password-strength';
import { FormPage } from '@/components/form-page';
import { Button, buttonVariants } from '@/components/ui/button';
import { describedByError, Field, FieldError, Input } from '@/components/ui/field';

const ERROR_ID = 'nove-heslo-error';
const MISMATCH = 'Hesla se neshodují.';

export function NewPasswordForm({ token }: { token: string }) {
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const mismatched = (form: HTMLFormElement): boolean => {
    const data = new FormData(form);
    const repeated = String(data.get('heslo2') ?? '');
    return repeated !== '' && repeated !== String(data.get('heslo') ?? '');
  };

  /** Neshodu řekneme hned po opuštění druhého pole, ne až po odeslání. */
  function reportMismatch(event: React.FocusEvent<HTMLFormElement>) {
    if (event.target.getAttribute('name') === 'heslo2' && mismatched(event.currentTarget)) {
      setError(MISMATCH);
    }
  }

  /**
   * Hláška mizí při psaní, jakmile hesla sedí — ne až při opuštění pole.
   * Kdyby zmizela ve chvíli, kdy člověk kliká na tlačítko, tlačítko by mu
   * pod myší uskočilo o řádek výš a kliknutí by minulo.
   */
  function clearMismatch(event: React.ChangeEvent<HTMLFormElement>) {
    if (error === MISMATCH && !mismatched(event.currentTarget)) setError(null);
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const heslo = String(form.get('heslo') ?? '');
    if (heslo !== String(form.get('heslo2') ?? '')) {
      setError(MISMATCH);
      return;
    }

    setPending(true);
    setError(null);
    try {
      const result = await authClient.resetPassword({ newPassword: heslo, token });
      if (result.error) {
        setError(
          result.error.status === 429
            ? 'Zkoušel jsi to příliš často. Zkus to prosím za pár minut.'
            : result.error.code === COMMON_PASSWORD_CODE
              ? COMMON_PASSWORD_MESSAGE
              : 'Heslo se nepodařilo změnit — odkaz už nejspíš neplatí. Nech si poslat nový.',
        );
        return;
      }
      setDone(true);
    } catch {
      // Bez tohohle bloku promise při výpadku sítě rejectla, `setPending(false)`
      // se neprovedlo a formulář zůstal zamčený navždy a beze slova (H2-01).
      setError('Nepodařilo se spojit se serverem. Zkontroluj připojení a zkus to znovu.');
    } finally {
      setPending(false);
    }
  }

  if (done) {
    return (
      <FormPage
        title="Heslo je změněné"
        lede="Pro jistotu jsme tě odhlásili ze všech zařízení."
      >
        <Link href="/prihlaseni" className={buttonVariants({ className: 'w-full' })}>
          Přihlásit se
        </Link>
      </FormPage>
    );
  }

  return (
    <FormPage title="Nové heslo">
      <form
        onSubmit={onSubmit}
        onBlur={reportMismatch}
        onChange={clearMismatch}
        className="space-y-5"
      >
        <Field label="Nové heslo" htmlFor="heslo" hint="Aspoň 10 znaků.">
          <Input
            id="heslo"
            name="heslo"
            type="password"
            required
            minLength={10}
            autoFocus
            autoComplete="new-password"
            // chyba se týká obou polí (neshoda hesel i neplatný odkaz) — proto
            // odkaz na tutéž hlášku z obou
            {...describedByError(error !== null, ERROR_ID)}
          />
        </Field>
        <Field label="Heslo ještě jednou" htmlFor="heslo2">
          <Input
            id="heslo2"
            name="heslo2"
            type="password"
            required
            minLength={10}
            autoComplete="new-password"
            {...describedByError(error !== null, ERROR_ID)}
          />
        </Field>
        {error && <FieldError id={ERROR_ID}>{error}</FieldError>}
        <Button type="submit" disabled={pending} className="w-full">
          {pending ? 'Ukládám…' : 'Nastavit heslo'}
        </Button>
      </form>
    </FormPage>
  );
}
