'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { authClient } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import { describedByError, FieldError, Input, Label } from '@/components/ui/field';

/** Cíle `aria-describedby` u polí, kterých se chyba týká. */
const TOTP_ERROR_ID = 'kod-error';
const BACKUP_ERROR_ID = 'zalozni-kod-error';
const CREDENTIALS_ERROR_ID = 'prihlaseni-error';

export function AuthForm({ mode }: { mode: 'prihlaseni' | 'registrace' }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [unverified, setUnverified] = useState<{ email: string; resent: boolean } | null>(null);
  const [pending, setPending] = useState(false);
  const [totpStep, setTotpStep] = useState(false);
  // K2-01: druhá větev téhož kroku — kdo přišel o telefon, opíše záložní kód.
  // Bez ní byly vypsané kódy k ničemu: server je přijímá, formulář je neuměl
  // odeslat (do pole na šest číslic se `xxxxx-xxxxx` ani nevejde).
  const [backupStep, setBackupStep] = useState(false);

  const finish = () => {
    // registrace nevytváří session — účet čeká na potvrzení e-mailu, teprve
    // odkaz z něj přihlásí a pustí do onboarding průvodce (G9a)
    router.push('/prehled');
    router.refresh();
  };

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    try {

      if (backupStep) {
        const result = await authClient.twoFactor.verifyBackupCode({
          code: String(form.get('zalozni-kod') ?? '').trim(),
        });
        if (result.error) {
          setError('Záložní kód nesedí. Zkontroluj, že jsi ho opsal celý včetně pomlčky.');
          return;
        }
        finish();
        return;
      }

      if (totpStep) {
        const result = await authClient.twoFactor.verifyTotp({
          code: String(form.get('kod') ?? ''),
        });
        if (result.error) {
          // Použitý kód se podruhé neuzná (D-01). Bez rozlišení by uživatel
          // opisoval týž kód znovu a zase neuspěl — musí počkat na další.
          setError(
            result.error.code === 'TOTP_CODE_ALREADY_USED'
              ? 'Tenhle kód už byl použitý. Počkej v aplikaci autentikátoru na další a zadej ten.'
              : 'Kód nesedí. Zkontroluj aplikaci autentikátoru a zkus to znovu.',
          );
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
        setError(
          mode === 'registrace'
            ? 'Registrace se nepodařila. Zkontroluj e-mail a zvol heslo o délce aspoň 10 znaků.'
            : 'Přihlášení se nepodařilo. Zkontroluj e-mail a heslo.',
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
      setError('Nepodařilo se spojit se serverem. Zkontroluj připojení a zkus to znovu.');
    } finally {
      setPending(false);
    }
  }

  if (unverified) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-linka bg-plocha p-4 text-sm">
          <p className="font-medium">Účet ještě není potvrzený.</p>
          <p className="mt-2 text-inkoust-tlumeny">
            {unverified.resent
              ? `Poslali jsme ti na ${unverified.email} nový ověřovací odkaz. Klikni na něj a jsi uvnitř.`
              : 'Potvrď adresu odkazem, který ti přišel po registraci. Nový si můžeš nechat poslat níž.'}
          </p>
        </div>
        <Link
          href={`/overeni-emailu?email=${encodeURIComponent(unverified.email)}`}
          className="text-sm font-medium text-ruzova-text underline underline-offset-2"
        >
          Nepřišel? Poslat znovu
        </Link>
      </div>
    );
  }

  if (backupStep) {
    return (
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <Label htmlFor="zalozni-kod">Záložní kód</Label>
          <Input
            id="zalozni-kod"
            name="zalozni-kod"
            autoComplete="one-time-code"
            required
            autoFocus
            placeholder="xxxxx-xxxxx"
            className="font-mono tracking-widest"
            {...describedByError(error !== null, BACKUP_ERROR_ID)}
          />
          <p className="mt-2 text-xs text-inkoust-tlumeny">
            Kódy sis uložil při zapínání dvoufaktorového ověření. Každý funguje jen jednou.
          </p>
        </div>
        {error && <FieldError id={BACKUP_ERROR_ID}>{error}</FieldError>}
        <Button type="submit" disabled={pending} className="w-full">
          {pending ? 'Ověřuji…' : 'Přihlásit záložním kódem'}
        </Button>
        <button
          type="button"
          onClick={() => {
            setBackupStep(false);
            setError(null);
          }}
          className="text-sm font-medium text-ruzova-text underline underline-offset-2"
        >
          Mám telefon po ruce — zadat kód z autentikátoru
        </button>
      </form>
    );
  }

  if (totpStep) {
    return (
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <Label htmlFor="kod">Kód z autentikátoru</Label>
          <Input
            id="kod"
            name="kod"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            required
            autoFocus
            className="font-mono tracking-widest"
            {...describedByError(error !== null, TOTP_ERROR_ID)}
          />
        </div>
        {error && <FieldError id={TOTP_ERROR_ID}>{error}</FieldError>}
        <Button type="submit" disabled={pending} className="w-full">
          {pending ? 'Ověřuji…' : 'Ověřit kód'}
        </Button>
        <button
          type="button"
          onClick={() => {
            setBackupStep(true);
            setError(null);
          }}
          className="text-sm font-medium text-ruzova-text underline underline-offset-2"
        >
          Nemáš telefon? Zadej záložní kód
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {mode === 'registrace' && (
        <div>
          <Label htmlFor="jmeno">
            Jméno{' '}
            <span className="font-normal text-inkoust-tlumeny">
              (nepovinné — jak ti máme říkat)
            </span>
          </Label>
          <Input id="jmeno" name="jmeno" autoComplete="name" />
        </div>
      )}
      <div>
        <Label htmlFor="email">E-mail</Label>
        <Input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          // chyba přihlášení je společná pro e-mail i heslo (server záměrně
          // neprozrazuje, které z nich nesedí) — odkazujeme ji z obou polí
          {...describedByError(error !== null, CREDENTIALS_ERROR_ID)}
        />
      </div>
      <div>
        <Label htmlFor="heslo">{mode === 'registrace' ? 'Heslo (min. 10 znaků)' : 'Heslo'}</Label>
        <Input
          id="heslo"
          name="heslo"
          type="password"
          // validace délky patří jen k registraci — při loginu uživatel zadává
          // heslo, které zná; hlídat mu jeho tvar nedává smysl (chybné heslo
          // stejně odmítne server jednotnou hláškou)
          {...(mode === 'registrace' ? { required: true, minLength: 10 } : {})}
          autoComplete={mode === 'registrace' ? 'new-password' : 'current-password'}
          {...describedByError(error !== null, CREDENTIALS_ERROR_ID)}
        />
      </div>
      {error && <FieldError id={CREDENTIALS_ERROR_ID}>{error}</FieldError>}
      <Button type="submit" disabled={pending} className="w-full">
        {pending
          ? mode === 'registrace'
            ? 'Vytvářím účet…'
            : 'Přihlašuji…'
          : mode === 'registrace'
            ? 'Vytvořit účet'
            : 'Přihlásit se'}
      </Button>
    </form>
  );
}
