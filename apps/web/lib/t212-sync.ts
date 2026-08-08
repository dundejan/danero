import {
  isTruncatedTrading212Export,
  mapPositionsToIsin,
  Trading212ApiError,
  Trading212Client,
  type RowIssue,
} from '@danero/importers';
import type { Db } from '@/db';
import {
  finishBrokerSync,
  reconcileBrokerPositions,
  testEnvBaseUrl,
  type BrokerAccountRow,
  type StoredReconciliation,
  type SyncProgress,
  type SyncStatus,
  type SyncYearProgress,
  previouslyVerifiedYears,
} from '@/lib/broker-sync';
import { decryptSecret } from '@/lib/crypto';
import {
  detectAndParse,
  importParsed,
  loadDedupeKeys,
  type ImportSummary,
} from '@/lib/import-service';
import { errorText } from '@/lib/log';
import { upsertInstrumentPrices } from '@/lib/prices';

export interface SyncOutcome {
  batches: ImportSummary[];
  yearsCovered: number[];
  added: number;
  duplicates: number;
  errors: RowIssue[];
  reconciliation: StoredReconciliation | null;
  status: SyncStatus;
}

/** U 403 doplní nápovědu k oprávněním T212 klíče (jinak vrací zprávu beze změny). */
export function explainT212SyncError(message: string): string {
  return message.includes('403')
    ? `${message} — klíč zřejmě nemá potřebná oprávnění (Account data, History + podkategorie, Metadata, Portfolio). Vygeneruj nový klíč podle návodu na stránce Zdroje dat.`
    : message;
}

export interface SyncOptions {
  fetchImpl?: typeof fetch;
  now?: Date;
  pollIntervalMs?: number;
  /** Default: 'full' při první synchronizaci účtu, jinak 'incremental'. */
  mode?: 'full' | 'incremental';
  /** Průběžné hlášení stavu (job runner ho zapisuje do DB pro UI). */
  onProgress?: (progress: SyncProgress) => void | Promise<void>;
  /**
   * Resume plného syncu: průběh posledního NEúspěšného plného běhu
   * (jobs.progress) + kdy skončil. Dokončené roky se přeskočí — plný sync
   * (65 s čekání na export ZA KAŽDÝ rok) by se jinak na serverless platformě
   * nikdy nedokončil, protože každý pokus začínal od nuly.
   */
  resume?: { years: SyncYearProgress[]; syncedAt: Date };
}

/** T212 Invest existuje od ~2017 — pod tento rok nemá smysl exporty žádat. */
const T212_MIN_YEAR = 2016;

/**
 * Nejstarší rok, na který jsme se u T212 ptali (napříč běhy). `null` = došli
 * jsme až na začátek nabídky brokera, takže starší historie existovat nemůže.
 */
function oldestCheckedYear(verifiedYears: number[]): number | null {
  if (verifiedYears.length === 0) return null;
  const oldest = Math.min(...verifiedYears);
  return oldest <= T212_MIN_YEAR ? null : oldest;
}

/** Uložené přihlašovací údaje: nový formát JSON {keyId, secret}, starší = samotný klíč. */
interface StoredCredentials {
  keyId?: string;
  secret: string;
}

function parseCredentials(encrypted: string): StoredCredentials {
  const plain = decryptSecret(encrypted);
  try {
    const parsed = JSON.parse(plain) as { keyId?: unknown; secret?: unknown };
    if (typeof parsed?.secret === 'string') {
      return {
        keyId: typeof parsed.keyId === 'string' && parsed.keyId !== '' ? parsed.keyId : undefined,
        secret: parsed.secret,
      };
    }
  } catch {
    // starší formát: plaintext je přímo klíč
  }
  return { secret: plain };
}

/**
 * T212 dokumentace je nejednoznačná v tom, zda se autentizuje párem ID+secret
 * (HTTP Basic), nebo samotným tajným klíčem v Authorization. Ověříme si to sami
 * levným getCash(): zkusíme Basic, na 401 spadneme na samotný secret.
 */
function defaultPollIntervalMs(): number {
  if (process.env.NODE_ENV !== 'production') {
    const fromEnv = Number(process.env.T212_POLL_INTERVAL_MS);
    if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  }
  // GET /history/exports snese ~1 dotaz/min — pomalejší poll je nutnost, ne opatrnost
  return 65_000;
}

async function resolveClient(
  credentials: StoredCredentials,
  fetchImpl?: typeof fetch,
): Promise<Trading212Client> {
  const baseUrl = testEnvBaseUrl('T212_API_BASE_URL');
  const clientOptions = {
    ...(fetchImpl ? { fetchImpl } : {}),
    ...(baseUrl ? { baseUrl } : {}),
  };
  const candidates: Trading212Client[] = [];
  if (credentials.keyId) {
    candidates.push(
      new Trading212Client({
        apiKey: credentials.keyId,
        apiSecret: credentials.secret,
        ...clientOptions,
      }),
    );
  }
  candidates.push(new Trading212Client({ apiKey: credentials.secret, ...clientOptions }));

  let lastError: unknown;
  for (const client of candidates) {
    try {
      await client.getCash();
      return client;
    } catch (error) {
      lastError = error;
      // jen 401 znamená „špatná varianta autentizace“ — jiné chyby (403 práva,
      // síť…) rovnou probublají, ať je uživatel vidí
      if (error instanceof Trading212ApiError && error.status === 401) continue;
      throw error;
    }
  }
  throw lastError;
}

/**
 * Synchronizace T212 (docs/03): stačí API klíč. První běh projde SMYČKOU všechny
 * roky od založení účtu (dokud dva po sobě jdoucí roky nejsou prázdné), další běhy
 * stahují jen běžný rok. Každý rok = serverem vygenerovaný CSV export → stejný
 * parser a dedupe jako ruční upload (idempotentní). Ruční CSV je záložní varianta.
 * Po importu rekonciliace pozic proti API (detekce chybějících korporátních akcí).
 */
export async function syncTrading212(
  db: Db,
  account: BrokerAccountRow,
  options: SyncOptions = {},
): Promise<SyncOutcome> {
  const now = options.now ?? new Date();
  const currentYear = now.getUTCFullYear();
  // Plná historie: dokud neproběhl žádný ÚSPĚŠNÝ sync. Po chybě se vždy zkouší
  // znovu celá (dedupe zaručí, že se nic nezdvojí — jen se dotáhne, co chybělo).
  const mode =
    options.mode ??
    (account.lastSyncedAt && account.lastSyncStatus !== 'error' ? 'incremental' : 'full');
  // Inkrementálně se stahuje od běžného roku dolů až po rok posledního úspěšného
  // syncu se 7denní rezervou: obchody se do exportů propisují se zpožděním, takže
  // sync z 31. 12. nesmí po Novém roce nechat ocas prosince navždy nestažený.
  const incrementalMinYear = account.lastSyncedAt
    ? Math.min(
        new Date(account.lastSyncedAt.getTime() - 7 * 86_400_000).getUTCFullYear(),
        currentYear,
      )
    : currentYear;

  const yearProgress: SyncYearProgress[] = [];
  const report = async (phase: SyncProgress['phase']) => {
    await options.onProgress?.({ phase, mode, years: yearProgress });
  };

  await report('connecting');
  const client = await resolveClient(
    parseCredentials(account.credentialsEncrypted),
    options.fetchImpl,
  );
  const pollIntervalMs = options.pollIntervalMs ?? defaultPollIntervalMs();

  const batches: ImportSummary[] = [];
  const yearsCovered: number[] = [];
  // dedupe klíče jednou za sync, ne per rok — importParsed do množiny doplňuje
  const dedupeKeys = await loadDedupeKeys(db, account.userId);
  let emptyStreak = 0;
  // kolik řádků nám brokerovy exporty vůbec vydaly (nezávisle na dedupe) —
  // rozlišuje „účet nic neobchodoval“ od „broker nic nevrátil“ (G-1)
  let parsedTransactions = 0;

  // Per-year resume: roky dokončené v posledním neúspěšném plném běhu se
  // přeskočí (transakce už jsou v DB, dedupe by nic nepřidal — platilo by se
  // jen čekání na export). Běžný rok a roky poblíž času pádu se stahují vždy
  // znovu — obchody se do exportů propisují se zpožděním (stejná 7denní
  // rezerva jako u inkrementálního syncu).
  const resumeDone = new Map<number, SyncYearProgress>();
  if (mode === 'full' && options.resume) {
    const resumeSafeBelowYear = new Date(
      options.resume.syncedAt.getTime() - 7 * 86_400_000,
    ).getUTCFullYear();
    for (const entry of options.resume.years) {
      // Dědí se JEN rok, jehož stažení i zpracování doběhlo celé bez výjimky
      // (`complete`). Status 'done' sám nestačí: sedí i na roku z běhu starší
      // verze, kde se úplnost neznačila. Rok s chybami řádků se nedědí taky —
      // vadný export mohl být přechodný a přeskočením by transakce chyběly navždy.
      if (
        entry.year < resumeSafeBelowYear &&
        entry.year !== currentYear &&
        entry.complete === true &&
        entry.status !== 'running' &&
        (entry.errors ?? 0) === 0
      ) {
        resumeDone.set(entry.year, entry);
      }
    }
  }

  const minYear = mode === 'incremental' ? incrementalMinYear : T212_MIN_YEAR;
  for (let year = currentYear; year >= minYear; year -= 1) {
    const alreadyDone = resumeDone.get(year);
    if (alreadyDone) {
      // zděděný záznam v průběhu — UI vidí celou historii, další případný
      // pád ho předá dalšímu resume
      yearProgress.push({ ...alreadyDone });
      // prázdnost se hodnotí stejně jako u živého běhu (počty minulého běhu):
      // rok bez jediné transakce zvyšuje počítadlo a ukončuje smyčku
      parsedTransactions += (alreadyDone.added ?? 0) + (alreadyDone.duplicates ?? 0);
      if ((alreadyDone.added ?? 0) + (alreadyDone.duplicates ?? 0) === 0) {
        emptyStreak += 1;
        if (emptyStreak >= 2) break;
      } else {
        emptyStreak = 0;
      }
      continue;
    }
    const current: SyncYearProgress = { year, status: 'running' };
    yearProgress.push(current);
    await report('exporting');
    const rawExport = await client.fetchHistoryCsv(
      {
        timeFrom: `${year}-01-01T00:00:00Z`,
        timeTo:
          year === currentYear
            ? `${now.toISOString().slice(0, 19)}Z`
            : `${year}-12-31T23:59:59Z`,
        dataIncluded: {
          includeOrders: true,
          includeDividends: true,
          includeTransactions: true,
          includeInterest: true,
        },
      },
      pollIntervalMs,
      600_000,
    );
    // Ochrana před ne-CSV odpovědí (např. XML chyba expirovaného odkazu) —
    // autodetekce by ji jinak poslala do IBKR parseru a smetí by dostalo cizí broker
    if (rawExport.trimStart().startsWith('<')) {
      throw new Error(
        `Trading212 vrátil pro rok ${year} neočekávanou odpověď místo CSV exportu — zkus synchronizaci za chvíli znovu.`,
      );
    }
    // Export se sloupci, ale bez jediného řádku = přenos utnutý za hlavičkou.
    // Prázdný rok posílá T212 jako úplně prázdný soubor, takže tenhle rok bez
    // obchodů NENÍ — kdyby se za něj vydával, počítal by se do dvou prázdných
    // let v řadě, ukončil by stahování starších roků a sync by se uzavřel jako
    // v pořádku. Kontrola v downloadCsv na to nestačí: stojí na hlavičce
    // Content-Length, kterou server poslat nemusí.
    if (isTruncatedTrading212Export(rawExport)) {
      throw new Error(
        `Export za rok ${year} dorazil bez jediného datového řádku — přenos se zřejmě přerušil hned za hlavičkou (rok bez obchodů posílá Trading212 jako úplně prázdný soubor). Spusť synchronizaci znovu; co už se stáhlo, zůstává a nic se nezdvojí.`,
      );
    }
    const parsed = detectAndParse(rawExport);
    yearsCovered.push(year);
    parsedTransactions += parsed.transactions.length;

    const hasContent =
      parsed.transactions.length > 0 ||
      parsed.errors.length > 0 ||
      parsed.skipped.length > 0 ||
      parsed.warnings.length > 0;
    if (hasContent) {
      const batch = await importParsed(
        db,
        account.userId,
        `t212-api-${year}.csv`,
        parsed,
        dedupeKeys,
      );
      batches.push(batch);
      current.added = batch.added;
      current.duplicates = batch.duplicates;
      if (batch.errors.length > 0) current.errors = batch.errors.length;
    }
    // „empty“ jen když v roce opravdu nic nebylo — rok plný chybových řádků
    // musí v průběhu ukázat počty, ne „žádné transakce“
    current.status = hasContent ? 'done' : 'empty';
    // až sem se dojde jen bez výjimky (stažení, parsování i uložení) — teprve
    // takový rok smí příští resume přeskočit
    current.complete = true;

    // Rok bez jediné transakce počítáme jako prázdný VŽDY (i kdyby parser hlásil
    // chyby — nesmí nám resetovat počítadlo a prohnat smyčku až do 2016).
    // Inkrementální běh ukončuje spodní mez smyčky (minYear), ne obsah roku.
    if (parsed.transactions.length === 0) {
      emptyStreak += 1;
      if (mode === 'full' && emptyStreak >= 2) break;
    } else {
      emptyStreak = 0;
    }
  }

  await report('reconciling');
  let reconciliation: StoredReconciliation | null = null;
  let reconciliationError: string | null = null;
  try {
    const [positions, instruments] = await Promise.all([
      client.getPositions(),
      client.getInstruments(),
    ]);
    const mapped = mapPositionsToIsin(positions, instruments);
    await upsertInstrumentPrices(
      db,
      account.userId,
      account.broker,
      mapped.positions.map((p) => ({ isin: p.isin, price: p.currentPrice ?? 0, currency: p.currency })),
      now,
    );
    // roky ověřené dřívějšími běhy + tímhle během (inkrementál stahuje jen
    // běžný rok, ale co plný sync ověřil, platí dál)
    const verifiedYears = [...previouslyVerifiedYears(account), ...yearsCovered];
    reconciliation = await reconcileBrokerPositions(
      db,
      account.userId,
      account.broker,
      mapped.positions.map((p) => ({ isin: p.isin, quantity: p.quantity })),
      now.toISOString().slice(0, 10),
      {
        unmatchedTickers: mapped.unmatchedTickers,
        syncedYears: verifiedYears,
        // Kam až jsme se u brokera podívali. Smyčka končí po dvou prázdných
        // letech, takže pod tou hranicí může být celý neobjevený rok obchodů
        // (B4-3). Na T212_MIN_YEAR už žádná starší historie neexistuje.
        checkedFromYear: oldestCheckedYear(verifiedYears),
      },
    );
  } catch (error) {
    // přechodné selhání rekonciliace (typicky 429 na portfolio endpoint) nesmí
    // přepsat poslední platný „pozice sedí“ — chyba se uloží vedle
    reconciliationError = errorText(error);
  }

  const added = batches.reduce((sum, batch) => sum + batch.added, 0);
  const duplicates = batches.reduce((sum, batch) => sum + batch.duplicates, 0);
  const errors = batches.flatMap((batch) => batch.errors);

  // G-1: prázdný export (výpadek generování na straně T212) vypadá stejně jako
  // prázdný rok. Plný sync, který nepřinesl ANI JEDNU transakci a zároveň nemá
  // potvrzeno, že pozice sedí, se proto neuzavírá — jinak by se lastSyncedAt
  // nastavil, další běh by byl inkrementální a plná historie by chyběla navždy.
  const incomplete =
    mode === 'full' && parsedTransactions === 0 && reconciliation?.ok !== true
      ? 'Trading212 nevrátil za žádný rok jedinou transakci a zároveň se nepodařilo ověřit, že pozice sedí — synchronizaci proto nepovažujeme za dokončenou a příště se stáhne znovu celá historie. Bývá to dočasný výpadek generování výpisů na straně Trading212; zkus to za chvíli znovu.'
      : null;

  const status = await finishBrokerSync(db, account, reconciliation, errors.length, now, {
    reconciliationError,
    incomplete,
  });

  return { batches, yearsCovered, added, duplicates, errors, reconciliation, status };
}
