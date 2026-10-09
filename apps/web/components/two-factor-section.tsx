'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toDataURL } from 'qrcode';
import { authClient } from '@/lib/auth-client';
import { normalizeTotpCode, TOTP_CODE_PATTERN, TOTP_CODE_TITLE } from '@/lib/auth-errors';
import { CONNECTION_ERROR_MESSAGE, settleAuthRequest } from '@/lib/auth-request';
import {
  backupCodesClipboardText,
  twoFactorView,
  type TwoFactorSetup,
} from '@/lib/two-factor-view';
import { Button } from '@/components/ui/button';
import { describedByError, FieldError, Input, Label } from '@/components/ui/field';

/** Cíle `aria-describedby` — každý formulář sekce má vlastní pole i hlášku. */
const DISABLE_ERROR_ID = 'heslo-2fa-off-error';
const VERIFY_ERROR_ID = 'kod-2fa-error';
const ENABLE_ERROR_ID = 'heslo-2fa-error';

/**
 * Záložní kódy s tlačítkem na zkopírování — stejný blok před potvrzením i po něm.
 *
 * Kódy zůstávají v prvcích `span`: E2E (`e2e/dvoufaktor.spec.ts`) je sbírá přes
 * `locator('span')`. Schránka nemusí být k dispozici (stránka mimo HTTPS, zákaz
 * v prohlížeči) — pak to karta řekne a kódy jdou označit ručně.
 */
function BackupCodes({ codes }: { codes: string[] }) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(backupCodesClipboardText(codes));
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold">Záložní kódy</p>
      <div className="grid max-w-xs grid-cols-2 gap-x-6 gap-y-1 font-mono text-sm">
        {codes.map((code) => (
          <span key={code}>{code}</span>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="secondary" size="sm" onClick={() => void onCopy()}>
          Zkopírovat
        </Button>
        <p role="status" className="text-xs text-inkoust-tlumeny">
          {copyState === 'copied' && 'Zkopírováno — vlož si je do správce hesel nebo do poznámek.'}
          {copyState === 'failed' &&
            'Zkopírovat se nepovedlo — označ kódy myší a zkopíruj je ručně.'}
        </p>
      </div>
    </div>
  );
}

export function TwoFactorSection({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [setup, setSetup] = useState<TwoFactorSetup | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [verified, setVerified] = useState(false);

  useEffect(() => {
    if (setup) {
      toDataURL(setup.totpURI, { margin: 1, width: 192 }).then(setQrDataUrl).catch(() => null);
    }
  }, [setup]);

  /**
   * Společná kostra tří formulářů sekce: zamkne tlačítko, pošle požadavek
   * a tlačítko VŽDY zase odemkne.
   *
   * L12-03: handlery dřív na klienta jen čekaly. Při výpadku sítě slib skončil
   * odmítnutím, `setPending(false)` za ním se neprovedlo a tlačítko zůstalo
   * v „Připravuji…“ bez jediné hlášky. U potvrzení prvním kódem to navíc nutilo
   * načíst stránku znovu uprostřed nastavování — a tím vydat nové tajemství,
   * takže už naskenovaný záznam v autentikátoru přestal platit.
   */
  async function submit<T>(request: () => Promise<T>, onResponse: (result: T) => void) {
    setPending(true);
    setError(null);
    try {
      const outcome = await settleAuthRequest(request);
      if (!outcome.connected) {
        setError(CONNECTION_ERROR_MESSAGE);
        return;
      }
      onResponse(outcome.result);
    } finally {
      setPending(false);
    }
  }

  function onEnable(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = String(new FormData(event.currentTarget).get('heslo') ?? '');
    void submit(
      () => authClient.twoFactor.enable({ password }),
      (result) => {
        if (result.error || !result.data) {
          setError('Nepodařilo se spustit nastavení — zkontroluj heslo.');
          return;
        }
        setSetup(result.data);
      },
    );
  }

  function onVerify(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const rawCode = String(new FormData(event.currentTarget).get('kod') ?? '');
    void submit(
      // L6b-06: autentikátor kód ukazuje jako „123 456“ — server chce jen číslice
      () => authClient.twoFactor.verifyTotp({ code: normalizeTotpCode(rawCode) }),
      (result) => {
        if (result.error) {
          setError(
            result.error.code === 'TOTP_CODE_ALREADY_USED'
              ? 'Tenhle kód už byl použitý. Počkej na další a zadej ten.'
              : 'Kód nesedí — zkontroluj aplikaci a zkus to znovu.',
          );
          return;
        }
        setVerified(true);
        router.refresh();
      },
    );
  }

  function onDisable(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = String(new FormData(event.currentTarget).get('heslo') ?? '');
    void submit(
      () => authClient.twoFactor.disable({ password }),
      (result) => {
        if (result.error) {
          setError('Vypnutí se nepodařilo — zkontroluj heslo.');
          return;
        }
        router.refresh();
      },
    );
  }

  // L6b-03: co se ukáže, rozhoduje jedna čistá funkce (test/two-factor-view.test.ts)
  const view = twoFactorView({ enabled, setup, verified });

  if (view.kind === 'enabled') {
    return (
      <form onSubmit={onDisable} className="space-y-3">
        <p className="text-sm">
          <span className="font-semibold text-zelena-text">Dvoufaktorové ověření je zapnuté.</span>{' '}
          <span className="text-inkoust-tlumeny">
            Při přihlášení se vyžaduje kód z autentikátoru.
          </span>
        </p>
        <p className="text-sm text-inkoust-tlumeny">
          Záložní kódy už znovu neukážeme. Když je nemáš uložené, dvoufaktorové ověření vypni a
          zapni znovu — vzniknou nové a v aplikaci si naskenuješ nový QR kód.
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
          <Button type="submit" variant="danger" disabled={pending}>
            {pending ? 'Vypínám…' : 'Vypnout 2FA'}
          </Button>
        </div>
        {error && <FieldError id={DISABLE_ERROR_ID}>{error}</FieldError>}
      </form>
    );
  }

  if (view.kind === 'setup') {
    return (
      <div className="space-y-4">
        <p className="text-sm text-inkoust-tlumeny">
          Naskenuj QR kód v aplikaci (Aegis, Google Authenticator, 1Password…) a ulož si záložní
          kódy — každý funguje jednou, když přijdeš o telefon. Teprve pak zapnutí potvrď prvním
          kódem z aplikace.
        </p>
        <div className="flex flex-wrap items-start gap-6">
          {qrDataUrl && (
            <img src={qrDataUrl} alt="QR kód pro autentikátor" className="rounded-md border border-linka" />
          )}
          <div className="min-w-0 space-y-3">
            {view.manualKey && (
              <div className="space-y-1">
                <p className="text-xs text-inkoust-tlumeny">
                  Nejde QR kód naskenovat? Zadej do aplikace ručně tenhle klíč:
                </p>
                <code className="block select-all break-all font-mono text-sm">
                  {view.manualKey}
                </code>
              </div>
            )}
            <div className="space-y-1">
              <p className="text-xs text-inkoust-tlumeny">
                Celá adresa pro aplikace, které ji umějí vložit:
              </p>
              <p className="break-all font-mono text-xs text-inkoust-tlumeny">{view.totpURI}</p>
            </div>
          </div>
        </div>
        <BackupCodes codes={view.backupCodes} />
        <form onSubmit={onVerify} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div>
            <Label htmlFor="kod-2fa">První kód z aplikace</Label>
            <Input
              id="kod-2fa"
              name="kod"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern={TOTP_CODE_PATTERN}
              title={TOTP_CODE_TITLE}
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

  if (view.kind === 'confirmed') {
    return (
      <div className="space-y-4">
        <p className="text-sm font-semibold text-zelena-text">Dvoufaktorové ověření je aktivní.</p>
        <p className="text-sm text-inkoust-tlumeny">
          Záložní kódy tu zůstanou, dokud z téhle stránky neodejdeš — potom už je znovu neukážeme.
          Jestli je ještě nemáš uložené, udělej to teď.
        </p>
        <BackupCodes codes={view.backupCodes} />
      </div>
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
