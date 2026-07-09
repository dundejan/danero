'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { after } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/db';
import { brokerAccounts, taxpayerProfiles } from '@/db/schema';
import { encryptSecret } from '@/lib/crypto';
import { enqueueSyncJob, jobTypeForBroker, processJob } from '@/lib/jobs';
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
  derivativesExpensesPerDruh: z.enum(['restrictive', 'perDruh']),
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
    derivativesExpensesPerDruh: parsed.data.derivativesExpensesPerDruh === 'perDruh',
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

/** Uloží IBKR Flex přístup (token + query ID, šifrovaně) — jeden IBKR účet na uživatele. */
export async function saveIbkrKeyAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const token = String(formData.get('token') ?? '').trim();
  const queryId = String(formData.get('queryId') ?? '').trim();
  if (token.length < 10 || !/^\d+$/.test(queryId)) redirect('/nastaveni?chyba=ibkr');

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

  revalidatePath('/nastaveni');
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
  // tiché „nic se nesmazalo" nesmí vypadat jako úspěch (stale formulář apod.)
  if (deleted.length === 0) redirect('/nastaveni?chyba=zadny-ucet');
  revalidatePath('/nastaveni');
  revalidatePath('/import');
  redirect('/nastaveni');
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
  if (!account) redirect('/nastaveni?chyba=zadny-ucet');

  const job = await enqueueSyncJob(db, user.id, account.id, jobTypeForBroker(account.broker));
  if (job.status === 'pending') {
    after(() => processJob(db, job.id));
  }

  revalidatePath('/import');
  redirect('/import');
}
