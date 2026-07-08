'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { importBatches } from '@/db/schema';
import { importFile } from '@/lib/import-service';
import { saveAliases, type AliasInput } from '@/lib/instrument-aliases';
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
export async function saveAliasesAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const count = Number(formData.get('count') ?? 0);
  const rows: AliasInput[] = [];
  for (let i = 0; i < count; i += 1) {
    const broker = String(formData.get(`broker-${i}`) ?? '');
    const symbol = String(formData.get(`symbol-${i}`) ?? '');
    const isin = String(formData.get(`isin-${i}`) ?? '').trim().toUpperCase();
    const currency = String(formData.get(`currency-${i}`) ?? '').trim().toUpperCase();
    if (!broker || !symbol) continue;
    if (isin === '' && currency === '') continue; // nevyplněný řádek přeskoč
    if (!ISIN_RE.test(isin)) redirect('/import?chyba=isin');
    if (currency !== '' && !CURRENCY_RE.test(currency)) redirect('/import?chyba=mena');
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
