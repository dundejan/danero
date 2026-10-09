'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { after } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { isValidIsin } from '@danero/shared';
import { getDb } from '@/db';
import { brokerAccounts } from '@/db/schema';
import { logAudit } from '@/lib/audit';
import { encryptSecret } from '@/lib/crypto';
import { invalidateUserCache } from '@/lib/engine-cache';
import { reportFailedImport } from '@/lib/failed-imports';
import {
  brokerCardAnchor,
  IMPORT_HISTORY_ANCHOR,
  importFeedbackUrl,
} from '@/lib/import-feedback';
import { importFileIsolated } from '@/lib/import-service';
import { undoImportBatch } from '@/lib/import-undo';
import {
  aliasesBlockedByTransactions,
  ISIN_ONLY_BROKERS,
  saveAliases,
  type AliasInput,
} from '@/lib/instrument-aliases';
import { continueJobsElsewhere } from '@/lib/cron-handoff';
import { enqueueSyncJob, jobTypeForBroker, processJob } from '@/lib/jobs';
import { errorText, logEvent } from '@/lib/log';
import { requireUser } from '@/lib/session';

/**
 * Strop velikosti nahraného souboru.
 *
 * NENÍ to naše volba, ale tvrdý limit platformy: Vercel utne tělo požadavku
 * na **4,5 MB** dřív, než se dostane k aplikaci. Změřeno naostro proti
 * `https://danero.cz/api/health` (POST s rostoucím tělem): 4 300 kB projde
 * (HTTP 405 od aplikace), **4 400 kB → HTTP 413 `FUNCTION_PAYLOAD_TOO_LARGE`**,
 * a to je syrová anglická stránka od Vercelu, ne naše česká hláška.
 *
 * Do 9. 8. 2026 tu bylo 20 MB, takže uživatel s velkým exportem dostal
 * nesrozumitelnou chybu místo rady, co dělat (nález F-3-3). 4 MB nechává
 * rezervu na multipart hlavičky a ostatní pole formuláře.
 */
const MAX_FILE_BYTES = 4 * 1024 * 1024;

export async function uploadImportAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  // Nevyplněné pole pošle prohlížeč jako soubor BEZ JMÉNA a s nulovou délkou —
  // jen ten se zahazuje. Vybraný soubor o 0 bajtech (nedokončené stahování) má
  // jméno a musí doběhnout do importu, který pro něj má vlastní hlášku („Soubor
  // je prázdný — stahování nejspíš selhalo“) a kartu v historii. Dřív se
  // filtrovalo podle délky, takže skončil výzvou „Vyber aspoň jeden soubor“
  // a ve skupině zmizel beze stopy (L6a-06).
  const files = formData
    .getAll('soubory')
    .filter((f): f is File => f instanceof File && (f.size > 0 || f.name !== ''));

  if (files.length === 0) redirect('/import?chyba=zadny-soubor');
  if (files.some((f) => f.size > MAX_FILE_BYTES)) redirect('/import?chyba=velikost');

  const db = await getDb();
  const { checkRateLimit } = await import('@/lib/rate-limit');
  if (!(await checkRateLimit(db, `upload:${user.id}`, { max: 30, windowMs: 10 * 60_000 }))) {
    redirect('/import?chyba=limit');
  }
  // každý soubor zvlášť: poškozený druhý soubor nesmí sebrat třetí ani zamlčet
  // první (F-3-7) — selhání se zapíše jako dávka s chybou a je vidět v seznamu
  //
  // Try/catch je poslední síť pro případ, kdy selže i ten zápis (K5-08): při
  // výpadku databáze padne `importFileIsolated` včetně zotavovací větve a bez
  // něj by uživatel dostal generický error boundary a ZBYLÉ SOUBORY dávky by
  // se vůbec nezpracovaly. Do historie se v takové chvíli nemá jak zapsat nic,
  // takže jediné, co uživateli zbývá, je hláška — proto se počítají a řekne se
  // to na stránce.
  let failed = 0;
  let added = 0;
  let filesWithErrors = 0;
  let lastBatchId: string | undefined;
  for (const file of files) {
    try {
      const summary = await importFileIsolated(db, user.id, file.name, await file.arrayBuffer());
      added += summary.added;
      if (summary.errors.length > 0) filesWithErrors += 1;
      lastBatchId = summary.batchId;
    } catch (error) {
      failed += 1;
      logEvent('error', 'import.upload_failed', {
        filename: file.name,
        error: errorText(error),
      });
    }
  }

  revalidatePath('/prehled');
  revalidatePath('/import');
  if (failed > 0) redirect('/import?chyba=ulozeni');
  // Cíl se MUSÍ lišit od právě otevřené adresy: akce končící na holém /import
  // se v produkčním buildu v prohlížeči často nedokončila a tlačítko viselo na
  // „Nahrávám a počítám…“ (L6a-02; platí pro všechny akce v tomhle souboru —
  // hlídá to test/import-feedback.test.ts). Adresa zároveň nese souhrn pro
  // plovoucí hlášku a kotvu historie, která na mobilu leží tři obrazovky pod
  // formulářem (L7d-01).
  redirect(
    importFeedbackUrl(
      'nahrano',
      { files: files.length, added, filesWithErrors, batchId: lastBatchId },
      IMPORT_HISTORY_ANCHOR,
    ),
  );
}

const ISIN_RE = /^[A-Z]{2}[A-Z0-9]{9}\d$/;
const CURRENCY_RE = /^[A-Z]{3}$/;

/**
 * Uloží doplněné ISIN/měny k symbolům (XTB, Fio) do číselníku uživatele.
 * Po uložení stačí soubor nahrát znovu — deduplikace nic nezdvojí.
 */
/** Brokeři, pro které číselník dává smysl (XTB chce i měnu instrumentu). */
// XTB (ISIN+měna) + brokeři s ISIN-only mapou (lib/instrument-aliases)
const ALIAS_BROKERS = new Set(['xtb', ...ISIN_ONLY_BROKERS]);
const MAX_ALIAS_ROWS = 200;
/** Kolik symbolů s vadným ISIN se vejde do adresy s hláškou (zbylé zůstanou ve formuláři). */
const MAX_REPORTED_SYMBOLS = 5;

export async function saveAliasesAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  // tvrdý strop a celočíselnost — count je z formuláře (DoS přes Infinity/1e9)
  const rawCount = Number(formData.get('pocet') ?? 0);
  const count = Number.isInteger(rawCount) ? Math.min(Math.max(rawCount, 0), MAX_ALIAS_ROWS) : 0;
  const rows: AliasInput[] = [];
  // ISIN se správným tvarem, ale nesedící kontrolní číslicí (ISO 6166) — skoro
  // jistě překlep při opisování. Uložit se nesmí: ISIN je součást dedupe klíče
  // i identity pozice, takže by se dal opravit jen vrácením importu.
  const badCheckDigit: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const broker = String(formData.get(`broker-${i}`) ?? '');
    const symbol = String(formData.get(`symbol-${i}`) ?? '');
    const isin = String(formData.get(`isin-${i}`) ?? '').trim().toUpperCase();
    const currency = String(formData.get(`currency-${i}`) ?? '').trim().toUpperCase();
    if (!ALIAS_BROKERS.has(broker) || !symbol) continue;
    if (isin === '' && currency === '') continue; // nevyplněný řádek přeskoč
    if (!ISIN_RE.test(isin)) redirect('/import?chyba=isin');
    if (currency !== '' && !CURRENCY_RE.test(currency)) redirect('/import?chyba=mena');
    // XTB bez měny by se v číselníku ignoroval — vynutit i na serveru
    if (broker === 'xtb' && currency === '') redirect('/import?chyba=mena');
    if (!isValidIsin(isin)) {
      badCheckDigit.push(symbol);
      continue;
    }
    rows.push({ broker, symbol, isin, ...(currency ? { currency } : {}) });
  }
  // Řádky bez vady se uloží i tehdy, když jiný neprošel: formulář se po
  // přesměrování vykreslí znovu prázdný a kvůli jednomu překlepu by uživatel
  // opisoval i těch jedenáct ISIN, které napsal správně.
  let isinInUse = false;
  if (rows.length > 0) {
    const db = await getDb();
    // L23-02: ISIN u symbolu, pod kterým už leží transakce, se nepřepisuje —
    // další nahrání téhož výpisu by všechno uložilo podruhé. Ostatní řádky
    // se uloží (stejně jako u kontrolní číslice níž).
    const blocked = new Set(await aliasesBlockedByTransactions(db, user.id, rows));
    isinInUse = blocked.size > 0;
    await saveAliases(
      db,
      user.id,
      rows.filter((row) => !blocked.has(row)),
    );
  }
  revalidatePath('/import');
  if (isinInUse) redirect('/import?chyba=isin-pouzity');
  if (badCheckDigit.length > 0) {
    const query = new URLSearchParams({ chyba: 'isin-kontrola' });
    for (const symbol of badCheckDigit.slice(0, MAX_REPORTED_SYMBOLS)) {
      query.append('symbol', symbol);
    }
    redirect(`/import?${query.toString()}`);
  }
  redirect('/import?ulozeno=ciselnik');
}

/**
 * Vrátí import zpět: smaže transakce z té dávky **i** záznam o ní.
 *
 * Do 13. 8. 2026 tu bylo „Smazat záznam", které mazalo JEN řádek v historii —
 * transakce zůstávaly navždy a smazat je nešlo vůbec nijak (kromě zrušení
 * účtu). Přitom hned tři hlášky uživateli radí „smaž dávku importu", aby se
 * zbavil duplicity, a stejný postup předpokládá i doplnění nového pole do už
 * naimportovaných dat. Rada tedy neplatila a historie navíc lhala: import byl
 * z výpisu pryč, jeho transakce ne.
 *
 * Transakce se mažou podle `batchId`, což je dávka, která je poprvé uložila
 * (dedupe zaručuje, že tatáž transakce ve druhé dávce nevznikne) — po vrácení
 * jde tedy tentýž soubor nahrát znovu.
 *
 * ⚠️ Dávka může pocházet i z API brokera, a tam „nahrát znovu" nestačí:
 * inkrementální sync se ptá jen na roky od poslední synchronizace
 * (`lib/t212-sync.ts`), takže vrácený rok 2019 by se už nikdy nestáhl. Takové
 * dávce se proto účtu zahodí `lastSyncedAt` — poznává se podle názvu, který
 * jim dává `syncBatchFilename` (jediná definice v `lib/broker-sync.ts`).
 */
export async function undoImportAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const batchId = String(formData.get('davka') ?? '');
  let removedCount: number | undefined;
  if (batchId) {
    const db = await getDb();
    const removed = await undoImportBatch(db, user.id, batchId);
    // Cache výpočtů se MUSÍ zahodit ručně: otisk v klíči stojí na seznamu id
    // transakcí, ne na obsahu payloadu. Po vrácení a novém nahrání téhož výpisu
    // (dokumentovaný postup u nového pole v modelu) vyjde klíč identický s tím
    // z doby před vrácením a uživatel by deset minut viděl stará čísla.
    if (removed) {
      removedCount = removed.count;
      invalidateUserCache(user.id);
      const { plural } = await import('@/lib/format');
      await logAudit(
        db,
        user.id,
        'IMPORT_UNDONE',
        `${removed.filename}: ${removed.count} ${plural(removed.count, 'transakce', 'transakce', 'transakcí')}`,
      );
    }
  }
  revalidatePath('/prehled');
  revalidatePath('/portfolio');
  revalidatePath('/import');
  // Vrácení dřív končilo jen revalidací: žádná hláška a karta v prohlížeči často
  // ani nezmizela (L6a-04, L7d-04). Dávka, která už neexistuje (druhý klik,
  // formulář ze staré karty), nesmí vypadat jako úspěch.
  if (removedCount === undefined) redirect('/import?chyba=vraceni');
  redirect(
    importFeedbackUrl('vraceno', { removed: removedCount, batchId }, IMPORT_HISTORY_ANCHOR),
  );
}

/**
 * Uživatel doplnil, ze které platformy je výpis, který jsme nepřečetli.
 * Provozovateli o tom odejde upozornění — teprve tahle informace stačí na to,
 * aby se dal formát dohledat a doplnit.
 */
export async function reportFailedImportAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const caseId = String(formData.get('pripad') ?? '');
  const db = await getDb();
  const outcome = caseId
    ? await reportFailedImport(db, user.id, caseId, {
        platform: String(formData.get('platforma') ?? ''),
        note: String(formData.get('poznamka') ?? ''),
      })
    : 'neexistuje';

  revalidatePath('/import');
  // „Díky, máme to" se nesmí ukázat, když se nic neuložilo — hlášku o prázdném
  // formuláři i o zmizelém případu si uživatel zaslouží slyšet
  if (outcome === 'prazdne') redirect('/import?chyba=hlaseni-prazdne');
  if (outcome === 'neexistuje') redirect('/import?chyba=hlaseni-neexistuje');
  redirect('/import?ulozeno=hlaseni');
}

/* ── Napojení na brokery (Zdroje dat) ────────────────────────────────────── */

/** Uloží T212 API přístup (ID klíče + tajný klíč, šifrovaně) — jeden účet na uživatele. */
export async function saveTrading212KeyAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const keyId = String(formData.get('id-klice') ?? '').trim();
  const secret = String(formData.get('tajny-klic') ?? '').trim();
  if (secret.length < 10) redirect('/import?chyba=api-klic');

  const db = await getDb();
  // transakce: pád mezi delete a insert nesmí nechat uživatele bez účtu
  const accountId = crypto.randomUUID();
  await db.transaction(async (tx) => {
    await tx
      .delete(brokerAccounts)
      .where(and(eq(brokerAccounts.userId, user.id), eq(brokerAccounts.broker, 'trading212')));
    await tx.insert(brokerAccounts).values({
      id: accountId,
      userId: user.id,
      broker: 'trading212',
      label: 'Trading 212',
      credentialsEncrypted: encryptSecret(JSON.stringify({ keyId: keyId || undefined, secret })),
    });
  });

  await logAudit(db, user.id, 'BROKER_CONNECTED', 'Trading 212');
  revalidatePath('/import');
  redirect(importFeedbackUrl('pripojeno', { accountId }, brokerCardAnchor('trading212')));
}

/** Uloží IBKR Flex přístup (token + query ID, šifrovaně) — jeden IBKR účet na uživatele. */
export async function saveIbkrKeyAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const token = String(formData.get('token') ?? '').trim();
  const queryId = String(formData.get('id-dotazu') ?? '').trim();
  if (token.length < 10 || !/^\d+$/.test(queryId)) redirect('/import?chyba=ibkr');

  const db = await getDb();
  // transakce: pád mezi delete a insert nesmí nechat uživatele bez účtu
  const accountId = crypto.randomUUID();
  await db.transaction(async (tx) => {
    await tx
      .delete(brokerAccounts)
      .where(and(eq(brokerAccounts.userId, user.id), eq(brokerAccounts.broker, 'ibkr')));
    await tx.insert(brokerAccounts).values({
      id: accountId,
      userId: user.id,
      broker: 'ibkr',
      label: 'Interactive Brokers',
      credentialsEncrypted: encryptSecret(JSON.stringify({ token, queryId })),
    });
  });

  await logAudit(db, user.id, 'BROKER_CONNECTED', 'Interactive Brokers');
  revalidatePath('/import');
  redirect(importFeedbackUrl('pripojeno', { accountId }, brokerCardAnchor('ibkr')));
}

/** Odpojí jeden broker účet (multi-broker: každá karta má vlastní tlačítko). */
export async function disconnectBrokerAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const accountId = String(formData.get('ucet') ?? '');
  const db = await getDb();
  const deleted = await db
    .delete(brokerAccounts)
    .where(and(eq(brokerAccounts.userId, user.id), eq(brokerAccounts.id, accountId)))
    .returning({ id: brokerAccounts.id, broker: brokerAccounts.broker });
  // tiché „nic se nesmazalo“ nesmí vypadat jako úspěch (stale formulář apod.)
  if (deleted.length === 0) redirect('/import?chyba=zadny-ucet');
  await logAudit(db, user.id, 'BROKER_DISCONNECTED');
  revalidatePath('/import');
  const removedAccount = deleted[0]!;
  redirect(
    importFeedbackUrl(
      'odpojeno',
      { accountId: removedAccount.id },
      brokerCardAnchor(removedAccount.broker),
    ),
  );
}

/**
 * Ruční synchronizace broker účtu: zapíše background job a hned se vrátí —
 * samotný běh startuje after() po odeslání odpovědi, průběh polluje /import.
 * Chyby běhu končí v jobs.error (viz lib/jobs.ts).
 *
 * Plná historie se do jednoho běhu funkce nevejde: job se pak sám přeruší,
 * vrátí se do fronty (`pending`) a další část se rozjede hned v navazující
 * invokaci /api/cron/jobs.
 */
export async function syncBrokerAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const accountId = String(formData.get('ucet') ?? '');
  const db = await getDb();
  const accounts = await db
    .select()
    .from(brokerAccounts)
    .where(and(eq(brokerAccounts.userId, user.id), eq(brokerAccounts.id, accountId)));
  const account = accounts[0];
  if (!account) redirect('/import?chyba=zadny-ucet');

  const job = await enqueueSyncJob(db, user.id, account.id, jobTypeForBroker(account.broker));
  if (job.status === 'pending') {
    after(async () => {
      const finished = await processJob(db, job.id);
      if (finished?.status === 'pending') {
        continueJobsElsewhere(process.env.BETTER_AUTH_URL ?? 'http://localhost:3000', 0);
      }
    });
  }

  revalidatePath('/import');
  redirect(importFeedbackUrl('spusteno', { jobId: job.id }, brokerCardAnchor(account.broker)));
}
