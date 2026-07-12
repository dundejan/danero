'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { after } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { brokerAccounts, importBatches } from '@/db/schema';
import { logAudit } from '@/lib/audit';
import { encryptSecret } from '@/lib/crypto';
import { importFile } from '@/lib/import-service';
import { ISIN_ONLY_BROKERS, saveAliases, type AliasInput } from '@/lib/instrument-aliases';
import { enqueueSyncJob, jobTypeForBroker, processJob } from '@/lib/jobs';
import { requireUser } from '@/lib/session';

const MAX_FILE_BYTES = 20 * 1024 * 1024;

export async function uploadImportAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const files = formData
    .getAll('soubory')
    .filter((f): f is File => f instanceof File && f.size > 0);

  if (files.length === 0) redirect('/import?chyba=zadny-soubor');
  if (files.some((f) => f.size > MAX_FILE_BYTES)) redirect('/import?chyba=velikost');

  const db = await getDb();
  const { checkRateLimit } = await import('@/lib/rate-limit');
  if (!(await checkRateLimit(db, `upload:${user.id}`, { max: 30, windowMs: 10 * 60_000 }))) {
    redirect('/import?chyba=limit');
  }
  for (const file of files) {
    await importFile(db, user.id, file.name, await file.arrayBuffer());
  }

  revalidatePath('/prehled');
  revalidatePath('/import');
  redirect('/import');
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

export async function saveAliasesAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  // tvrdý strop a celočíselnost — count je z formuláře (DoS přes Infinity/1e9)
  const rawCount = Number(formData.get('count') ?? 0);
  const count = Number.isInteger(rawCount) ? Math.min(Math.max(rawCount, 0), MAX_ALIAS_ROWS) : 0;
  const rows: AliasInput[] = [];
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
    rows.push({ broker, symbol, isin, ...(currency ? { currency } : {}) });
  }
  if (rows.length > 0) {
    const db = await getDb();
    await saveAliases(db, user.id, rows);
  }
  revalidatePath('/import');
  redirect('/import?ulozeno=ciselnik');
}

/** Smaže záznam o importu z historie — transakce zůstávají (jen úklid logu). */
export async function deleteBatchAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const batchId = String(formData.get('batchId') ?? '');
  if (batchId) {
    const db = await getDb();
    await db
      .delete(importBatches)
      .where(and(eq(importBatches.id, batchId), eq(importBatches.userId, user.id)));
  }
  revalidatePath('/import');
}

/* ── Napojení na brokery (Zdroje dat) ────────────────────────────────────── */

/** Uloží T212 API přístup (ID klíče + tajný klíč, šifrovaně) — jeden účet na uživatele. */
export async function saveTrading212KeyAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const keyId = String(formData.get('keyId') ?? '').trim();
  const secret = String(formData.get('secret') ?? '').trim();
  if (secret.length < 10) redirect('/import?chyba=api-klic');

  const db = await getDb();
  await db
    .delete(brokerAccounts)
    .where(and(eq(brokerAccounts.userId, user.id), eq(brokerAccounts.broker, 'trading212')));
  await db.insert(brokerAccounts).values({
    id: crypto.randomUUID(),
    userId: user.id,
    broker: 'trading212',
    label: 'Trading 212',
    credentialsEncrypted: encryptSecret(JSON.stringify({ keyId: keyId || undefined, secret })),
  });

  await logAudit(db, user.id, 'BROKER_CONNECTED', 'Trading 212');
  revalidatePath('/import');
  redirect('/import');
}

/** Uloží IBKR Flex přístup (token + query ID, šifrovaně) — jeden IBKR účet na uživatele. */
export async function saveIbkrKeyAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const token = String(formData.get('token') ?? '').trim();
  const queryId = String(formData.get('queryId') ?? '').trim();
  if (token.length < 10 || !/^\d+$/.test(queryId)) redirect('/import?chyba=ibkr');

  const db = await getDb();
  await db
    .delete(brokerAccounts)
    .where(and(eq(brokerAccounts.userId, user.id), eq(brokerAccounts.broker, 'ibkr')));
  await db.insert(brokerAccounts).values({
    id: crypto.randomUUID(),
    userId: user.id,
    broker: 'ibkr',
    label: 'Interactive Brokers',
    credentialsEncrypted: encryptSecret(JSON.stringify({ token, queryId })),
  });

  await logAudit(db, user.id, 'BROKER_CONNECTED', 'Interactive Brokers');
  revalidatePath('/import');
  redirect('/import');
}

/** Odpojí jeden broker účet (multi-broker: každá karta má vlastní tlačítko). */
export async function disconnectBrokerAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const accountId = String(formData.get('accountId') ?? '');
  const db = await getDb();
  const deleted = await db
    .delete(brokerAccounts)
    .where(and(eq(brokerAccounts.userId, user.id), eq(brokerAccounts.id, accountId)))
    .returning({ id: brokerAccounts.id });
  // tiché „nic se nesmazalo“ nesmí vypadat jako úspěch (stale formulář apod.)
  if (deleted.length === 0) redirect('/import?chyba=zadny-ucet');
  await logAudit(db, user.id, 'BROKER_DISCONNECTED');
  revalidatePath('/import');
  redirect('/import');
}

/**
 * Ruční synchronizace broker účtu: zapíše background job a hned se vrátí —
 * samotný běh (klidně deset minut) startuje after() po odeslání odpovědi,
 * průběh polluje /import. Chyby běhu končí v jobs.error (viz lib/jobs.ts).
 */
export async function syncBrokerAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const accountId = String(formData.get('accountId') ?? '');
  const db = await getDb();
  const accounts = await db
    .select()
    .from(brokerAccounts)
    .where(and(eq(brokerAccounts.userId, user.id), eq(brokerAccounts.id, accountId)));
  const account = accounts[0];
  if (!account) redirect('/import?chyba=zadny-ucet');

  const job = await enqueueSyncJob(db, user.id, account.id, jobTypeForBroker(account.broker));
  if (job.status === 'pending') {
    after(() => processJob(db, job.id));
  }

  revalidatePath('/import');
  redirect('/import');
}
