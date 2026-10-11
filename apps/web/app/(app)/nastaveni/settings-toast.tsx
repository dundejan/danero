import { Toast } from '@/components/toast';
import { COMMON_PASSWORD_MESSAGE } from '@/lib/password-strength';

/**
 * Potvrzení a chyby stránek nastavení na jednom místě. Akce s přesměrováním
 * (`actions.ts`) posílají kód v `?ok=` / `?chyba=` a která stránka ho zobrazí,
 * je na cíli přesměrování; auto-save adresu nemění a text si bere odsud přímo
 * (`save.ts`). Toast plave, protože po uložení uprostřed dlouhé stránky musí
 * být potvrzení vidět bez ohledu na pozici scrollu.
 */
const OK_LABELS = {
  heslo: 'Heslo změněno. Ostatní zařízení byla odhlášena.',
  email:
    'E-mail změněn. Poslali jsme na novou adresu ověřovací odkaz — potvrď ho, jinak se příště nepřihlásíš.',
  odhlaseno: 'Ostatní zařízení byla odhlášena.',
  profil: 'Uloženo. Výpočty se přepočítají podle nového profilu.',
  notifikace: 'Uloženo. E-maily se řídí novým nastavením.',
  fixace: 'Fixace zrušená. Rok se zase počítá podle nastavení v profilu.',
} as const satisfies Record<string, string>;

/** Text potvrzení podle kódu — pro auto-save, který ho ukazuje bez adresy. */
export function settingsOkText(code: keyof typeof OK_LABELS): string {
  return OK_LABELS[code];
}

const CHYBA_LABELS: Record<string, string> = {
  heslo: 'Nové heslo musí mít aspoň 10 znaků.',
  'heslo-bezne': `${COMMON_PASSWORD_MESSAGE} Heslo se nezměnilo.`,
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
  // selhání, které není ve vyplněných údajích — za špatné heslo se nevydává
  'heslo-selhalo': 'Heslo se teď nepodařilo změnit, chyba je na naší straně — zkus to prosím za chvíli.',
  'smazani-selhalo':
    'Účet se teď nepodařilo smazat, chyba je na naší straně — zkus to prosím za chvíli.',
  fixace: 'Fixaci se nepodařilo zrušit — zkus to prosím znovu.',
  rezim: 'Vyber svůj daňový režim — podle něj Danero pozná, který limit ti má hlídat.',
  prijmy:
    'Další zdanitelné příjmy zadej jako částku v korunách — třeba 12000 nebo 12000,50. Takhle se neuloží.',
};

/** Text chyby podle kódu z adresy — pro hlášku přímo u pole (stránka účtu). */
export function settingsErrorText(code: string): string {
  return CHYBA_LABELS[code] ?? 'Formulář se nepodařilo uložit. Zkontroluj vyplněné hodnoty.';
}

export function SettingsToast({
  ok,
  chyba,
  inline = false,
}: {
  ok?: string;
  chyba?: string;
  /** Chybu stránka ukazuje u pole, kterého se týká — toast ji neopakuje. */
  inline?: boolean;
}) {
  return (
    <>
      {chyba && !inline && (
        <Toast
          // klíč per render: po dalším uložení se toast musí remountnout,
          // jinak by visible=false z minula potvrzení skrylo
          key={crypto.randomUUID()}
          kind="chyba"
          floating
          text={settingsErrorText(chyba)}
        />
      )}
      {ok && ok in OK_LABELS && (
        <Toast
          key={crypto.randomUUID()}
          kind="ok"
          floating
          text={OK_LABELS[ok as keyof typeof OK_LABELS]}
        />
      )}
    </>
  );
}
