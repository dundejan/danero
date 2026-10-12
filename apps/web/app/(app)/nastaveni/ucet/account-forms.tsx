'use client';

import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DisclosureRow } from '@/components/ui/disclosure';
import { describedByError, Field, FieldError, Input } from '@/components/ui/field';
import { SubmitButton } from '@/components/ui/submit-button';
import { heldActionResult, type ActionResult } from '@/lib/action-result';
import { tidy } from '@/lib/typography';
import { changeEmailAction, changePasswordAction, deleteAccountAction } from '../actions';
import { settingsErrorText } from '../settings-toast';
import { DELETE_ERRORS, EMAIL_ERRORS, PASSWORD_ERRORS } from './inline-errors';

/**
 * Formuláře stránky Účet, které chybu ukazují u pole: změna e-mailu, změna
 * hesla a smazání účtu. Jsou v prohlížeči, ne na serveru, protože výsledek
 * akce si musí pamatovat i poté, co se stránka obnoví ze serveru bez něj
 * (`lib/action-result.ts`).
 *
 * `name` atributy polí jsou česky a nemění se (čtou je server actions).
 */

const PASSWORD_ERROR_ID = 'zmena-hesla-error';
const EMAIL_ERROR_ID = 'zmena-emailu-error';
const DELETE_ERROR_ID = 'smazani-uctu-error';

/** Parametry adresy, které nesou výsledek akce na téhle stránce. */
const RESULT_PARAMS = ['ok', 'chyba'];

/** Výsledek poslední akce — drží ho, dokud nepřijde další (`lib/action-result.ts`). */
function useActionResult(incoming: ActionResult | null): ActionResult | null {
  const params = useSearchParams();
  const fresh = RESULT_PARAMS.some((name) => params.has(name));
  const [held, setHeld] = useState(() => heldActionResult(null, incoming, fresh));
  const current = heldActionResult(held, incoming, fresh);
  if (current !== held) setHeld(current);
  return current;
}

const errorIn = (result: ActionResult | null, codes: string[]): string | null =>
  result?.error != null && codes.includes(result.error) ? result.error : null;

/**
 * Řádky „E-mail“ a „Heslo“. Po každém výsledku akce vzniknou nanovo: úspěch
 * řádek zavře a pole vyprázdní, chyba ho otevře. Obyčejné obnovení stránky
 * jimi nehýbe — otevřený řádek zůstane otevřený i s tím, co je v něm napsané.
 */
export function CredentialRows({
  email,
  result,
}: {
  email: string;
  result: ActionResult | null;
}) {
  const shown = useActionResult(result);
  const generation = shown?.id ?? 'initial';
  const emailError = errorIn(shown, EMAIL_ERRORS);
  const passwordError = errorIn(shown, PASSWORD_ERRORS);

  return (
    <>
      <DisclosureRow
        key={`email-${generation}`}
        title="E-mail"
        // dlouhou adresu složí řádek sám (tichý údaj má nejvýš 40 % šířky)
        meta={email}
        defaultOpen={emailError !== null}
      >
        <form action={changeEmailAction} className="max-w-[20rem] space-y-4 pt-1 text-ink">
          {/* V řádku je dlouhá adresa zkrácená a celou ukáže jen `title` —
              ten se na dotyku neobjeví. Rozbalený řádek ji proto vypíše. */}
          <p className="type-footnote text-ink-muted">
            Teď: <span className="break-all text-ink">{email}</span>
          </p>
          <Field
            label="Nový e-mail"
            htmlFor="novy-email"
            hint="Pošleme na něj ověřovací odkaz. Dokud ho nepotvrdíš, nepřihlásíš se."
          >
            {/* autoComplete NESMÍ být „email“ — password manager sem cpal
                starou adresu; „off“ + rozbití páru s heslem níže */}
            <Input
              id="novy-email"
              name="novy-email"
              type="email"
              required
              autoComplete="off"
              autoCapitalize="none"
              {...describedByError(
                emailError === 'email' || emailError === 'email-obsazeny',
                EMAIL_ERROR_ID,
              )}
            />
          </Field>
          <Field label="Heslo (potvrzení)" htmlFor="emailPassword">
            <Input
              id="emailPassword"
              name="stavajici-heslo"
              type="password"
              required
              autoComplete="new-password"
              {...describedByError(emailError === 'email-heslo', EMAIL_ERROR_ID)}
            />
          </Field>
          {emailError && (
            <FieldError id={EMAIL_ERROR_ID}>{settingsErrorText(emailError)}</FieldError>
          )}
          <SubmitButton variant="tinted" pendingLabel="Měním…">
            Změnit e-mail
          </SubmitButton>
        </form>
      </DisclosureRow>

      <DisclosureRow
        key={`heslo-${generation}`}
        title="Heslo"
        meta="Změnit"
        defaultOpen={passwordError !== null}
      >
        <form action={changePasswordAction} className="max-w-[20rem] space-y-4 pt-1 text-ink">
          <Field label="Současné heslo" htmlFor="stavajici-heslo">
            <Input
              id="stavajici-heslo"
              name="stavajici-heslo"
              type="password"
              required
              autoComplete="current-password"
              {...describedByError(passwordError === 'heslo-spatne', PASSWORD_ERROR_ID)}
            />
          </Field>
          <Field
            label="Nové heslo"
            htmlFor="nove-heslo"
            hint="Aspoň 10 znaků. Ostatní zařízení odhlásíme."
          >
            <Input
              id="nove-heslo"
              name="nove-heslo"
              type="password"
              required
              minLength={10}
              autoComplete="new-password"
              {...describedByError(
                passwordError === 'heslo' || passwordError === 'heslo-bezne',
                PASSWORD_ERROR_ID,
              )}
            />
          </Field>
          {passwordError && (
            <FieldError id={PASSWORD_ERROR_ID}>{settingsErrorText(passwordError)}</FieldError>
          )}
          <SubmitButton variant="tinted" pendingLabel="Měním…">
            Změnit heslo
          </SubmitButton>
        </form>
      </DisclosureRow>
    </>
  );
}

/**
 * Smazání účtu za potvrzovacím dialogem. Neúspěch dialog nechá otevřený
 * a řekne to u pole; otevřený zůstane i s hláškou, když se stránka mezitím
 * obnoví ze serveru.
 */
export function DeleteAccountDialog({ result }: { result: ActionResult | null }) {
  const deleteError = errorIn(useActionResult(result), DELETE_ERRORS);
  return (
    <ConfirmDialog
      trigger={
        <Button variant="danger" size="sm">
          Smazat účet…
        </Button>
      }
      title="Smazat účet?"
      description={tidy(
        'Smažeme účet i všechna data — transakce, profil, šifrované klíče k brokerům, upozornění i historii importů. Tohle nejde vrátit.',
      )}
      confirmLabel="Smazat účet"
      pendingLabel="Mažu…"
      action={deleteAccountAction}
      defaultOpen={deleteError !== null}
    >
      <Field label="Heslo" htmlFor="deletePassword">
        <Input
          id="deletePassword"
          name="heslo"
          type="password"
          required
          autoComplete="current-password"
          {...describedByError(deleteError === 'smazani-heslo', DELETE_ERROR_ID)}
        />
      </Field>
      <Field label="Pro potvrzení napiš SMAZAT" htmlFor="potvrzeni">
        {/* L7-06: bez autoCapitalize napíše iOS „Smazat“ */}
        <Input
          id="potvrzeni"
          name="potvrzeni"
          required
          autoComplete="off"
          autoCapitalize="characters"
          {...describedByError(deleteError === 'smazani', DELETE_ERROR_ID)}
        />
      </Field>
      {deleteError && <FieldError id={DELETE_ERROR_ID}>{settingsErrorText(deleteError)}</FieldError>}
    </ConfirmDialog>
  );
}
