'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toDataURL } from 'qrcode';
import { authClient } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import { describedByError, FieldError, Input, Label } from '@/components/ui/field';

/** Cíle `aria-describedby` — každý formulář sekce má vlastní pole i hlášku. */
const DISABLE_ERROR_ID = 'heslo-2fa-off-error';
const VERIFY_ERROR_ID = 'kod-2fa-error';
const ENABLE_ERROR_ID = 'heslo-2fa-error';

interface SetupData {
  totpURI: string;
  backupCodes: string[];
}

export function TwoFactorSection({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [setup, setSetup] = useState<SetupData | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [verified, setVerified] = useState(false);

  useEffect(() => {
    if (setup) {
      toDataURL(setup.totpURI, { margin: 1, width: 192 }).then(setQrDataUrl).catch(() => null);
    }
  }, [setup]);

  async function onEnable(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const password = String(new FormData(event.currentTarget).get('heslo') ?? '');
    const result = await authClient.twoFactor.enable({ password });
    setPending(false);
    if (result.error || !result.data) {
      setError('Nepodařilo se spustit nastavení — zkontroluj heslo.');
      return;
    }
    setSetup(result.data);
  }

  async function onVerify(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const code = String(new FormData(event.currentTarget).get('kod') ?? '');
    const result = await authClient.twoFactor.verifyTotp({ code });
    setPending(false);
    if (result.error) {
      setError('Kód nesedí — zkontroluj aplikaci a zkus to znovu.');
      return;
    }
    setVerified(true);
    router.refresh();
  }

  async function onDisable(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const password = String(new FormData(event.currentTarget).get('heslo') ?? '');
    const result = await authClient.twoFactor.disable({ password });
    setPending(false);
    if (result.error) {
      setError('Vypnutí se nepodařilo — zkontroluj heslo.');
      return;
    }
    router.refresh();
  }

  if (enabled && !setup) {
    return (
      <form onSubmit={onDisable} className="space-y-3">
        <p className="text-sm">
          <span className="font-semibold text-zelena-text">Dvoufaktorové ověření je zapnuté.</span>{' '}
          <span className="text-inkoust-tlumeny">
            Při přihlášení se vyžaduje kód z autentikátoru.
          </span>
        </p>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Label htmlFor="heslo-2fa-off">Heslo (pro vypnutí)</Label>
            <Input
              id="heslo-2fa-off"
              name="heslo"
              type="password"
              required
              autoComplete="current-password"
              {...describedByError(error !== null, DISABLE_ERROR_ID)}
            />
          </div>
          <Button type="submit" variant="danger" size="sm" disabled={pending}>
            {pending ? 'Vypínám…' : 'Vypnout 2FA'}
          </Button>
        </div>
        {error && <FieldError id={DISABLE_ERROR_ID}>{error}</FieldError>}
      </form>
    );
  }

  if (setup && !verified) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-inkoust-tlumeny">
          Naskenuj QR kód v aplikaci (Aegis, Google Authenticator, 1Password…) a potvrď
          prvním kódem. Záložní kódy si ulož — každý funguje jednou, když přijdeš o telefon.
        </p>
        <div className="flex flex-wrap items-start gap-6">
          {qrDataUrl && (
            <img src={qrDataUrl} alt="QR kód pro autentikátor" className="rounded-md border border-linka" />
          )}
          <div className="min-w-0 space-y-2">
            <p className="break-all font-mono text-xs text-inkoust-tlumeny">{setup.totpURI}</p>
            <div className="grid grid-cols-2 gap-x-6 font-mono text-xs">
              {setup.backupCodes.map((code) => (
                <span key={code}>{code}</span>
              ))}
            </div>
          </div>
        </div>
        <form onSubmit={onVerify} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div>
            <Label htmlFor="kod-2fa">První kód z aplikace</Label>
            <Input
              id="kod-2fa"
              name="kod"
              inputMode="numeric"
              pattern="\d{6}"
              required
              className="font-mono tracking-widest"
              {...describedByError(error !== null, VERIFY_ERROR_ID)}
            />
          </div>
          <Button type="submit" disabled={pending}>
            {pending ? 'Ověřuji…' : 'Dokončit zapnutí'}
          </Button>
        </form>
        {error && <FieldError id={VERIFY_ERROR_ID}>{error}</FieldError>}
      </div>
    );
  }

  if (verified) {
    return (
      <p className="text-sm font-semibold text-zelena-text">
        Dvoufaktorové ověření je aktivní. Záložní kódy máš uložené?
      </p>
    );
  }

  return (
    <form onSubmit={onEnable} className="space-y-3">
      <p className="text-sm text-inkoust-tlumeny">
        Druhý faktor (TOTP) chrání tvoje daňová data, i kdyby heslo uniklo. Doporučujeme.
      </p>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <Label htmlFor="heslo-2fa">Heslo (pro potvrzení)</Label>
          <Input
            id="heslo-2fa"
            name="heslo"
            type="password"
            required
            autoComplete="current-password"
            {...describedByError(error !== null, ENABLE_ERROR_ID)}
          />
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? 'Připravuji…' : 'Zapnout 2FA'}
        </Button>
      </div>
      {error && <FieldError id={ENABLE_ERROR_ID}>{error}</FieldError>}
    </form>
  );
}
