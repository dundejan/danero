'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { authClient } from '@/lib/auth-client';
import {
  type AuthErrorMessage,
  credentialsErrorMessage,
  normalizeBackupCode,
  normalizeTotpCode,
  type SecondFactorFailure,
  secondFactorErrorMessage,
  TOTP_CODE_PATTERN,
  TOTP_CODE_TITLE,
} from '@/lib/auth-errors';
import { FormPage } from '@/components/form-page';
import { Button, buttonVariants } from '@/components/ui/button';
import { describedByError, Field, FieldError, Input } from '@/components/ui/field';
import { TextLink } from '@/components/ui/link';

/** Cíle `aria-describedby` u polí, kterých se chyba týká. */
const TOTP_ERROR_ID = 'kod-error';
const BACKUP_ERROR_ID = 'zalozni-kod-error';
const CREDENTIALS_ERROR_ID = 'prihlaseni-error';
const PASSWORD_HINT_ID = 'heslo-napoveda';

const MIN_PASSWORD_LENGTH = 10;

/** Textové tlačítko pod formulářem — vypadá jako odkaz, protože jím je (jiná cesta týmž krokem). */
const LINK_BUTTON =
  'inline-flex items-center text-left font-medium text-accent-text underline underline-offset-2 active:opacity-60 pointer-coarse:min-h-11';

/**
 * Přihlášení a registrace. Každý krok je vlastní klidná obrazovka s jedním
 * titulkem, jedním formulářem a cestou zpět: e-mail a heslo → kód
 * z autentikátoru → (záložní kód), případně „potvrď svůj e-mail“. Titulek se
 * mění s krokem, aby bylo pořád jasné, kde člověk je.
 */
export function AuthForm({ mode }: { mode: 'prihlaseni' | 'registrace' }) {
  const router = useRouter();
  const [error, setError] = useState<AuthErrorMessage | null>(null);
  const [unverified, setUnverified] = useState<{ email: string; resent: boolean } | null>(null);
  const [pending, setPending] = useState(false);
  const [totpStep, setTotpStep] = useState(false);
  // K2-01: druhá větev téhož kroku — kdo přišel o telefon, opíše záložní kód.
  // Bez ní byly vypsané kódy k ničemu: server je přijímá, formulář je neuměl
  // odeslat (do pole na šest číslic se `xxxxx-xxxxx` ani nevejde).
  const [backupStep, setBackupStep] = useState(false);
  // Krátké heslo ohlásíme hned po opuštění pole, ne až po odeslání — jen
  // u registrace; přihlášení tvar hesla nehlídá vůbec.
  const [passwordTooShort, setPasswordTooShort] = useState(false);

  const finish = () => {
    // registrace nevytváří session — účet čeká na potvrzení e-mailu, teprve
    // odkaz z něj přihlásí a pustí do onboarding průvodce (G9a)
    router.push('/prehled');
    router.refresh();
  };

  const backToCredentials = () => {
    setTotpStep(false);
    setBackupStep(false);
    setUnverified(null);
    setError(null);
  };

  // Vyčerpaná nebo propadlá výzva už nepřijme žádný kód (L21-02): formulář se
  // vrací na e-mail a heslo a hlášku ukáže tam, místo aby nechal uživatele
  // opisovat kódy do kroku, ze kterého nevede cesta dál.
  const failSecondFactor = (failure: SecondFactorFailure) => {
    if (failure.restart) {
      setTotpStep(false);
      setBackupStep(false);
    }
    setError({ text: failure.text });
  };

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    try {
      if (backupStep) {
        const result = await authClient.twoFactor.verifyBackupCode({
          code: normalizeBackupCode(String(form.get('zalozni-kod') ?? '')),
        });
        if (result.error) {
          failSecondFactor(secondFactorErrorMessage('backup', result.error));
          return;
        }
        finish();
        return;
      }

      if (totpStep) {
        const result = await authClient.twoFactor.verifyTotp({
          code: normalizeTotpCode(String(form.get('kod') ?? '')),
        });
        if (result.error) {
          failSecondFactor(secondFactorErrorMessage('totp', result.error));
          return;
        }
        finish();
        return;
      }

      const email = String(form.get('email') ?? '');
      const password = String(form.get('heslo') ?? '');

      // callbackURL u registrace = kam vede odkaz z ověřovacího e-mailu; bez něj
      // by Better Auth poslal ověřeného uživatele na landing místo do onboardingu.
      // U přihlášení ho NEposílat: klient by na něj skočil i po úspěšném loginu
      // a normální přihlášení by končilo v onboardingu místo na přehledu.
      // Cíl je /overeni-emailu/hotovo, ne rozcestník: když odkaz spotřebuje
      // skener firemní pošty, uživatel dorazí bez relace a musí číst pravdu
      // („adresu máme potvrzenou, přihlas se"), ne „poslali jsme ti odkaz" (K8-05).
      const result =
        mode === 'registrace'
          ? await authClient.signUp.email({
              email,
              password,
              name: String(form.get('jmeno') ?? '') || email.split('@')[0]!,
              callbackURL: '/overeni-emailu/hotovo',
            })
          : await authClient.signIn.email({ email, password });

      if (result.error) {
        // Nepotvrzený účet — pošli nový odkaz. Schválně jen podle kódu: na 403
        // končí i neshoda originu (BETTER_AUTH_URL vs. doména) a tu by tahle
        // hláška zamaskovala.
        if (result.error.code === 'EMAIL_NOT_VERIFIED') {
          const resend = await authClient.sendVerificationEmail({
            email,
            callbackURL: '/overeni-emailu/hotovo',
          });
          setUnverified({ email, resent: !resend.error });
          return;
        }
        // Moc pokusů (429), chyba serveru (5xx) a cizí adresa (INVALID_ORIGIN)
        // nejsou vada e-mailu ani hesla — každá má vlastní větu (L15-01, L15-02).
        // Adresa pro odkaz jde jen z výslovného nastavení (při buildu se sem
        // zapeče), ne ze SITE_URL: to padá na hostovanou službu a vlastní
        // instance by návštěvníka poslala na cizí web (L10-03).
        setError(
          credentialsErrorMessage(mode, result.error, {
            siteUrl: process.env.NEXT_PUBLIC_APP_URL,
            currentOrigin: window.location.origin,
          }),
        );
        return;
      }
      if (mode === 'registrace') {
        router.push(`/overeni-emailu?email=${encodeURIComponent(email)}`);
        return;
      }
      if (result.data && 'twoFactorRedirect' in result.data && result.data.twoFactorRedirect) {
        setTotpStep(true);
        return;
      }
      finish();
    } catch {
      // Síť selhala (offline, spadlý server, blokovaný požadavek). Bez tohohle
      // bloku promise rejectla, `setPending(false)` se neprovedlo a formulář
      // zůstal zamčený NAVŽDY, aniž by cokoli řekl — jediné východisko byl
      // reload stránky (nález H2-01).
      setError({ text: 'Nepodařilo se spojit se serverem. Zkontroluj připojení a zkus to znovu.' });
    } finally {
      setPending(false);
    }
  }

  const backLink = (
    <button type="button" onClick={backToCredentials} className={LINK_BUTTON}>
      Zpátky na přihlášení
    </button>
  );

  if (unverified) {
    return (
      <FormPage
        title="Potvrď svůj e-mail"
        lede={
          <>
            Účet ještě není potvrzený.{' '}
            {unverified.resent ? (
              <>
                Poslali jsme ti na <span className="break-all text-ink">{unverified.email}</span>{' '}
                nový odkaz.
              </>
            ) : (
              'Potvrď adresu odkazem, který ti přišel po registraci.'
            )}
          </>
        }
        footer={backLink}
      >
        <Link
          href={`/overeni-emailu?email=${encodeURIComponent(unverified.email)}`}
          className={buttonVariants({ variant: 'secondary', className: 'w-full' })}
        >
          Nepřišel? Poslat znovu
        </Link>
      </FormPage>
    );
  }

  if (backupStep) {
    return (
      <FormPage
        title="Záložní kód"
        footer={
          <div className="flex flex-col items-start gap-1">
            <button
              type="button"
              onClick={() => {
                setBackupStep(false);
                setError(null);
              }}
              className={LINK_BUTTON}
            >
              Mám telefon po ruce — zadat kód z autentikátoru
            </button>
            {backLink}
          </div>
        }
      >
        <form onSubmit={onSubmit} className="space-y-5">
          <Field
            label="Záložní kód"
            htmlFor="zalozni-kod"
            hint={error ? undefined : 'Uložil sis je při zapínání ověření. Každý funguje jen jednou.'}
            error={error?.text}
            errorId={BACKUP_ERROR_ID}
          >
            <Input
              id="zalozni-kod"
              name="zalozni-kod"
              autoComplete="one-time-code"
              // kódy rozlišují velká a malá písmena — telefon nesmí první zvětšit sám
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              required
              autoFocus
              placeholder="xxxxx-xxxxx"
              className="tabular-nums tracking-widest"
              {...describedByError(error !== null, BACKUP_ERROR_ID)}
            />
          </Field>
          <Button type="submit" disabled={pending} className="w-full">
            {pending ? 'Ověřuji…' : 'Přihlásit záložním kódem'}
          </Button>
        </form>
      </FormPage>
    );
  }

  if (totpStep) {
    return (
      <FormPage
        title="Ověřovací kód"
        footer={
          <div className="flex flex-col items-start gap-1">
            <button
              type="button"
              onClick={() => {
                setBackupStep(true);
                setError(null);
              }}
              className={LINK_BUTTON}
            >
              Nemáš telefon? Zadej záložní kód
            </button>
            {backLink}
          </div>
        }
      >
        <form onSubmit={onSubmit} className="space-y-5">
          <Field
            label="Kód z autentikátoru"
            htmlFor="kod"
            error={error?.text}
            errorId={TOTP_ERROR_ID}
          >
            <Input
              id="kod"
              name="kod"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern={TOTP_CODE_PATTERN}
              title={TOTP_CODE_TITLE}
              required
              autoFocus
              className="tabular-nums tracking-widest"
              {...describedByError(error !== null, TOTP_ERROR_ID)}
            />
          </Field>
          <Button type="submit" disabled={pending} className="w-full">
            {pending ? 'Ověřuji…' : 'Ověřit kód'}
          </Button>
        </form>
      </FormPage>
    );
  }

  const signUp = mode === 'registrace';

  return (
    <FormPage
      title={signUp ? 'Registrace' : 'Přihlášení'}
      lede={
        signUp ? (
          <>
            Už máš účet? <TextLink href="/prihlaseni">Přihlas se</TextLink>
          </>
        ) : (
          <>
            Nemáš účet? <TextLink href="/registrace">Zaregistruj se</TextLink>
          </>
        )
      }
      footer={
        signUp ? (
          // B-1 právního auditu: podmínky se do smlouvy včleňují odkazem při
          // registraci (§ 1751 OZ) a GDPR informace patří ke sběru údajů (čl. 13)
          <p className="type-footnote text-pretty">
            Vytvořením účtu souhlasíš s <TextLink href="/podminky">podmínkami užití</TextLink> a
            potvrzuješ, že víš, <TextLink href="/soukromi">jak nakládáme s tvými daty</TextLink>.
          </p>
        ) : (
          <TextLink href="/zapomenute-heslo">Zapomněl jsi heslo?</TextLink>
        )
      }
    >
      <form onSubmit={onSubmit} className="space-y-5">
        {signUp && (
          <Field
            label={
              <>
                Jméno <span className="font-normal text-ink-muted">· nepovinné</span>
              </>
            }
            htmlFor="jmeno"
          >
            <Input id="jmeno" name="jmeno" autoComplete="name" />
          </Field>
        )}
        <Field label="E-mail" htmlFor="email">
          <Input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            // chyba přihlášení je společná pro e-mail i heslo (server záměrně
            // neprozrazuje, které z nich nesedí) — odkazujeme ji z obou polí
            {...describedByError(error !== null, CREDENTIALS_ERROR_ID)}
          />
        </Field>
        <Field
          label="Heslo"
          htmlFor="heslo"
          hint={
            signUp && !passwordTooShort ? (
              <span id={PASSWORD_HINT_ID}>Aspoň {MIN_PASSWORD_LENGTH} znaků.</span>
            ) : undefined
          }
          error={passwordTooShort ? `Heslo musí mít aspoň ${MIN_PASSWORD_LENGTH} znaků.` : undefined}
          errorId={PASSWORD_HINT_ID}
        >
          <Input
            id="heslo"
            name="heslo"
            type="password"
            // validace délky patří jen k registraci — při loginu uživatel zadává
            // heslo, které zná; hlídat mu jeho tvar nedává smysl (chybné heslo
            // stejně odmítne server jednotnou hláškou)
            {...(signUp
              ? {
                  required: true,
                  minLength: MIN_PASSWORD_LENGTH,
                  onBlur: (event: React.FocusEvent<HTMLInputElement>) => {
                    const { length } = event.currentTarget.value;
                    setPasswordTooShort(length > 0 && length < MIN_PASSWORD_LENGTH);
                  },
                  onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
                    if (passwordTooShort && event.currentTarget.value.length >= MIN_PASSWORD_LENGTH) {
                      setPasswordTooShort(false);
                    }
                  },
                }
              : {})}
            autoComplete={signUp ? 'new-password' : 'current-password'}
            aria-invalid={error !== null || passwordTooShort ? true : undefined}
            aria-describedby={
              [error !== null ? CREDENTIALS_ERROR_ID : null, signUp ? PASSWORD_HINT_ID : null]
                .filter(Boolean)
                .join(' ') || undefined
            }
          />
        </Field>
        {error && (
          <FieldError id={CREDENTIALS_ERROR_ID}>
            {error.text}
            {error.link && (
              <>
                {' '}
                <a href={error.link.href} className="font-medium underline underline-offset-2">
                  {error.link.label}
                </a>
              </>
            )}
          </FieldError>
        )}
        <Button type="submit" disabled={pending} className="w-full">
          {pending
            ? signUp
              ? 'Vytvářím účet…'
              : 'Přihlašuji…'
            : signUp
              ? 'Vytvořit účet'
              : 'Přihlásit se'}
        </Button>
      </form>
    </FormPage>
  );
}
