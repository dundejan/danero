import { sql } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { createPgliteDb, type Db } from '@/db';
import {
  auditLog,
  brokerAccounts,
  notificationPrefs,
  reportPurchases,
  session,
  subscriptions,
  taxpayerProfiles,
  twoFactor,
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
/** Tajemství TOTP a token relace — přístupová tajemství, ne údaje o uživateli. */
const TOTP_TAJEMSTVI = 'JBSWY3DPEHPK3PXP-nikdy-do-exportu';
const ZALOZNI_KODY = 'zalozni-kod-1,zalozni-kod-2';
const TOKEN_RELACE = 'session-token-nikdy-do-exportu';
/** Uschovaný nepřečtený výpis (base64) — u výpisu ze syncu ho uživatel nikdy neměl. */
const OBSAH_VYPISU = Buffer.from('datum;castka\n2026-01-02;100').toString('base64');

interface ExportPayload {
  format: string;
  user: { email: string; name: string; twoFactorEnabled: boolean };
  notificationPrefs: Array<{ emailEnabled: boolean; emailFrequency: string; limitEvents: boolean }>;
  auditLog: Array<{ type: string; detail: string | null }>;
  sessions: Array<{ id: string; ipAddress: string | null; userAgent: string | null }>;
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
  await db
    .insert(user)
    .values({ id: 'u1', name: 'Test', email: 'export@danero.cz', twoFactorEnabled: true });
  await db.insert(taxpayerProfiles).values({ userId: 'u1', regime: 'PAUSAL' });
  await db.insert(notificationPrefs).values({
    userId: 'u1',
    emailEnabled: false,
    limitEvents: false,
    emailFrequency: 'WEEKLY',
  });
  await db.insert(auditLog).values({
    userId: 'u1',
    type: 'LOGIN',
    detail: 'ip=203.0.113.9',
  });
  await db.insert(session).values({
    id: 's1',
    userId: 'u1',
    token: TOKEN_RELACE,
    expiresAt: new Date('2027-01-01T00:00:00Z'),
    ipAddress: '203.0.113.9',
    userAgent: 'Mozilla/5.0 (audit)',
  });
  await db.insert(twoFactor).values({
    id: 'tf1',
    userId: 'u1',
    secret: TOTP_TAJEMSTVI,
    backupCodes: ZALOZNI_KODY,
    verified: true,
  });
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
    lastSyncError: 'T212 vrátilo 429 — export se nestáhl',
    lastReconciliation: { checkedAt: '2026-08-30T10:00:00Z', mismatches: [{ isin: 'US0378331005' }] },
  });
  const { failedImports, importBatches, instrumentPrices, jobs } = await import('@/db/schema');
  await db.insert(importBatches).values({
    id: 'b1',
    userId: 'u1',
    broker: 'trading212',
    filename: 'vypis.csv',
    added: 3,
    duplicates: 0,
    errorCount: 1,
    skippedCount: 0,
    warningCount: 0,
    issues: { errors: [{ row: 7, message: 'Neznámá měna XYZ' }], skipped: [], warnings: [] },
  });
  await db.insert(instrumentPrices).values({
    userId: 'u1',
    isin: 'US0378331005',
    price: '234.56',
    currency: 'USD',
    source: 'trading212',
    asOf: new Date('2026-08-30T10:00:00Z'),
  });
  await db.insert(jobs).values({
    id: 'j1',
    userId: 'u1',
    type: 't212-sync',
    dedupeKey: 'acc1',
    status: 'error',
    payload: { accountId: 'acc1' },
    error: 'rok 2024 se nestáhl',
  });
  await db.insert(failedImports).values({
    id: 'fi1',
    userId: 'u1',
    batchId: 'b2',
    filename: 'neznamy.csv',
    byteSize: 12,
    contentHash: 'hash1',
    content: OBSAH_VYPISU,
    reason: 'Formát souboru nepoznáváme',
    source: 'sync',
    reportedNote: 'Je to export z Portu.',
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

  it('nese nastavení upozornění, audit log i relace (E-40)', { timeout: 30_000 }, async () => {
    stav.db = await seed();
    stav.session = { user: { id: 'u1', email: 'export@danero.cz', name: 'Test' } };

    const { GET } = await import('@/app/api/export/route');
    const payload = (await (
      await GET(new Request('https://danero.cz/api/export'))
    ).json()) as ExportPayload;

    // nastavení upozornění zadal uživatel sám → čl. 20 GDPR (přenositelnost);
    // bez něj by si odnesl data, ale ne to, jak si službu nastavil
    expect(payload.notificationPrefs).toHaveLength(1);
    expect(payload.notificationPrefs[0]).toMatchObject({
      emailEnabled: false,
      limitEvents: false,
      emailFrequency: 'WEEKLY',
    });
    // /soukromi jmenuje audit log i aktivní relace mezi drženými údaji → čl. 15
    expect(payload.auditLog).toHaveLength(1);
    expect(payload.auditLog[0]).toMatchObject({ type: 'LOGIN', detail: 'ip=203.0.113.9' });
    expect(payload.sessions).toHaveLength(1);
    expect(payload.sessions[0]).toMatchObject({
      ipAddress: '203.0.113.9',
      userAgent: 'Mozilla/5.0 (audit)',
    });
    // 2FA jen jako příznak — stav účtu ano, tajemství ne
    expect(payload.user.twoFactorEnabled).toBe(true);
  });

  it('nevydá tajemství 2FA ani token relace', { timeout: 30_000 }, async () => {
    stav.db = await seed();
    stav.session = { user: { id: 'u1', email: 'export@danero.cz', name: 'Test' } };

    const { GET } = await import('@/app/api/export/route');
    const text = await (await GET(new Request('https://danero.cz/api/export'))).text();

    // stažený soubor leží uživateli ve složce Stažené — nesmí to být kopie
    // klíčů od účtu
    expect(text).not.toContain(TOTP_TAJEMSTVI);
    expect(text).not.toContain(ZALOZNI_KODY);
    expect(text).not.toContain(TOKEN_RELACE);
  });

  it('bez přihlášení vrací 401', { timeout: 30_000 }, async () => {
    stav.db = await seed();
    stav.session = null;

    const { GET } = await import('@/app/api/export/route');
    const response = await GET(new Request('https://danero.cz/api/export'));
    expect(response.status).toBe(401);
  });
});

describe('export velké historie se streamuje (G-P4)', () => {
  it(
    'tělo chodí po částech, ne jedním kusem přes limit odpovědi',
    { timeout: 60_000 },
    async () => {
      const db = await seed();
      // Vercel má u NEstreamované odpovědi tvrdý strop 4,5 MB a export stojí
      // ~287 B na transakci — od ~15 700 transakcí by uživatel nedostal nic
      // (FUNCTION_PAYLOAD_TOO_LARGE). 5 000 transakcí je na důkaz dost:
      // původní verze serializovala celý JSON do jednoho řetězce a odeslala
      // ho jako jediný kus.
      await db.execute(sql`
        insert into transactions (user_id, dedupe_key, batch_id, broker, type, tx_date, isin, payload)
        select 'u1', 'dk-' || lpad(g::text, 6, '0'), 'b1', 'trading212', 'BUY',
               '2025-01-02', 'US0378331005',
               jsonb_build_object(
                 'type', 'BUY', 'broker', 'trading212', 'isin', 'US0378331005',
                 'ticker', 'AAPL', 'name', 'Apple Inc.',
                 'tradeDate', '2025-01-02', 'settlementDate', '2025-01-06',
                 'quantity', '1.2345678', 'price', '234.5678', 'currency', 'USD',
                 'fee', '0.15', 'feeCurrency', 'USD', 'note', 'radek ' || g
               )
        from generate_series(1, 5000) g
      `);
      stav.db = db;
      stav.session = { user: { id: 'u1', email: 'export@danero.cz', name: 'Test' } };

      const { GET } = await import('@/app/api/export/route');
      const response = await GET(new Request('https://danero.cz/api/export'));
      expect(response.status).toBe(200);

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      const casti: number[] = [];
      let text = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        casti.push(value.length);
        text += decoder.decode(value, { stream: true });
      }

      // jediný kus = celý dokument v paměti a v jedné odpovědi (stav před opravou)
      expect(casti.length).toBeGreaterThan(1);
      // první kus odchází dřív, než se přečte poslední transakce
      expect(casti[0]!).toBeLessThan(1_000);
      const celkem = casti.reduce((a, b) => a + b, 0);
      expect(celkem).toBeGreaterThan(1_000_000);

      // a pořád je to platný JSON se vším, co v exportu být má
      const payload = JSON.parse(text) as ExportPayload & { transactions: Array<{ note: string }> };
      expect(payload.format).toBe('danero-export-v1');
      expect(payload.transactions).toHaveLength(5000);
      expect(payload.transactions.at(-1)!.note).toBe('radek 5000');
      expect(payload.subscriptions).toHaveLength(1);
      expect(payload.reportPurchases).toHaveLength(1);
    },
  );
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

/**
 * Strážce úplnosti (K4-01, K2-03): do 31. 8. 2026 chyběly v exportu celé
 * tabulky — nepřečtený výpis (tedy obchodní historie, kterou uživatel u výpisu
 * ze syncu nikdy neměl v ruce), úlohy na pozadí, ceny instrumentů, výhrady
 * k řádkům dávky i rekonciliace pozic. Nikdo si toho nevšiml, protože testy
 * kontrolovaly jednotlivé klíče, ne seznam tabulek.
 *
 * Odteď musí být každá tabulka s `user_id` buď v exportu, nebo na seznamu
 * vědomých výjimek — a k výjimce patří důvod.
 */
describe('tabulka ↔ klíč v exportu (K4-01)', () => {
  /** Tabulka ve schématu → klíč, pod kterým její data v exportu leží. */
  const V_EXPORTU: Record<string, string> = {
    user: 'user',
    session: 'sessions',
    taxpayer_profiles: 'profiles',
    tax_year_settings: 'pinnedTaxYears',
    audit_log: 'auditLog',
    notification_prefs: 'notificationPrefs',
    notifications: 'notifications',
    broker_accounts: 'brokerAccounts',
    import_batches: 'importBatches',
    failed_imports: 'failedImports',
    jobs: 'jobs',
    instrument_aliases: 'instrumentAliases',
    instrument_prices: 'instrumentPrices',
    transactions: 'transactions',
    subscriptions: 'subscriptions',
    report_purchases: 'reportPurchases',
  };

  /** Tabulky, které do exportu vědomě NEPATŘÍ — a proč. */
  const MIMO_EXPORT: Record<string, string> = {
    account:
      'otisk hesla a tokeny od poskytovatelů přihlášení — přístupová tajemství, ne údaje o uživateli (E-40)',
    two_factor:
      'tajemství TOTP a záložní kódy — stažený soubor ve složce Stažené by byl kopie klíčů od účtu (E-40)',
  };

  /** Tabulky ze `db/schema.ts`, které visí na uživateli. */
  const tabulkyUzivatele = async (): Promise<string[]> => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const zdroj = readFileSync(join(import.meta.dirname, '..', 'db/schema.ts'), 'utf8');
    // `split` useká každý kus tam, kde začíná další pgTable — tělo tabulky se
    // tedy nemíchá s tělem té následující
    return zdroj
      .split(/pgTable\(\s*'/)
      .slice(1)
      .map((kus) => ({ nazev: kus.slice(0, kus.indexOf("'")), telo: kus }))
      // `user` sám sloupec `user_id` nemá, ale je to tabulka uživatele
      .filter(({ nazev, telo }) => nazev === 'user' || telo.includes("text('user_id')"))
      .map(({ nazev }) => nazev);
  };

  it('žádná tabulka s user_id nechybí v exportu ani na seznamu výjimek', async () => {
    const tabulky = await tabulkyUzivatele();
    // pojistka, že se parser nerozešel se schématem a nekontroluje prázdno
    expect(tabulky.length).toBeGreaterThan(10);

    for (const tabulka of tabulky) {
      const kryta = tabulka in V_EXPORTU || tabulka in MIMO_EXPORT;
      expect(
        kryta,
        `tabulka "${tabulka}" visí na user_id, ale export o ní neví — buď ji doplň do /api/export a do V_EXPORTU, nebo ji dej do MIMO_EXPORT i s důvodem`,
      ).toBe(true);
      expect(tabulka in V_EXPORTU && tabulka in MIMO_EXPORT).toBe(false);
    }

    // a naopak: seznam nesmí zůstat viset po tabulce, která už neexistuje
    for (const tabulka of [...Object.keys(V_EXPORTU), ...Object.keys(MIMO_EXPORT)]) {
      expect(tabulky, `seznam zná tabulku "${tabulka}", ale ve schématu není`).toContain(tabulka);
    }
  });

  it('každý slíbený klíč v odpovědi opravdu je', { timeout: 30_000 }, async () => {
    stav.db = await seed();
    stav.session = { user: { id: 'u1', email: 'export@danero.cz', name: 'Test' } };

    const { GET } = await import('@/app/api/export/route');
    const payload = (await (
      await GET(new Request('https://danero.cz/api/export'))
    ).json()) as Record<string, unknown>;

    for (const klic of Object.values(V_EXPORTU)) {
      expect(payload, `v exportu chybí klíč "${klic}"`).toHaveProperty(klic);
    }
  });

  it('nepřečtený výpis jde ven i s uschovaným originálem', { timeout: 30_000 }, async () => {
    stav.db = await seed();
    stav.session = { user: { id: 'u1', email: 'export@danero.cz', name: 'Test' } };

    const { GET } = await import('@/app/api/export/route');
    const payload = (await (
      await GET(new Request('https://danero.cz/api/export'))
    ).json()) as {
      failedImports: Array<{
        filename: string;
        source: string;
        reportedNote: string | null;
        contentBase64: string | null;
      }>;
    };

    expect(payload.failedImports).toHaveLength(1);
    expect(payload.failedImports[0]).toMatchObject({
      filename: 'neznamy.csv',
      source: 'sync',
      reportedNote: 'Je to export z Portu.',
    });
    // u výpisu staženého ze syncu je tohle JEDINÁ kopie, kterou uživatel má
    expect(payload.failedImports[0]!.contentBase64).toBe(OBSAH_VYPISU);
  });

  it('nese úlohy na pozadí, ceny instrumentů, výhrady k řádkům i rekonciliaci', { timeout: 30_000 }, async () => {
    stav.db = await seed();
    stav.session = { user: { id: 'u1', email: 'export@danero.cz', name: 'Test' } };

    const { GET } = await import('@/app/api/export/route');
    const payload = (await (
      await GET(new Request('https://danero.cz/api/export'))
    ).json()) as {
      jobs: Array<{ type: string; error: string | null }>;
      instrumentPrices: Array<{ isin: string; price: string }>;
      importBatches: Array<{ issues: { errors: Array<{ message: string }> } }>;
      brokerAccounts: Array<{ lastSyncError: string | null; lastReconciliation: unknown }>;
    };

    // „proč se mi rok nestáhl" — odpověď leží jen v jobu
    expect(payload.jobs[0]).toMatchObject({ type: 't212-sync', error: 'rok 2024 se nestáhl' });
    expect(payload.instrumentPrices[0]).toMatchObject({ isin: 'US0378331005', price: '234.56' });
    // „proč se mi ten řádek nenaimportoval" — odpověď leží jen ve výhradách dávky
    expect(payload.importBatches[0]!.issues.errors[0]!.message).toBe('Neznámá měna XYZ');
    expect(payload.brokerAccounts[0]!.lastSyncError).toBe('T212 vrátilo 429 — export se nestáhl');
    expect(payload.brokerAccounts[0]!.lastReconciliation).not.toBeNull();
  });
});
