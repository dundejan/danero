import { plural } from '@/lib/format';
import { firstParam } from '@/lib/utils';

/**
 * Odezva po akcích na /import: adresa, kterou akce skončí, a hláška, kterou
 * z ní stránka složí.
 *
 * Proč to jde přes adresu: nahrání, vrácení, uložení klíče, odpojení
 * i spuštění synchronizace končily na `/import` — tedy na adrese, která je
 * právě otevřená — a v produkčním buildu se taková akce v prohlížeči často
 * nedokončila (L6a-02, L6b-01: tlačítko viselo na „Nahrávám a počítám…“,
 * přestože server dávno odpověděl). Přesměrování na JINOU adresu se
 * nezasekávalo. Každá akce proto nese kód výsledku a údaj, který se neopakuje
 * (id dávky, účtu nebo jobu), takže dvě akce po sobě nikdy neskončí stejně.
 *
 * Čistá funkce bez I/O — importuje ji server (akce, stránka) i klient (toast).
 */

/** Co akce k hlášce přibalí. */
export interface ImportFeedbackDetails {
  /** Kolik souborů akce zpracovala. */
  files?: number;
  /** Kolik transakcí přibylo. */
  added?: number;
  /** Kolik souborů má aspoň jednu chybu. */
  filesWithErrors?: number;
  /** Kolik transakcí vrácení smazalo. */
  removed?: number;
  /** Id dávky, účtu u brokera a jobu — jen aby se adresa neopakovala. */
  batchId?: string;
  accountId?: string;
  jobId?: string;
}

/**
 * Jména parametrů v adrese — česky, uživatel je vidí. Typ hlídá, že tu žádný
 * údaj z `ImportFeedbackDetails` nechybí.
 */
const PARAM_NAMES: Record<keyof ImportFeedbackDetails, string> = {
  files: 'soubory',
  added: 'pridano',
  filesWithErrors: 'chyby',
  removed: 'smazano',
  batchId: 'davka',
  accountId: 'ucet',
  jobId: 'uloha',
};

/**
 * Parametry, které k hlášce patří a které toast po zobrazení z adresy maže
 * (spolu s `ulozeno`) — jinak by v ní zůstaly viset a obnovení stránky by
 * hlášku ukázalo znovu.
 */
export const IMPORT_FEEDBACK_PARAMS: readonly string[] = Object.values(PARAM_NAMES);

/** Kotva sekce „Historie importů“ — tam vede odezva po nahrání a po vrácení. */
export const IMPORT_HISTORY_ANCHOR = 'historie';

/** Karty brokerů na /import mají jako `id` přímo kód brokera. */
const BROKER_CARD_ANCHORS = new Set(['trading212', 'ibkr']);

/** Kotva karty brokera, ať stránka po akci zůstane u ní; jiný broker kartu nemá. */
export const brokerCardAnchor = (broker: string): string | undefined =>
  BROKER_CARD_ANCHORS.has(broker) ? broker : undefined;

export type ImportFeedbackCode = 'nahrano' | 'vraceno' | 'pripojeno' | 'odpojeno' | 'spusteno';

/** Adresa, kterou akce skončí: `/import?ulozeno=<kód>&…#<kotva>`. */
export function importFeedbackUrl(
  code: ImportFeedbackCode,
  details: ImportFeedbackDetails,
  anchor?: string,
): string {
  const query = new URLSearchParams({ ulozeno: code });
  for (const key of Object.keys(PARAM_NAMES) as Array<keyof ImportFeedbackDetails>) {
    const value = details[key];
    if (value !== undefined) query.set(PARAM_NAMES[key], String(value));
  }
  return `/import?${query.toString()}${anchor ? `#${anchor}` : ''}`;
}

export interface ImportFeedback {
  kind: 'ok' | 'chyba';
  text: string;
}

type Params = Record<string, string | string[] | undefined>;

/**
 * Počet z adresy. Bere jen holé číslice — adresu může kdokoli poslat odkazem
 * a do hlášky se z ní nesmí dostat nic jiného než číslo.
 */
function count(value: string | string[] | undefined): number | undefined {
  const raw = firstParam(value);
  return raw !== undefined && /^\d{1,7}$/.test(raw) ? Number(raw) : undefined;
}

const transactionsWord = (n: number): string => plural(n, 'transakce', 'transakce', 'transakcí');

const HISTORY_HINT = 'Podrobnosti najdeš v historii importů.';

/**
 * Souhrn nahrání. Schválně jinými slovy než karta v historii („2 nové ·
 * 0 duplicit“): hláška říká, co se stalo a kde hledat zbytek, karta nese čísla.
 */
function uploadFeedback(params: Params): ImportFeedback {
  const files = count(params[PARAM_NAMES.files]);
  const added = count(params[PARAM_NAMES.added]);
  if (files === undefined || files === 0 || added === undefined) {
    return { kind: 'ok', text: `Nahráno. ${HISTORY_HINT}` };
  }
  const errors = Math.min(count(params[PARAM_NAMES.filesWithErrors]) ?? 0, files);
  const head =
    `Nahráno: ${files} ${plural(files, 'soubor', 'soubory', 'souborů')}, ` +
    (added === 0
      ? 'žádná nová transakce nepřibyla.'
      : `${plural(added, 'přibyla', 'přibyly', 'přibylo')} ${added} ${transactionsWord(added)}.`);
  if (errors === 0) return { kind: 'ok', text: `${head} ${HISTORY_HINT}` };
  const who =
    files === 1
      ? 'Soubor má chyby'
      : errors === files
        ? 'Chyby mají všechny'
        : `Chyby ${plural(errors, 'má', 'mají', 'má')} ${errors} z nich`;
  return {
    // nic nepřibylo a soubory mají chyby: zelené „hotovo“ by lhalo
    kind: added === 0 ? 'chyba' : 'ok',
    text: `${head} ${who} — jaké, je napsané v historii importů.`,
  };
}

function undoFeedback(params: Params): ImportFeedback {
  const removed = count(params[PARAM_NAMES.removed]);
  if (removed === undefined) return { kind: 'ok', text: 'Import vrácen.' };
  return {
    kind: 'ok',
    text: `Import vrácen, ${plural(removed, 'smazána', 'smazány', 'smazáno')} ${removed} ${transactionsWord(removed)}.`,
  };
}

/**
 * Hláška k výsledku akce podle parametrů adresy; `null`, když adresa žádný
 * z těchto výsledků nenese. (`ulozeno=ciselnik` a `ulozeno=hlaseni` mají
 * hlášku přímo na stránce.)
 */
export function importFeedback(params: Params): ImportFeedback | null {
  switch (firstParam(params.ulozeno)) {
    case 'nahrano':
      return uploadFeedback(params);
    case 'vraceno':
      return undoFeedback(params);
    case 'pripojeno':
      return {
        kind: 'ok',
        text: 'Klíč je uložený a účet připojený. Historii stáhneš tlačítkem v kartě brokera.',
      };
    case 'odpojeno':
      return {
        kind: 'ok',
        text: 'Účet je odpojený a jeho klíč smazaný. Transakce, které se z něj už stáhly, zůstávají.',
      };
    case 'spusteno':
      return {
        kind: 'ok',
        text: 'Synchronizace běží na pozadí — průběh uvidíš v kartě brokera.',
      };
    default:
      return null;
  }
}
