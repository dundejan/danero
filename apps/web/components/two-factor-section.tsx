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
import { Disclosure } from '@/components/ui/disclosure';
import { describedByError, Field, Input } from '@/components/ui/field';
import { StatusLabel } from '@/components/ui/status';

/** Cíle `aria-describedby` — každý formulář sekce má vlastní pole i hlášku. */
const DISABLE_ERROR_ID = 'heslo-2fa-off-error';
const VERIFY_ERROR_ID = 'kod-2fa-error';
const ENABLE_ERROR_ID = 'heslo-2fa-error';

/** Pole a tlačítko vedle sebe; v úzkém okně pod sebou. */
const FIELD_WITH_ACTION = 'flex flex-col gap-3 @lg:flex-row @lg:items-start';
/** Tlačítko vedle pole stojí ve výšce pole, ne popisku nad ním. */
const BESIDE_FIELD = '@lg:mt-[1.875rem]';

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
    <div className="space-y-3">
      <div className="grid max-w-[18rem] grid-cols-2 gap-x-6 gap-y-1.5 rounded-lg bg-surface px-4 py-3 tabular-nums text-ink">
        {codes.map((code) => (
          <span key={code}>{code}</span>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="secondary" size="sm" onClick={() => void onCopy()}>
          Zkopírovat
        </Button>
        <p role="status" className="type-footnote text-ink-muted">
          {copyState === 'copied' && 'Zkopírováno — vlož si je do správce hesel nebo do poznámek.'}
          {copyState === 'failed' &&
            'Zkopírovat se nepovedlo — označ kódy myší a zkopíruj je ručně.'}
        </p>
      </div>
    </div>
  );
}

/** Krok zapínání: číslovaný titulek a pod ním to, co se v kroku dělá. */
function Step({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <li className="space-y-3">
      <p className="font-medium text-ink">{title}</p>
      {children}
    </li>
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
      <form method="post" onSubmit={onDisable} className="space-y-4">
        <p className="text-pretty">
          Při přihlášení se vyžaduje kód z autentikátoru. Záložní kódy už znovu neukážeme — když
          je nemáš uložené, ověření vypni a zapni znovu a vzniknou nové.
        </p>
        <div className={FIELD_WITH_ACTION}>
          <Field
            label="Heslo (pro vypnutí)"
            htmlFor="heslo-2fa-off"
            error={error}
            errorId={DISABLE_ERROR_ID}
            className="max-w-[20rem] flex-1 text-ink"
          >
            <Input
              id="heslo-2fa-off"
              name="heslo"
              type="password"
              required
              autoComplete="current-password"
              {...describedByError(error !== null, DISABLE_ERROR_ID)}
            />
          </Field>
          <Button type="submit" variant="danger" disabled={pending} className={BESIDE_FIELD}>
            {pending ? 'Vypínám…' : 'Vypnout ověření'}
          </Button>
        </div>
      </form>
    );
  }

  if (view.kind === 'setup') {
    return (
      // Pořadí kroků je záměr (L6b-03): kódy se ukládají DŘÍV, než se zapnutí
      // potvrdí — kdo postupoval „naskenuj → potvrď“, o ně dřív přišel.
      <ol className="space-y-7">
        <Step title="1. Naskenuj QR kód v aplikaci">
          <p className="text-pretty">Třeba Aegis, Google Authenticator nebo 1Password.</p>
          {qrDataUrl && (
            // QR kód je vždy tmavý na bílé — v tmavém režimu potřebuje vlastní podklad
            <img
              src={qrDataUrl}
              alt="QR kód pro autentikátor"
              width={192}
              height={192}
              className="rounded-lg bg-white p-2"
            />
          )}
          <Disclosure summary="Nejde naskenovat?">
            <div className="space-y-3">
              {view.manualKey && (
                <div className="space-y-1">
                  <p>Zadej do aplikace ručně tenhle klíč:</p>
                  <code className="type-callout block select-all break-all tabular-nums text-ink">
                    {view.manualKey}
                  </code>
                </div>
              )}
              <div className="space-y-1">
                <p>Celá adresa pro aplikace, které ji umějí vložit:</p>
                <p className="break-all tabular-nums">{view.totpURI}</p>
              </div>
            </div>
          </Disclosure>
        </Step>
        <Step title="2. Ulož si záložní kódy">
          <p className="text-pretty">Každý funguje jednou — pro případ, že přijdeš o telefon.</p>
          <BackupCodes codes={view.backupCodes} />
        </Step>
        <Step title="3. Potvrď prvním kódem z aplikace">
          <form method="post" onSubmit={onVerify} className={FIELD_WITH_ACTION}>
            <Field
              label="První kód z aplikace"
              htmlFor="kod-2fa"
              error={error}
              errorId={VERIFY_ERROR_ID}
              className="max-w-[12rem] flex-1 text-ink"
            >
              <Input
                id="kod-2fa"
                name="kod"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern={TOTP_CODE_PATTERN}
                title={TOTP_CODE_TITLE}
                required
                className="tabular-nums tracking-widest"
                {...describedByError(error !== null, VERIFY_ERROR_ID)}
              />
            </Field>
            <Button type="submit" disabled={pending} className={BESIDE_FIELD}>
              {pending ? 'Ověřuji…' : 'Dokončit zapnutí'}
            </Button>
          </form>
        </Step>
      </ol>
    );
  }

  if (view.kind === 'confirmed') {
    return (
      <div className="space-y-3">
        <StatusLabel tone="success">Dvoufaktorové ověření je aktivní.</StatusLabel>
        <p className="text-pretty">
          Záložní kódy tu zůstanou, dokud z téhle stránky neodejdeš — potom už je znovu neukážeme.
        </p>
        <BackupCodes codes={view.backupCodes} />
      </div>
    );
  }

  return (
    <form method="post" onSubmit={onEnable} className="space-y-4">
      <p className="text-pretty">
        Při přihlášení navíc zadáš kód z aplikace v telefonu. Chrání tvoje daňová data, i kdyby
        heslo uniklo.
      </p>
      <div className={FIELD_WITH_ACTION}>
        <Field
          label="Heslo (pro potvrzení)"
          htmlFor="heslo-2fa"
          error={error}
          errorId={ENABLE_ERROR_ID}
          className="max-w-[20rem] flex-1 text-ink"
        >
          <Input
            id="heslo-2fa"
            name="heslo"
            type="password"
            required
            autoComplete="current-password"
            {...describedByError(error !== null, ENABLE_ERROR_ID)}
          />
        </Field>
        <Button type="submit" variant="tinted" disabled={pending} className={BESIDE_FIELD}>
          {pending ? 'Připravuji…' : 'Zapnout ověření'}
        </Button>
      </div>
    </form>
  );
}
