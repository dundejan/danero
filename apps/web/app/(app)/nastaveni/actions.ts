'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { after } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/db';
import { brokerAccounts, taxpayerProfiles } from '@/db/schema';
import { encryptSecret } from '@/lib/crypto';
import { enqueueSyncJob, processJob } from '@/lib/jobs';
import { requireUser } from '@/lib/session';

const ProfileFormSchema = z.object({
  regime: z.enum(['PAUSAL', 'ZAMESTNANEC', 'OSVC', 'JINE']),
  hasBusinessAssets: z.literal('on').optional(),
  otherIncomeCzk: z
    .string()
    .transform((v) => v.replace(',', '.').trim() || '0')
    .refine((v) => /^\d+(\.\d{1,2})?$/.test(v), 'Zadej částku v Kč'),
  matchingMethod: z.enum(['FIFO', 'LIFO', 'MAX_PROFIT', 'MAX_LOSS']),
  fxMethod: z.enum(['UNIFIED', 'CNB_DAILY']),
  limit100kStrict: z.enum(['strict', 'lenient']),
  timeTestBasis: z.enum(['settlement', 'trade']),
});

export async function saveProfileAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const parsed = ProfileFormSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) redirect('/nastaveni?chyba=formular');

  const values = {
    regime: parsed.data.regime,
    hasBusinessAssets: parsed.data.hasBusinessAssets === 'on',
    otherIncomeCzk: parsed.data.otherIncomeCzk,
    matchingMethod: parsed.data.matchingMethod,
    fxMethod: parsed.data.fxMethod,
    limit100kStrict: parsed.data.limit100kStrict === 'strict',
    timeTestBasis: parsed.data.timeTestBasis,
    updatedAt: new Date(),
  };

  const db = await getDb();
  await db
    .insert(taxpayerProfiles)
    .values({ userId: user.id, ...values })
    .onConflictDoUpdate({ target: taxpayerProfiles.userId, set: values });

  revalidatePath('/prehled');
  revalidatePath('/nastaveni');
  redirect('/prehled');
}

/** Uloží T212 API přístup (ID klíče + tajný klíč, šifrovaně) — jeden účet na uživatele. */
export async function saveTrading212KeyAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const keyId = String(formData.get('keyId') ?? '').trim();
  const secret = String(formData.get('secret') ?? '').trim();
  if (secret.length < 10) redirect('/nastaveni?chyba=api-klic');

  const db = await getDb();
  await db
    .delete(brokerAccounts)
    .where(and(eq(brokerAccounts.userId, user.id), eq(brokerAccounts.broker, 'trading212')));
  await db.insert(brokerAccounts).values({
    id: crypto.randomUUID(),
    userId: user.id,
    broker: 'trading212',
    credentialsEncrypted: encryptSecret(JSON.stringify({ keyId: keyId || undefined, secret })),
  });

  revalidatePath('/nastaveni');
  revalidatePath('/import');
  redirect('/import');
}

export async function disconnectTrading212Action(): Promise<void> {
  const user = await requireUser();
  const db = await getDb();
  await db
    .delete(brokerAccounts)
    .where(and(eq(brokerAccounts.userId, user.id), eq(brokerAccounts.broker, 'trading212')));
  revalidatePath('/nastaveni');
  revalidatePath('/import');
  redirect('/nastaveni');
}

/**
 * Ruční synchronizace: zapíše background job a hned se vrátí — samotný běh
 * (klidně deset minut) startuje after() po odeslání odpovědi, průběh polluje
 * /import. Chyby běhu končí v jobs.error (viz lib/jobs.ts).
 */
export async function syncTrading212Action(): Promise<void> {
  const user = await requireUser();
  const db = await getDb();
  const accounts = await db
    .select()
    .from(brokerAccounts)
    .where(and(eq(brokerAccounts.userId, user.id), eq(brokerAccounts.broker, 'trading212')));
  const account = accounts[0];
  if (!account) redirect('/nastaveni?chyba=zadny-ucet');

  const job = await enqueueSyncJob(db, user.id, account.id);
  if (job.status === 'pending') {
    after(() => processJob(db, job.id));
  }

  revalidatePath('/import');
  redirect('/import');
}
