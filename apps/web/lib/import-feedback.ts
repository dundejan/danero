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
  /**
   * Id dávky — aby se adresa neopakovala a aby stránka věděla, které řádky
   * historie má po nahrání otevřít. Nahrání víc souborů jich pošle víc
   * (`batchesToOpen`), parametr se pak v adrese opakuje.
   */
  batchId?: string | string[];
  /** Id účtu u brokera a jobu — jen aby se adresa neopakovala. */
  accountId?: string;
  jobId?: string;
  /**
   * Nahrání přineslo PRVNÍ data účtu (do té chvíle neměl jedinou transakci) —
   * hláška pak nabídne přehled (`isFirstDataUpload`). `false` se do adresy
   * nepíše.
   */
  firstData?: boolean;
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
  firstData: 'prvni',
};

/**
 * Parametry, které k hlášce patří a které toast po zobrazení z adresy maže
 * (spolu s `ulozeno`) — jinak by v ní zůstaly viset a obnovení stránky by
 * hlášku ukázalo znovu.
 */
export const IMPORT_FEEDBACK_PARAMS: readonly string[] = Object.values(PARAM_NAMES);

/**
 * Kolik importů historie ukazuje — parametr `historie` (odkaz „Zobrazit
 * starší“). K hlášce nepatří, takže ho toast z adresy nemaže.
 */
export const HISTORY_PARAM = 'historie';
export const HISTORY_PAGE = 20;
/**
 * Kolik posledních dávek stránka načte vždy — tak daleko se dívá číselník
 * a nepřečtené výpisy, i když historie ukazuje jen prvních dvacet.
 *
 * Strop historie to NENÍ (do 11. 10. 2026 byl): záznam o dávce je jediná
 * cesta, jak její transakce vrátit, a napojený účet zapíše dávku při každé
 * denní synchronizaci — ruční výpis z doby před napojením by tak z dosahu
 * vypadl během měsíců. Odkaz „Zobrazit starší“ proto vede, dokud je kam.
 */
export const HISTORY_LOOKBACK = 200;
/** Od téhle délky se „Zobrazit starší“ posouvá po stovce, ne po dvaceti. */
const HISTORY_LONG_STEP = 100;

/**
 * Kolik importů má historie ukázat: výchozích 20, odkazem dál.
 * Hodnota je z adresy — bere se jen celé číslo (nejvýš čtyři číslice).
 */
export function historyLimit(params: Params): number {
  const raw = firstParam(params[HISTORY_PARAM]);
  if (raw === undefined || !/^\d{1,4}$/.test(raw)) return HISTORY_PAGE;
  return Math.max(Number(raw), HISTORY_PAGE);
}

/** Délka, na kterou vede „Zobrazit starší“: po dvaceti do stovky, pak po stovce. */
export const nextHistoryLimit = (limit: number): number =>
  limit < HISTORY_LONG_STEP ? limit + HISTORY_PAGE : limit + HISTORY_LONG_STEP;

/** Kolik dávek načíst: o jednu víc, než se ukáže (pozná se, že jsou starší). */
export const historyQueryLimit = (limit: number): number =>
  Math.max(limit + 1, HISTORY_LOOKBACK);

/** Kotva sekce „Historie importů“ — tam vede odezva po nahrání a po vrácení. */
export const IMPORT_HISTORY_ANCHOR = 'historie';

/** Bloky brokerů na /import (připojený účet i řádek „napojit“) mají jako `id` přímo kód brokera. */
const BROKER_CARD_ANCHORS = new Set(['trading212', 'ibkr']);

/** Kotva bloku brokera, ať stránka po akci zůstane u něj; jiný broker blok nemá. */
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
    if (value === undefined || value === false) continue;
    for (const item of Array.isArray(value) ? value : [value]) {
      query.append(PARAM_NAMES[key], String(item));
    }
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

/**
 * Souhrn nahrání. Schválně jinými slovy než karta v historii („2 nové ·
 * 0 duplicit“): hláška říká, co se stalo, karta nese čísla. Stojí přímo nad
 * historií importů (`feedbackPlacement`), takže na ni větou neodkazuje — jen
 * u chyb říká, kde jsou vypsané.
 */
function uploadFeedback(params: Params): ImportFeedback {
  const files = count(params[PARAM_NAMES.files]);
  const added = count(params[PARAM_NAMES.added]);
  if (files === undefined || files === 0 || added === undefined) {
    return { kind: 'ok', text: 'Nahráno.' };
  }
  const errors = Math.min(count(params[PARAM_NAMES.filesWithErrors]) ?? 0, files);
  // Nic nepřibylo a soubory mají chyby: zelené „hotovo“ by lhalo — a věta
  // nesmí začínat slovem „Nahráno“, které říká opak červené tečky (R1B-28).
  if (added === 0 && errors > 0) {
    const what =
      files === 1
        ? 'Soubor má chyby a nic nového z něj nepřibylo'
        : errors === files
          ? `Nahrané soubory (${files}) mají chyby a nic nového z nich nepřibylo`
          : `Nahrané soubory (${files}) nic nového nepřinesly. Chyby ${plural(errors, 'má', 'mají', 'má')} ${errors} z nich`;
    return { kind: 'chyba', text: `${what} — jaké, je napsané v historii importů.` };
  }
  const head =
    `Nahráno: ${files} ${plural(files, 'soubor', 'soubory', 'souborů')}, ` +
    (added === 0
      ? 'žádná nová transakce nepřibyla.'
      : `${plural(added, 'přibyla', 'přibyly', 'přibylo')} ${added} ${transactionsWord(added)}.`);
  if (errors === 0) return { kind: 'ok', text: head };
  const who =
    files === 1
      ? 'Soubor má chyby'
      : errors === files
        ? 'Chyby mají všechny'
        : `Chyby ${plural(errors, 'má', 'mají', 'má')} ${errors} z nich`;
  // část prošla: potvrzení, ale s upozorněním
  return { kind: 'ok', text: `${head} ${who} — jaké, je napsané v historii importů.` };
}

/** Kolik dávek nejvýš se po nahrání samo otevře (a kolik id unese adresa). */
const MAX_OPENED_BATCHES = 20;

/**
 * Které právě nahrané dávky má historie po přesměrování otevřít: všechny, které
 * mají chybu, varování nebo shodu s jiným brokerem — ne jen tu poslední.
 * Při nahrání víc souborů naráz jinak chyby dřívějších zůstaly zavřené za
 * počtem „1 chyba“ (R5-05).
 *
 * Poslední dávka je v seznamu vždy, i když je v pořádku: její id dělá adresu
 * neopakovatelnou (dvě nahrání po sobě nesmí skončit na téže adrese).
 */
export function batchesToOpen(
  summaries: ReadonlyArray<{
    batchId: string;
    errors: readonly unknown[];
    warnings: readonly unknown[];
    crossBroker: readonly unknown[];
  }>,
): string[] {
  const withIssues = summaries
    .filter(
      (summary) =>
        summary.errors.length > 0 || summary.warnings.length > 0 || summary.crossBroker.length > 0,
    )
    .map((summary) => summary.batchId);
  const last = summaries.at(-1)?.batchId;
  const ids = new Set(withIssues.slice(-MAX_OPENED_BATCHES));
  if (last !== undefined) ids.add(last);
  return [...ids];
}

/** Dávky z adresy, které má historie po nahrání otevřít (jen po `ulozeno=nahrano`). */
export function uploadedBatchIds(params: Params): Set<string> {
  if (firstParam(params.ulozeno) !== 'nahrano') return new Set();
  return new Set([params[PARAM_NAMES.batchId]].flat().filter((id) => id !== undefined));
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
 * Kde se hláška ukáže. Výsledek nahrání a vrácení patří do toku stránky nad
 * historii importů: akce končí na její kotvě a plovoucí hláška na telefonu
 * ležela přesně přes první řádek historie — ten, o kterém mluvila (R2-25).
 * Ostatní výsledky k historii nepatří a plavou dál. `null` = adresa žádnou
 * z těchto hlášek nenese.
 */
export function feedbackPlacement(params: Params): 'history' | 'floating' | null {
  if (importFeedback(params) === null) return null;
  const code = firstParam(params.ulozeno);
  return code === 'nahrano' || code === 'vraceno' ? 'history' : 'floating';
}

/**
 * Přineslo právě dokončené nahrání první data účtu? Příznak dává akce (ví, že
 * účet před nahráním neměl jedinou transakci); z adresy se bere jen spolu
 * s nenulovým počtem přidaných transakcí.
 */
export function isFirstDataUpload(params: Params): boolean {
  return (
    firstParam(params.ulozeno) === 'nahrano' &&
    firstParam(params[PARAM_NAMES.firstData]) === 'true' &&
    (count(params[PARAM_NAMES.added]) ?? 0) > 0
  );
}

/**
 * Má hláška po nahrání nabídnout přehled („Hotovo, otevřít přehled“)? Jen po
 * prvních datech účtu a jen když nahrání proběhlo BEZ chyb: „Hotovo“ vedle věty
 * „Soubor má chyby“ vedlo nového uživatele pryč od řádku, který si má přečíst
 * (nález revize R6). Přehled má po ruce v navigaci.
 */
export function offersOverviewAfterUpload(params: Params): boolean {
  return isFirstDataUpload(params) && (count(params[PARAM_NAMES.filesWithErrors]) ?? 0) === 0;
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
        text: 'Klíč je uložený a účet připojený. Zbývá stáhnout historii — tlačítkem u účtu.',
      };
    case 'odpojeno':
      return {
        kind: 'ok',
        text: 'Účet je odpojený a jeho klíč smazaný. Transakce, které se z něj už stáhly, zůstávají.',
      };
    case 'spusteno':
      return {
        kind: 'ok',
        text: 'Synchronizace běží na pozadí — průběh uvidíš u účtu.',
      };
    case 'profil':
      // první uložení daňového profilu vede rovnou sem, ke kroku 2 (R1B-05)
      return { kind: 'ok', text: 'Profil je uložený. Zbývá přidat obchody.' };
    default:
      return null;
  }
}
