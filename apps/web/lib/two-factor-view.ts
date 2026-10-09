/**
 * Co má karta dvoufaktorového ověření v kterém stavu ukázat.
 *
 * L6b-03: rozhodovaly o tom tři podmínky přímo v komponentě a ta po potvrzení
 * prvního kódu přestala vykreslovat záložní kódy — zbyla jen otázka „Záložní
 * kódy máš uložené?“ nad prázdnou kartou. Kódy přitom jinde vidět nejsou: po
 * odchodu ze stránky je nezná ani klient a server je znovu nevydá. Rozhodnutí
 * je proto čistá funkce, kterou jde otestovat bez prohlížeče.
 */

/** Co vrátí server při spuštění nastavení: adresa pro autentikátor a záložní kódy. */
export interface TwoFactorSetup {
  totpURI: string;
  backupCodes: string[];
}

export interface TwoFactorState {
  /** Stav účtu ze serveru (po `router.refresh()` se překlopí na `true`). */
  enabled: boolean;
  /** Rozdělané nastavení — žije jen v paměti stránky, do odchodu z ní. */
  setup: TwoFactorSetup | null;
  /** První kód z aplikace server právě přijal. */
  verified: boolean;
}

export type TwoFactorView =
  /** Vypnuto: formulář, který nastavení spustí. */
  | { kind: 'offer' }
  /** Rozdělané nastavení: QR kód, klíč pro ruční zadání, záložní kódy, pole na první kód. */
  | { kind: 'setup'; totpURI: string; manualKey: string | null; backupCodes: string[] }
  /** Právě zapnuto: záložní kódy zůstávají vidět, dokud uživatel ze stránky neodejde. */
  | { kind: 'confirmed'; backupCodes: string[] }
  /** Zapnuto z dřívějška: kódy už nejsou odkud vzít, zbývá vypnutí. */
  | { kind: 'enabled' };

export function twoFactorView({ enabled, setup, verified }: TwoFactorState): TwoFactorView {
  if (setup) {
    // `enabled` tu záměrně nerozhoduje: po potvrzení ho obnovení dat ze serveru
    // překlopí, a kódy by v tu chvíli zmizely podruhé
    return verified
      ? { kind: 'confirmed', backupCodes: setup.backupCodes }
      : {
          kind: 'setup',
          totpURI: setup.totpURI,
          manualKey: manualEntryKey(setup.totpURI),
          backupCodes: setup.backupCodes,
        };
  }
  return enabled ? { kind: 'enabled' } : { kind: 'offer' };
}

/**
 * Tajný klíč z adresy `otpauth://` — to, co se do autentikátoru opisuje ručně,
 * když nejde naskenovat QR kód. Celá adresa se opsat nedá a aplikace ji do pole
 * „klíč“ nepřijme. Když v adrese klíč není, vrací `null` a karta ukáže jen ji.
 */
export function manualEntryKey(totpURI: string): string | null {
  const query = totpURI.split('?')[1];
  if (query === undefined) return null;
  return new URLSearchParams(query).get('secret') || null;
}

/** Záložní kódy do schránky: každý na vlastním řádku, aby šly rovnou vložit do poznámek. */
export function backupCodesClipboardText(codes: readonly string[]): string {
  return codes.join('\n');
}
