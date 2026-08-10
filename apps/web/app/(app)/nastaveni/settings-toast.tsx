import { Toast } from '@/components/toast';

/**
 * Potvrzení a chyby obou stránek nastavení na jednom místě — akce v
 * `actions.ts` posílají kód v `?ok=` / `?chyba=` a která stránka ho zobrazí,
 * je na cíli přesměrování. Toast plave, protože po auto-save s kotvou
 * (#dan, #notifikace) musí být vidět bez ohledu na pozici scrollu.
 */
const OK_LABELS: Record<string, string> = {
  heslo: 'Heslo změněno. Ostatní zařízení byla odhlášena.',
  email:
    'E-mail změněn. Poslali jsme na novou adresu ověřovací odkaz — potvrď ho, jinak se příště nepřihlásíš.',
  odhlaseno: 'Ostatní zařízení byla odhlášena.',
  profil: 'Uloženo. Výpočty se přepočítají podle nového profilu.',
  notifikace: 'Uloženo. E-maily se řídí novým nastavením.',
  fixace: 'Fixace zrušená. Rok se zase počítá podle nastavení v profilu.',
};

const CHYBA_LABELS: Record<string, string> = {
  heslo: 'Nové heslo musí mít aspoň 10 znaků.',
  'heslo-spatne': 'Současné heslo nesedí — heslo se nezměnilo.',
  email: 'Zadej platný e-mail.',
  'email-obsazeny': 'E-mail se nepodařilo změnit (nejspíš už ho používá jiný účet).',
  'email-ulozeni': 'E-mail se teď nepodařilo změnit — zkus to prosím za chvíli.',
  'email-heslo': 'Heslo nesedí — e-mail se nezměnil.',
  smazani: 'Pro smazání účtu napiš do potvrzení přesně SMAZAT.',
  'smazani-heslo': 'Heslo nesedí — účet se nesmazal.',
  // ochrana účtu (D-2/D-3): po několika pokusech se operace na pár minut zamkne
  'heslo-limit': 'Moc pokusů o změnu hesla po sobě — zkus to prosím za pět minut.',
  'email-limit': 'Moc pokusů o změnu e-mailu po sobě — zkus to prosím za pět minut.',
  'smazani-limit': 'Moc pokusů o smazání účtu po sobě — zkus to prosím za pět minut.',
  fixace: 'Fixaci se nepodařilo zrušit — zkus to prosím znovu.',
};

export function SettingsToast({ ok, chyba }: { ok?: string; chyba?: string }) {
  return (
    <>
      {chyba && (
        <Toast
          // klíč per render: po dalším uložení se toast musí remountnout,
          // jinak by visible=false z minula potvrzení skrylo
          key={crypto.randomUUID()}
          kind="chyba"
          floating
          text={CHYBA_LABELS[chyba] ?? 'Formulář se nepodařilo uložit. Zkontroluj vyplněné hodnoty.'}
        />
      )}
      {ok && OK_LABELS[ok] && (
        <Toast key={crypto.randomUUID()} kind="ok" floating text={OK_LABELS[ok]} />
      )}
    </>
  );
}
