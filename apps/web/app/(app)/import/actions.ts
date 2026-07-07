'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { importBatches } from '@/db/schema';
import { importCsvText } from '@/lib/import-service';
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
    await importCsvText(db, user.id, file.name, await file.text());
  }

  revalidatePath('/prehled');
  revalidatePath('/import');
  redirect('/import');
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
