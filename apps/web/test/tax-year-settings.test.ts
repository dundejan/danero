import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { parseTransactions } from '@danero/shared';
import { analyzeTaxYear } from '@danero/engine';
import { createPgliteDb, type Db } from '@/db';
import { taxpayerProfiles, taxYearSettings, user } from '@/db/schema';
import { pinnedMethodNote } from '@/components/views/report-view';
import {
  analyzeForUser,
  engineInputForUser,
  getProfile,
  isPinnableTaxYear,
  listPinnedTaxYears,
  matchingMethodForYear,
  pinMatchingMethod,
  unpinMatchingMethod,
  type ProfileRow,
} from '@/lib/portfolio';

/**
 * R-05c: metoda párování se per rok fixuje ve chvíli, kdy si uživatel za ten
 * rok vygeneruje podklady k přiznání — pozdější změna v profilu už uzavřený
 * rok nesmí přepočítat (zákon žádá průkaznost a konzistenci).
 *
 * Scénář: dva stejně velké nákupy za různé ceny (2024) a jeden prodej celé
 * první poloviny v roce 2025. FIFO uplatní levné kusy (vyšší základ), LIFO
 * ty drahé (nižší základ) — čísla se tedy musí lišit, jinak by test nic
 * neověřoval. Tržba je nad 100 000 Kč, aby prodej nespadl do osvobozeného
 * úhrnu (R-02) a základ nebyl u obou metod nula.
 */
const TXS = parseTransactions([
  {
    type: 'BUY',
    id: 'b1',
    isin: 'US0378331005',
    quantity: '100',
    pricePerShare: '100',
    currency: 'USD',
    tradeDate: '2024-03-04',
    settlementDate: '2024-03-06',
  },
  {
    type: 'BUY',
    id: 'b2',
    isin: 'US0378331005',
    quantity: '100',
    pricePerShare: '200',
    currency: 'USD',
    tradeDate: '2024-09-04',
    settlementDate: '2024-09-05',
  },
  {
    type: 'SELL',
    id: 's1',
    isin: 'US0378331005',
    quantity: '100',
    pricePerShare: '300',
    currency: 'USD',
    tradeDate: '2025-06-10',
    settlementDate: '2025-06-11',
  },
]);

/** Uživatel s profilem — metoda párování dle zadání. */
async function seed(db: Db, matchingMethod: string): Promise<ProfileRow> {
  await db.insert(user).values({ id: 'u1', name: 'Test', email: 'test@danero.cz' });
  await db.insert(taxpayerProfiles).values({ userId: 'u1', regime: 'PAUSAL', matchingMethod });
  return (await getProfile(db, 'u1'))!;
}

const base10 = (profile: ProfileRow, year: number): string =>
  analyzeTaxYear(engineInputForUser(TXS, profile, year)).securities.base10Czk.toString();

describe('fixace metody párování per rok (R-05c)', () => {
  it('zafixovaný rok se počítá původní metodou i po přepnutí profilu', { timeout: 30_000 }, async () => {
    const db = await createPgliteDb();
    const profile = await seed(db, 'LIFO');

    // uživatel si v roce 2026 vygeneroval podklady za 2025 → metoda se fixuje
    const pinned = await pinMatchingMethod(db, profile, 2025, 2026);
    expect(pinned.pinnedMatchingMethods?.[2025]).toBe('LIFO');
    const lifoBase = base10(pinned, 2025);

    // …a pak si v nastavení vybral FIFO
    await db
      .update(taxpayerProfiles)
      .set({ matchingMethod: 'FIFO' })
      .where(eq(taxpayerProfiles.userId, 'u1'));
    const afterSwitch = (await getProfile(db, 'u1'))!;
    expect(afterSwitch.matchingMethod).toBe('FIFO');

    const result = analyzeTaxYear(engineInputForUser(TXS, afterSwitch, 2025));
    expect(result.options.matchingMethod).toBe('LIFO');
    expect(result.securities.base10Czk.toString()).toBe(lifoBase);

    // kontrola, že se metody v tomhle scénáři vůbec liší (jinak by test lhal)
    const withoutPin: ProfileRow = { ...afterSwitch, pinnedMatchingMethods: {} };
    expect(base10(withoutPin, 2025)).not.toBe(lifoBase);
  });

  it('přehled i report berou pro zafixovaný rok stejnou metodu', { timeout: 30_000 }, async () => {
    const db = await createPgliteDb();
    const profile = await seed(db, 'LIFO');
    await pinMatchingMethod(db, profile, 2025, 2026);
    await db
      .update(taxpayerProfiles)
      .set({ matchingMethod: 'MAX_PROFIT' })
      .where(eq(taxpayerProfiles.userId, 'u1'));

    const fresh = (await getProfile(db, 'u1'))!;
    // /prehled a /portfolio jdou přes analyzeForUser, /report přes engineInputForUser
    const prehled = analyzeForUser(TXS, fresh, 2025, '2025-12-31');
    const report = analyzeTaxYear(engineInputForUser(TXS, fresh, 2025));
    expect(prehled.result.options.matchingMethod).toBe('LIFO');
    expect(prehled.result.securities.base10Czk.toString()).toBe(
      report.securities.base10Czk.toString(),
    );
  });

  it('další generování podkladů fixaci nepřepíše (idempotence)', { timeout: 30_000 }, async () => {
    const db = await createPgliteDb();
    const profile = await seed(db, 'LIFO');
    await pinMatchingMethod(db, profile, 2025, 2026);
    const [first] = await listPinnedTaxYears(db, 'u1');

    await db
      .update(taxpayerProfiles)
      .set({ matchingMethod: 'FIFO' })
      .where(eq(taxpayerProfiles.userId, 'u1'));
    const second = await pinMatchingMethod(db, (await getProfile(db, 'u1'))!, 2025, 2026);

    const rows = await listPinnedTaxYears(db, 'u1');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.matchingMethod).toBe('LIFO');
    expect(rows[0]!.pinnedAt.getTime()).toBe(first!.pinnedAt.getTime());
    expect(second.pinnedMatchingMethods?.[2025]).toBe('LIFO');

    // ani volající, který fixace vůbec nenačetl (profil bez `pinnedMatchingMethods`),
    // nesmí uloženou metodu přepsat — jinak by ji jedno zapomenuté místo v kódu
    // tiše přeplo na aktuální profil
    const blind: ProfileRow = { ...(await getProfile(db, 'u1'))!, pinnedMatchingMethods: undefined };
    await pinMatchingMethod(db, blind, 2025, 2026);
    expect((await listPinnedTaxYears(db, 'u1'))[0]!.matchingMethod).toBe('LIFO');
  });

  it('běžící rok se nefixuje — za neskončený rok se přiznání podat nedá', { timeout: 30_000 }, async () => {
    const db = await createPgliteDb();
    const profile = await seed(db, 'LIFO');

    expect(isPinnableTaxYear(2026, 2026)).toBe(false);
    expect(isPinnableTaxYear(2025, 2026)).toBe(true);

    const after = await pinMatchingMethod(db, profile, 2026, 2026);
    expect(after.pinnedMatchingMethods?.[2026]).toBeUndefined();
    expect(await listPinnedTaxYears(db, 'u1')).toHaveLength(0);

    // a rok bez fixace sleduje profil
    await db
      .update(taxpayerProfiles)
      .set({ matchingMethod: 'FIFO' })
      .where(eq(taxpayerProfiles.userId, 'u1'));
    expect(matchingMethodForYear((await getProfile(db, 'u1'))!, 2026)).toBe('FIFO');
  });

  it('zrušení fixace vrátí rok k metodě z profilu a zneplatní cache výsledků', { timeout: 30_000 }, async () => {
    const db = await createPgliteDb();
    const profile = await seed(db, 'LIFO');
    await pinMatchingMethod(db, profile, 2025, 2026);
    await db
      .update(taxpayerProfiles)
      .set({ matchingMethod: 'FIFO', updatedAt: new Date('2026-01-01T00:00:00Z') })
      .where(eq(taxpayerProfiles.userId, 'u1'));

    await unpinMatchingMethod(db, 'u1', 2025);

    const after = (await getProfile(db, 'u1'))!;
    expect(await listPinnedTaxYears(db, 'u1')).toHaveLength(0);
    expect(matchingMethodForYear(after, 2025)).toBe('FIFO');
    expect(analyzeTaxYear(engineInputForUser(TXS, after, 2025)).options.matchingMethod).toBe('FIFO');
    // otisk cache (lib/engine-cache) stojí na updatedAt — bez posunu by přehled
    // dál servíroval čísla spočítaná zafixovanou metodou
    expect(after.updatedAt.getTime()).toBeGreaterThan(new Date('2026-01-01T00:00:00Z').getTime());
  });

  it('fixace je per uživatel — cizí rok se do profilu nepromítne', { timeout: 30_000 }, async () => {
    const db = await createPgliteDb();
    const profile = await seed(db, 'LIFO');
    await pinMatchingMethod(db, profile, 2025, 2026);

    await db.insert(user).values({ id: 'u2', name: 'Druhý', email: 'druhy@danero.cz' });
    await db.insert(taxpayerProfiles).values({ userId: 'u2', regime: 'PAUSAL', matchingMethod: 'FIFO' });
    const other = (await getProfile(db, 'u2'))!;

    expect(other.pinnedMatchingMethods).toEqual({});
    expect(matchingMethodForYear(other, 2025)).toBe('FIFO');
  });

  it('smazání účtu odnese i jeho fixace (kaskáda)', { timeout: 30_000 }, async () => {
    const db = await createPgliteDb();
    const profile = await seed(db, 'LIFO');
    await pinMatchingMethod(db, profile, 2025, 2026);

    await db.delete(user).where(eq(user.id, 'u1'));
    expect(await db.select().from(taxYearSettings)).toHaveLength(0);
  });
});

describe('vysvětlení fixace v reportu', () => {
  it('věta pojmenuje rok, metodu i důvod — bez daňového žargonu', () => {
    const note = pinnedMethodNote(2025, 'LIFO');
    expect(note).toContain('Rok 2025');
    expect(note).toContain('LIFO');
    expect(note).toContain('zafixovali jsme ji');
    expect(note).toContain('Nastavení');
  });
});
