import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createPgliteDb } from '@/db';
import { brokerAccounts, user } from '@/db/schema';
import { historyScopeText } from '@/lib/broker-sync';
import { decryptSecret, encryptSecret } from '@/lib/crypto';
import { loadTransactions } from '@/lib/portfolio';
import { syncTrading212 } from '@/lib/t212-sync';
import { makeMockFetch, MOCK_CREDENTIALS as CREDENTIALS } from './t212-mock';

describe('šifrování API klíčů (AES-256-GCM)', () => {
  it('round-trip a integrita (pozměněný ciphertext neprojde)', () => {
    const encrypted = encryptSecret('tajny-api-klic-123');
    expect(encrypted).not.toContain('tajny');
    expect(decryptSecret(encrypted)).toBe('tajny-api-klic-123');

    const [v, iv, tag, data] = encrypted.split('.');
    const tampered = [v, iv, tag, data!.slice(0, -4) + 'AAAA'].join('.');
    expect(() => decryptSecret(tampered)).toThrow();
    expect(() => decryptSecret('nesmysl')).toThrow();
  });
});

describe('syncTrading212 (mock API, in-memory PGlite)', () => {
  it(
    'první sync projde roky od založení účtu, další už jen běžný rok',
    { timeout: 30_000 },
    async () => {
      const db = await createPgliteDb();
      await db.insert(user).values({ id: 'u1', name: 'Test', email: 'sync@danero.cz' });
      await db.insert(brokerAccounts).values({
        id: 'acc1',
        userId: 'u1',
        broker: 'trading212',
        credentialsEncrypted: encryptSecret(CREDENTIALS),
      });
      const account = (await db.select().from(brokerAccounts))[0]!;

      // PLNÝ sync: 2026 (data) → 2025 (prázdný, mezera) → 2024 (data) → 2023+2022 prázdné → stop
      const first = makeMockFetch();
      const outcome = await syncTrading212(db, account, {
        fetchImpl: first.fetchImpl,
        now: new Date('2026-07-07T12:00:00Z'),
        pollIntervalMs: 5,
      });

      expect(first.requestedYears).toEqual([2026, 2025, 2024, 2023, 2022]);
      expect(outcome.yearsCovered).toEqual([2026, 2025, 2024, 2023, 2022]);
      expect(outcome.batches).toHaveLength(2); // prázdné roky nezakládají dávky
      expect(outcome.added).toBe(2);
      expect(outcome.errors).toEqual([]);
      // nákup 100 (2024) − prodej 50 (2026) = 50 ks — sedí s API pozicí
      expect(outcome.reconciliation?.ok).toBe(true);
      expect(outcome.reconciliation?.matchedCount).toBe(1);

      const txs = await loadTransactions(db, 'u1');
      expect(txs).toHaveLength(2);

      const updated = (
        await db.select().from(brokerAccounts).where(eq(brokerAccounts.id, 'acc1'))
      )[0]!;
      expect(updated.lastSyncStatus).toBe('ok');
      expect(updated.lastSyncedAt).not.toBeNull();

      // INKREMENTÁLNÍ sync (lastSyncedAt nastaven): jen běžný rok, dedupe
      const second = makeMockFetch();
      const again = await syncTrading212(db, updated, {
        fetchImpl: second.fetchImpl,
        now: new Date('2026-07-08T12:00:00Z'),
        pollIntervalMs: 5,
      });
      expect(second.requestedYears).toEqual([2026]);
      expect(again.added).toBe(0);
      expect(again.duplicates).toBe(1);
      // pár ID+secret → HTTP Basic prošlo napoprvé
      expect(second.authorizations[0]).toMatch(/^Basic /);
    },
  );

  it(
    'inkrementální sync přes přelom roku dotáhne i ocas předchozího roku',
    { timeout: 30_000 },
    async () => {
      const db = await createPgliteDb();
      await db.insert(user).values({ id: 'u3', name: 'Test', email: 'novyrok@danero.cz' });
      await db.insert(brokerAccounts).values({
        id: 'acc3',
        userId: 'u3',
        broker: 'trading212',
        credentialsEncrypted: encryptSecret(CREDENTIALS),
        // poslední úspěšný sync 31. 12. — obchody z konce roku se do exportu
        // propisují se zpožděním, po Novém roce je musí dotáhnout inkrementál
        lastSyncedAt: new Date('2025-12-31T22:00:00Z'),
        lastSyncStatus: 'ok',
      });
      const account = (await db.select().from(brokerAccounts))[0]!;

      const mock = makeMockFetch();
      await syncTrading212(db, account, {
        fetchImpl: mock.fetchImpl,
        now: new Date('2026-01-02T08:00:00Z'),
        pollIntervalMs: 5,
      });
      expect(mock.requestedYears).toEqual([2026, 2025]);
    },
  );

  // G-1: prázdný export z výpadku generování vypadá stejně jako prázdný rok.
  // Dřív se sync uzavřel jako úspěšný, nastavil lastSyncedAt → další běh byl
  // inkrementální a plná historie se už nikdy nestáhla.
  it(
    'plný sync bez jediné transakce a s nesedícími pozicemi se NEuzavře',
    { timeout: 30_000 },
    async () => {
      const db = await createPgliteDb();
      await db.insert(user).values({ id: 'u4', name: 'Test', email: 'prazdny@danero.cz' });
      await db.insert(brokerAccounts).values({
        id: 'acc4',
        userId: 'u4',
        broker: 'trading212',
        credentialsEncrypted: encryptSecret(CREDENTIALS),
      });
      const account = (await db.select().from(brokerAccounts))[0]!;

      const first = makeMockFetch({ emptyExports: true });
      const outcome = await syncTrading212(db, account, {
        fetchImpl: first.fetchImpl,
        now: new Date('2026-07-07T12:00:00Z'),
        pollIntervalMs: 5,
      });

      expect(outcome.added).toBe(0);
      // broker hlásí 50 ks AAPL, my nemáme nic → rekonciliace nesedí
      expect(outcome.reconciliation?.ok).toBe(false);

      const updated = (
        await db.select().from(brokerAccounts).where(eq(brokerAccounts.id, 'acc4'))
      )[0]!;
      expect(updated.lastSyncedAt).toBeNull();
      expect(updated.lastSyncStatus).toBe('error');
      expect(updated.lastSyncError).toContain('nepovažujeme za dokončenou');

      // a proto je další běh zase PLNÝ, ne inkrementální
      const second = makeMockFetch();
      await syncTrading212(db, updated, {
        fetchImpl: second.fetchImpl,
        now: new Date('2026-07-08T12:00:00Z'),
        pollIntervalMs: 5,
      });
      expect(second.requestedYears).toEqual([2026, 2025, 2024, 2023, 2022]);
    },
  );

  it(
    'nový účet bez historie (broker taky nic nedrží) se uzavře normálně',
    { timeout: 30_000 },
    async () => {
      const db = await createPgliteDb();
      await db.insert(user).values({ id: 'u5', name: 'Test', email: 'novy@danero.cz' });
      await db.insert(brokerAccounts).values({
        id: 'acc5',
        userId: 'u5',
        broker: 'trading212',
        credentialsEncrypted: encryptSecret(CREDENTIALS),
      });
      const account = (await db.select().from(brokerAccounts))[0]!;

      const mock = makeMockFetch({ emptyExports: true, emptyPortfolio: true });
      const outcome = await syncTrading212(db, account, {
        fetchImpl: mock.fetchImpl,
        now: new Date('2026-07-07T12:00:00Z'),
        pollIntervalMs: 5,
      });
      expect(outcome.reconciliation?.ok).toBe(true);
      const updated = (
        await db.select().from(brokerAccounts).where(eq(brokerAccounts.id, 'acc5'))
      )[0]!;
      expect(updated.lastSyncedAt).not.toBeNull();
      expect(updated.lastSyncStatus).toBe('ok');
    },
  );

  // B-5: rok se dědí jako hotový jen tehdy, když jeho stažení i zpracování
  // doběhlo celé bez výjimky — useknuté CSV se parsuje bez jediné chyby
  it(
    'resume nedědí rok bez značky complete — stáhne ho znovu',
    { timeout: 30_000 },
    async () => {
      const db = await createPgliteDb();
      await db.insert(user).values({ id: 'u6', name: 'Test', email: 'resume@danero.cz' });
      await db.insert(brokerAccounts).values({
        id: 'acc6',
        userId: 'u6',
        broker: 'trading212',
        credentialsEncrypted: encryptSecret(CREDENTIALS),
      });
      const account = (await db.select().from(brokerAccounts))[0]!;
      const syncedAt = new Date('2026-07-01T12:00:00Z');

      const useknuty = makeMockFetch();
      await syncTrading212(db, account, {
        fetchImpl: useknuty.fetchImpl,
        now: new Date('2026-07-07T12:00:00Z'),
        pollIntervalMs: 5,
        mode: 'full',
        resume: {
          syncedAt,
          years: [
            // 2024 doběhl celý → smí se přeskočit
            { year: 2024, status: 'done', added: 1, duplicates: 0, complete: true },
            // 2023 vypadá hotově, ale úplnost potvrzenou nemá → znovu
            { year: 2023, status: 'empty' },
          ],
        },
      });
      expect(useknuty.requestedYears).toContain(2023);
      expect(useknuty.requestedYears).not.toContain(2024);
    },
  );

  // B4-1: přenos exportu se přerušil hned za hlavičkou. Hlavička Content-Length
  // u exportů chybět může, takže ochrana v downloadCsv nemusí zabrat — useknutý
  // rok se pak tvářil jako prázdný, zvýšil počítadlo prázdných let a předčasně
  // ukončil smyčku plné historie. Sync se uzavřel jako ok a další běh už byl
  // inkrementální: chybějící roky se nikdy nedostáhly.
  it(
    'useknutý export (jen hlavička, bez Content-Length) není prázdný rok — sync se neuzavře',
    { timeout: 30_000 },
    async () => {
      const db = await createPgliteDb();
      await db.insert(user).values({ id: 'u10', name: 'Test', email: 'useknuty@danero.cz' });
      await db.insert(brokerAccounts).values({
        id: 'acc10',
        userId: 'u10',
        broker: 'trading212',
        credentialsEncrypted: encryptSecret(CREDENTIALS),
      });
      const account = (await db.select().from(brokerAccounts))[0]!;

      // 2026 data → 2025 USEKNUTÝ (hlavička bez řádků) → 2024 data → 2023, 2022
      // prázdné. Bez pojistky se sync uzavře úplně zeleně (pozice 50 ks sedí),
      // nastaví lastSyncedAt — a rok 2025 se už nikdy nedostáhne.
      const truncated = makeMockFetch({ truncatedYears: [2025] });
      await expect(
        syncTrading212(db, account, {
          fetchImpl: truncated.fetchImpl,
          now: new Date('2026-07-07T12:00:00Z'),
          pollIntervalMs: 5,
        }),
      ).rejects.toThrow(/dorazil poškozený/);

      const updated = (
        await db.select().from(brokerAccounts).where(eq(brokerAccounts.id, 'acc10'))
      )[0]!;
      expect(updated.lastSyncedAt).toBeNull();

      // a proto je další běh zase PLNÝ — nákup 100 ks z roku 2024 se dotáhne
      const healthy = makeMockFetch();
      await syncTrading212(db, updated, {
        fetchImpl: healthy.fetchImpl,
        now: new Date('2026-07-08T12:00:00Z'),
        pollIntervalMs: 5,
      });
      expect(healthy.requestedYears).toEqual([2026, 2025, 2024, 2023, 2022]);
      const txs = await loadTransactions(db, 'u10');
      expect(txs.map((tx) => tx.type).sort()).toEqual(['BUY', 'SELL']);
    },
  );

  // B-6: rekonciliace vidí jen OTEVŘENÉ pozice — chybí-li nákup i prodej téhož
  // titulu, zůstatek sedí. Rozsah dat proto musí být součástí výsledku a díra
  // v historii nesmí skončit zeleným „pozice sedí“.
  it(
    'rekonciliace hlásí rozsah dat a stažené roky',
    { timeout: 30_000 },
    async () => {
      const db = await createPgliteDb();
      await db.insert(user).values({ id: 'u7', name: 'Test', email: 'rozsah@danero.cz' });
      await db.insert(brokerAccounts).values({
        id: 'acc7',
        userId: 'u7',
        broker: 'trading212',
        credentialsEncrypted: encryptSecret(CREDENTIALS),
      });
      const account = (await db.select().from(brokerAccounts))[0]!;

      const mock = makeMockFetch();
      const outcome = await syncTrading212(db, account, {
        fetchImpl: mock.fetchImpl,
        now: new Date('2026-07-07T12:00:00Z'),
        pollIntervalMs: 5,
      });

      const coverage = outcome.reconciliation?.coverage;
      expect(coverage).toBeDefined();
      expect(coverage!.firstYear).toBe(2024);
      expect(coverage!.lastYear).toBe(2026);
      // 2025 nemá transakce, ale sync ho stáhl → ověřeně prázdný, ne díra
      expect(coverage!.syncedYears).toEqual([2022, 2023, 2024, 2025, 2026]);
      expect(coverage!.missingYears).toEqual([]);
      expect(coverage!.historyBeforeFirstBuyMissing).toBe(false);
      expect(outcome.reconciliation?.ok).toBe(true);
    },
  );

  it(
    'prodej bez evidovaného nákupu → „pozice sedí“ se nezobrazí, stav řekne proč',
    { timeout: 30_000 },
    async () => {
      const db = await createPgliteDb();
      await db.insert(user).values({ id: 'u8', name: 'Test', email: 'neuplna@danero.cz' });
      await db.insert(brokerAccounts).values({
        id: 'acc8',
        userId: 'u8',
        broker: 'trading212',
        credentialsEncrypted: encryptSecret(CREDENTIALS),
      });
      const account = (await db.select().from(brokerAccounts))[0]!;

      // export jen za běžný rok = samotný prodej 50 ks bez předchozího nákupu
      // (historie k prvnímu nákupu nesahá — přesně scénář B-6)
      const onlySell = makeMockFetch({ onlyYears: [2026] });
      const outcome = await syncTrading212(db, account, {
        fetchImpl: onlySell.fetchImpl,
        now: new Date('2026-07-07T12:00:00Z'),
        pollIntervalMs: 5,
      });

      const coverage = outcome.reconciliation?.coverage;
      expect(coverage!.historyBeforeFirstBuyMissing).toBe(true);
      expect(coverage!.incompleteIsins).toEqual(['US0378331005']);
      expect(outcome.reconciliation?.ok).toBe(false);
    },
  );

  it(
    'když historie nesahá k prvnímu nákupu ani po plném syncu, stav to řekne',
    { timeout: 30_000 },
    async () => {
      const db = await createPgliteDb();
      await db.insert(user).values({ id: 'u9', name: 'Test', email: 'diry@danero.cz' });
      await db.insert(brokerAccounts).values({
        id: 'acc9',
        userId: 'u9',
        broker: 'trading212',
        credentialsEncrypted: encryptSecret(CREDENTIALS),
      });
      const account = (await db.select().from(brokerAccounts))[0]!;

      const mock = makeMockFetch({ onlyYears: [2026] });
      await syncTrading212(db, account, {
        fetchImpl: mock.fetchImpl,
        now: new Date('2026-07-07T12:00:00Z'),
        pollIntervalMs: 5,
      });

      const updated = (
        await db.select().from(brokerAccounts).where(eq(brokerAccounts.id, 'acc9'))
      )[0]!;
      const stored = updated.lastReconciliation as { ok: boolean; coverage?: { firstYear: number } };
      expect(stored.ok).toBe(false);
      expect(stored.coverage?.firstYear).toBe(2026);
    },
  );

  // B4-3: smyčka plné historie se zastaví po dvou prázdných letech. Kdo si dal
  // v obchodování pauzu, má pod tou hranicí celý nezkontrolovaný rok — a protože
  // se rozsah dat počítal z toho, co JE staženo, díra o sobě nedala vědět.
  it(
    'plná historie zastavená na dvou prázdných letech řekne, odkud vlastně data má',
    { timeout: 30_000 },
    async () => {
      const db = await createPgliteDb();
      await db.insert(user).values({ id: 'u11', name: 'Test', email: 'pauza@danero.cz' });
      await db.insert(brokerAccounts).values({
        id: 'acc11',
        userId: 'u11',
        broker: 'trading212',
        credentialsEncrypted: encryptSecret(CREDENTIALS),
      });
      const account = (await db.select().from(brokerAccounts))[0]!;

      // data jen za 2026, 2025 i 2024 prázdné → smyčka končí na 2024,
      // roky 2023 a starší se NIKDY nevyžádaly (uživatel v nich obchodovat mohl)
      const mock = makeMockFetch({ onlyYears: [2026] });
      const outcome = await syncTrading212(db, account, {
        fetchImpl: mock.fetchImpl,
        now: new Date('2026-07-07T12:00:00Z'),
        pollIntervalMs: 5,
      });

      expect(mock.requestedYears).toEqual([2026, 2025, 2024]);
      const coverage = outcome.reconciliation?.coverage;
      expect(coverage!.checkedFromYear).toBe(2024);
      expect(historyScopeText(coverage!)).toMatch(/od roku 2024/);
    },
  );

  it(
    'historie dotažená až na začátek nabídky brokera se na starší roky neptá',
    { timeout: 30_000 },
    async () => {
      const db = await createPgliteDb();
      await db.insert(user).values({ id: 'u12', name: 'Test', email: 'zacatek@danero.cz' });
      await db.insert(brokerAccounts).values({
        id: 'acc12',
        userId: 'u12',
        broker: 'trading212',
        credentialsEncrypted: encryptSecret(CREDENTIALS),
      });
      const account = (await db.select().from(brokerAccounts))[0]!;

      // rok 2017: smyčka dojde na 2016 (dřív T212 Invest neexistovalo) —
      // pod ním už žádná nezkontrolovaná historie být nemůže
      const mock = makeMockFetch({ onlyYears: [], emptyPortfolio: true });
      const outcome = await syncTrading212(db, account, {
        fetchImpl: mock.fetchImpl,
        now: new Date('2017-07-07T12:00:00Z'),
        pollIntervalMs: 5,
      });

      expect(mock.requestedYears).toEqual([2017, 2016]);
      expect(outcome.reconciliation?.coverage?.checkedFromYear).toBeUndefined();
      expect(historyScopeText(outcome.reconciliation!.coverage!)).toBeNull();
    },
  );

  it(
    'když API odmítne Basic (401), spadne se na samotný tajný klíč',
    { timeout: 30_000 },
    async () => {
      const db = await createPgliteDb();
      await db.insert(user).values({ id: 'u2', name: 'Test', email: 'fallback@danero.cz' });
      await db.insert(brokerAccounts).values({
        id: 'acc2',
        userId: 'u2',
        broker: 'trading212',
        credentialsEncrypted: encryptSecret(CREDENTIALS),
      });
      const account = (await db.select().from(brokerAccounts))[0]!;

      const mock = makeMockFetch({ rejectBasicAuth: true });
      const outcome = await syncTrading212(db, account, {
        fetchImpl: mock.fetchImpl,
        now: new Date('2026-07-07T12:00:00Z'),
        pollIntervalMs: 5,
      });
      expect(outcome.added).toBe(2);
      // po 401 na Basic pokračují všechna volání se samotným tajným klíčem
      const lastAuth = mock.authorizations[mock.authorizations.length - 1];
      expect(lastAuth).toBe('mock-secret-456789');
    },
  );

  /**
   * K5-09 + K5-10: `catch` kolem rekonciliace chytá i `TypeError`, takže když
   * broker změní tvar odpovědi, doputuje do UI surová anglická hláška runtime.
   * Naměřeno v auditu: `lastSyncError: 'positions is not iterable'` — text, ze
   * kterého uživatel nepozná, jestli má něco udělat, počkat, nebo napsat nám.
   * Stažení transakcí přitom proběhlo, takže sync sám je v pořádku.
   */
  it(
    'změněný tvar odpovědi brokera skončí českou hláškou, ne „is not iterable“',
    { timeout: 30_000 },
    async () => {
      const db = await createPgliteDb();
      await db.insert(user).values({ id: 'u9', name: 'Test', email: 'tvar@danero.cz' });
      await db.insert(brokerAccounts).values({
        id: 'acc9',
        userId: 'u9',
        broker: 'trading212',
        credentialsEncrypted: encryptSecret(CREDENTIALS),
      });
      const account = (await db.select().from(brokerAccounts))[0]!;

      const mock = makeMockFetch({ malformedPortfolio: true });
      const outcome = await syncTrading212(db, account, {
        fetchImpl: mock.fetchImpl,
        now: new Date('2026-07-07T12:00:00Z'),
        pollIntervalMs: 5,
      });
      // transakce se stáhly — vadná je jen kontrola pozic
      expect(outcome.added).toBe(2);

      const updated = (
        await db.select().from(brokerAccounts).where(eq(brokerAccounts.id, 'acc9'))
      )[0]!;
      expect(updated.lastSyncError).toBeTruthy();
      expect(updated.lastSyncError).not.toMatch(/is not iterable|is not a function|TypeError/);
      expect(updated.lastSyncError).toContain('v jiném tvaru');
    },
  );
});

/**
 * K6a-12: příznak „nepoznaný export už jsme si schovali“ se nastavoval bez
 * ohledu na to, jestli se uschování povedlo.
 *
 * Naměřeno v auditu: export 2026 o 10,3 MB odmítne strop velikosti
 * (`failed_import.too_large`), neuloží se nic — ale příznak se nastavil, takže
 * malý nepoznaný export za 2025 se už nezkusil a běh skončil s nulou vzorků.
 * Přitom je to přesně situace, kvůli které se ta záchrana stavěla: přejmenovaný
 * sloupec propadne u KAŽDÉHO roku a u aktivního obchodníka je ten největší
 * export vždycky ten letošní.
 */
describe('nepoznaný export ze syncu: neúspěšné uschování nespálí pokus (K6a-12)', () => {
  it(
    'obří rok se neuschová, menší rok ano',
    { timeout: 30_000 },
    async () => {
      const db = await createPgliteDb();
      await db.insert(user).values({ id: 'u-keep', name: 'Test', email: 'keep@danero.cz' });
      await db.insert(brokerAccounts).values({
        id: 'acc-keep',
        userId: 'u-keep',
        broker: 'trading212',
        credentialsEncrypted: encryptSecret(CREDENTIALS),
      });
      const account = (await db.select().from(brokerAccounts))[0]!;

      // 2026 přes strop 8 MB, 2025 malý — obojí s hlavičkou, kterou neznáme
      const mock = makeMockFetch({
        unrecognizedYears: { 2026: 9 * 1024 * 1024, 2025: 10 },
      });
      await syncTrading212(db, account, {
        fetchImpl: mock.fetchImpl,
        now: new Date('2026-07-07T12:00:00Z'),
        pollIntervalMs: 5,
      });

      const { listOpenCases } = await import('@/lib/failed-imports');
      const cases = await listOpenCases(db);
      expect(cases).toHaveLength(1);
      expect(cases[0]!.filename).toBe('t212-api-2025.csv');
    },
  );
});
