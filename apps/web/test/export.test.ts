import { describe, expect, it, vi } from 'vitest';
import { createPgliteDb, type Db } from '@/db';
import {
  brokerAccounts,
  reportPurchases,
  subscriptions,
  taxpayerProfiles,
  user,
} from '@/db/schema';

/**
 * GDPR export (/api/export). Slib na /soukromi zní „odnést si data ve strojově
 * čitelném formátu" — musí v nich tedy být i historie nákupů (nález E-15
 * auditu), a naopak nikdy šifrované klíče k brokerovi.
 */

const stav = vi.hoisted(() => ({
  db: null as unknown as Db,
  session: null as { user: { id: string; email: string; name: string } } | null,
}));

vi.mock('@/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/db')>()),
  getDb: async () => stav.db,
}));
vi.mock('@/lib/auth', () => ({
  getAuth: async () => ({ api: { getSession: async () => stav.session } }),
}));

/** Šifrovaný klíč k brokerovi — v exportu se nesmí objevit ani takhle. */
const SIFROVANY_KLIC = 'gcm:tajny-klic-t212:nikdy-do-exportu';

interface ExportPayload {
  format: string;
  subscriptions: Array<{ status: string; stripeCustomerId: string | null; consentAt: string | null }>;
  reportPurchases: Array<{ taxYear: number; stripePaymentIntentId: string | null }>;
  brokerAccounts: Array<Record<string, unknown>>;
  pinnedTaxYears: Array<{
    taxYear: number;
    matchingMethod: string;
    fxMethod: string;
    limit100kStrict: boolean;
  }>;
}

async function seed(): Promise<Db> {
  const db = await createPgliteDb();
  await db.insert(user).values({ id: 'u1', name: 'Test', email: 'export@danero.cz' });
  await db.insert(taxpayerProfiles).values({ userId: 'u1', regime: 'PAUSAL' });
  const { taxYearSettings } = await import('@/db/schema');
  await db.insert(taxYearSettings).values({
    userId: 'u1',
    taxYear: 2025,
    matchingMethod: 'LIFO',
    fxMethod: 'CNB_DAILY',
    limit100kStrict: false,
  });
  await db.insert(subscriptions).values({
    userId: 'u1',
    status: 'active',
    currentPeriodEnd: new Date('2027-08-07T00:00:00Z'),
    stripeCustomerId: 'cus_test',
    stripeSubscriptionId: 'sub_test',
    promoCode: 'PARTNER20',
    consentAt: new Date('2026-08-07T10:00:00Z'),
  });
  await db.insert(reportPurchases).values({
    userId: 'u1',
    taxYear: 2025,
    stripePaymentIntentId: 'pi_test',
    stripeCustomerId: 'cus_test',
    consentAt: new Date('2026-08-07T10:05:00Z'),
  });
  await db.insert(brokerAccounts).values({
    id: 'acc1',
    userId: 'u1',
    broker: 'trading212',
    label: 'Trading 212',
    credentialsEncrypted: SIFROVANY_KLIC,
  });
  return db;
}

describe('GDPR export dat (/api/export)', () => {
  it('obsahuje předplatné i zaplacené daňové roky (E-15)', { timeout: 30_000 }, async () => {
    stav.db = await seed();
    stav.session = { user: { id: 'u1', email: 'export@danero.cz', name: 'Test' } };

    const { GET } = await import('@/app/api/export/route');
    const response = await GET(new Request('https://danero.cz/api/export'));
    expect(response.status).toBe(200);
    const payload = (await response.json()) as ExportPayload;

    expect(payload.format).toBe('danero-export-v1');
    expect(payload.subscriptions).toHaveLength(1);
    expect(payload.subscriptions[0]!.status).toBe('active');
    expect(payload.subscriptions[0]!.stripeCustomerId).toBe('cus_test');
    // souhlas se zahájením plnění je důkaz k 14denní lhůtě — patří uživateli taky
    expect(payload.subscriptions[0]!.consentAt).not.toBeNull();
    expect(payload.reportPurchases).toHaveLength(1);
    expect(payload.reportPurchases[0]!.taxYear).toBe(2025);
    expect(payload.reportPurchases[0]!.stripePaymentIntentId).toBe('pi_test');
  });

  it('nikdy nevydá šifrované klíče k brokerovi', { timeout: 30_000 }, async () => {
    stav.db = await seed();
    stav.session = { user: { id: 'u1', email: 'export@danero.cz', name: 'Test' } };

    const { GET } = await import('@/app/api/export/route');
    const response = await GET(new Request('https://danero.cz/api/export'));
    const text = await response.text();

    expect(text).not.toContain(SIFROVANY_KLIC);
    expect(text).not.toContain('credentialsEncrypted');
    // účet samotný v exportu je (uživatel má právo vědět, co u nás má připojené)
    expect(text).toContain('trading212');
  });

  it('bez přihlášení vrací 401', { timeout: 30_000 }, async () => {
    stav.db = await seed();
    stav.session = null;

    const { GET } = await import('@/app/api/export/route');
    const response = await GET(new Request('https://danero.cz/api/export'));
    expect(response.status).toBe(401);
  });
});

describe('export a zafixované daňové roky (R-05c)', () => {
  it('nese celou konfiguraci, kterou se počítaly už podané roky', { timeout: 30_000 }, async () => {
    stav.db = await seed();
    stav.session = { user: { id: 'u1', email: 'export@danero.cz', name: 'Test' } };

    const { GET } = await import('@/app/api/export/route');
    const payload = (await (await GET(new Request('https://danero.cz/api/export'))).json()) as ExportPayload;

    // bez toho by z exportu nešlo doložit, čím se počítala už odeslaná čísla —
    // a kurzová soustava s výkladem limitu 100k s nimi hýbou víc než párování
    expect(payload.pinnedTaxYears).toHaveLength(1);
    expect(payload.pinnedTaxYears[0]).toMatchObject({
      taxYear: 2025,
      matchingMethod: 'LIFO',
      fxMethod: 'CNB_DAILY',
      limit100kStrict: false,
    });
  });
});
