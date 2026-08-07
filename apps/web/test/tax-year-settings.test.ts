import { describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { d, parseTransactions, type IsoDate, type Money } from '@danero/shared';
import { analyzeTaxYear, type EngineInput } from '@danero/engine';
import { createPgliteDb, type Db } from '@/db';
import { taxpayerProfiles, taxYearSettings, user } from '@/db/schema';
import { pinnedMethodNote } from '@/components/views/report-view';
import {
  analyzeForUser,
  dailyRatesForProfile,
  engineInputForUser,
  getProfile,
  isPinnableTaxYear,
  listPinnedTaxYears,
  pinTaxYear,
  taxYearOptions,
  unpinTaxYear,
  type ProfileRow,
} from '@/lib/portfolio';

/**
 * Mock denních kurzů ČNB (žádná síť): USD za 30 Kč se od jednotného kurzu
 * (2024: 23,26; 2025: 21,84) liší tak, že je na výsledku hned vidět, kterou
 * soustavou se počítalo. Potřebuje ho jen test `dailyRatesForProfile`.
 */
vi.mock('@/lib/cnb', async () => {
  const { d: dec } = await import('@danero/shared');
  return {
    ensureCnbYears: vi.fn(async () => {}),
    loadCnbRateProvider: vi.fn(async () => ({
      isEmpty: false,
      getRate: (currency: string) => (currency === 'USD' ? dec('30') : undefined),
    })),
  };
});

/**
 * R-05c/R-06/R-02c: konfigurace se per rok fixuje ve chvíli, kdy si uživatel
 * za ten rok vygeneruje podklady k přiznání — pozdější změna v profilu už
 * uzavřený rok nesmí přepočítat (zákon žádá průkaznost a konzistenci a čísla
 * v odeslaném přiznání se nesmí měnit pod rukama).
 *
 * Scénář: dva stejně velké nákupy za různé ceny (2024) a jeden prodej celé
 * první poloviny v roce 2025. FIFO uplatní levné kusy (vyšší základ), LIFO
 * ty drahé (nižší základ) — čísla se tedy musí lišit, jinak by test nic
 * neověřoval. Tržba je nad 100 000 Kč, aby prodej nespadl do osvobozeného
 * úhrnu (R-02) a základ nebyl u obou metod nula. Měna USD dělá totéž pro
 * kurzovou soustavu: jednotný kurz vs. denní kurz ČNB.
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

/**
 * Data pro sporný výklad R-02c (co se počítá do úhrnu 100 000 Kč). Vše v CZK,
 * ať do výsledku nemluví kurzy. Prodej A je osvobozený časovým testem
 * (nákup 2019), prodej B ne a sám o sobě se do 100 000 Kč vejde:
 *   - bezpečný výklad: úhrn = 500 000 + 90 000 → osvobození do 100k nenáleží
 *     a základ z prodeje B je 90 000 − 40 000 = 50 000 Kč,
 *   - mírnější výklad: úhrn = jen 90 000 → prodej B je osvobozený, základ 0.
 */
const LIMIT_TXS = parseTransactions([
  {
    type: 'BUY',
    id: 'la',
    isin: 'CZ0000000001',
    quantity: '100',
    pricePerShare: '1000',
    currency: 'CZK',
    tradeDate: '2019-01-10',
    settlementDate: '2019-01-14',
  },
  {
    type: 'SELL',
    id: 'lb',
    isin: 'CZ0000000001',
    quantity: '100',
    pricePerShare: '5000',
    currency: 'CZK',
    tradeDate: '2025-03-03',
    settlementDate: '2025-03-05',
  },
  {
    type: 'BUY',
    id: 'lc',
    isin: 'CZ0000000002',
    quantity: '100',
    pricePerShare: '400',
    currency: 'CZK',
    tradeDate: '2024-05-02',
    settlementDate: '2024-05-06',
  },
  {
    type: 'SELL',
    id: 'ld',
    isin: 'CZ0000000002',
    quantity: '100',
    pricePerShare: '900',
    currency: 'CZK',
    tradeDate: '2025-09-01',
    settlementDate: '2025-09-03',
  },
]);

/** Denní kurzy ČNB pro výpočet v testu — USD za 30 Kč, ostatní měny nemáme. */
const DAILY: EngineInput['dailyRates'] = {
  getRate: (currency: string, _date: IsoDate): Money | undefined =>
    currency === 'USD' ? d('30') : undefined,
};

/** Uživatel s profilem — přepínače dle zadání. */
async function seed(
  db: Db,
  values: Partial<typeof taxpayerProfiles.$inferInsert> = {},
): Promise<ProfileRow> {
  await db.insert(user).values({ id: 'u1', name: 'Test', email: 'test@danero.cz' });
  await db.insert(taxpayerProfiles).values({ userId: 'u1', regime: 'PAUSAL', ...values });
  return (await getProfile(db, 'u1'))!;
}

const base10 = (
  profile: ProfileRow,
  year: number,
  txs = TXS,
  dailyRates?: EngineInput['dailyRates'],
): string => analyzeTaxYear(engineInputForUser(txs, profile, year, dailyRates)).securities.base10Czk.toString();

/** Změna profilu v DB + znovunačtení (fixace se musí načíst z databáze). */
async function updateProfile(
  db: Db,
  values: Partial<typeof taxpayerProfiles.$inferInsert>,
): Promise<ProfileRow> {
  await db.update(taxpayerProfiles).set(values).where(eq(taxpayerProfiles.userId, 'u1'));
  return (await getProfile(db, 'u1'))!;
}

describe('fixace konfigurace daňového roku (R-05c)', () => {
  it('zafixovaný rok se počítá původní metodou párování i po přepnutí profilu', { timeout: 30_000 }, async () => {
    const db = await createPgliteDb();
    const profile = await seed(db, { matchingMethod: 'LIFO' });

    // uživatel si v roce 2026 vygeneroval podklady za 2025 → konfigurace se fixuje
    const pinned = await pinTaxYear(db, profile, 2025, 2026);
    expect(pinned.pinnedTaxYears?.[2025]?.matchingMethod).toBe('LIFO');
    const lifoBase = base10(pinned, 2025);

    // …a pak si v nastavení vybral FIFO
    const afterSwitch = await updateProfile(db, { matchingMethod: 'FIFO' });
    expect(afterSwitch.matchingMethod).toBe('FIFO');

    const result = analyzeTaxYear(engineInputForUser(TXS, afterSwitch, 2025));
    expect(result.options.matchingMethod).toBe('LIFO');
    expect(result.securities.base10Czk.toString()).toBe(lifoBase);

    // kontrola, že se metody v tomhle scénáři vůbec liší (jinak by test lhal)
    const withoutPin: ProfileRow = { ...afterSwitch, pinnedTaxYears: {} };
    expect(base10(withoutPin, 2025)).not.toBe(lifoBase);
  });

  it('zafixovaný rok se počítá původní kurzovou soustavou i po přepnutí profilu (R-06)', { timeout: 30_000 }, async () => {
    const db = await createPgliteDb();
    const profile = await seed(db, { fxMethod: 'UNIFIED' });

    const pinned = await pinTaxYear(db, profile, 2025, 2026);
    expect(pinned.pinnedTaxYears?.[2025]?.fxMethod).toBe('UNIFIED');
    const unifiedBase = base10(pinned, 2025, TXS, DAILY);

    // uživatel přepnul na denní kurzy ČNB — rok 2025 už je ale podaný
    const afterSwitch = await updateProfile(db, { fxMethod: 'CNB_DAILY' });
    expect(afterSwitch.fxMethod).toBe('CNB_DAILY');

    const result = analyzeTaxYear(engineInputForUser(TXS, afterSwitch, 2025, DAILY));
    expect(result.options.fxMethod).toBe('UNIFIED');
    expect(result.securities.base10Czk.toString()).toBe(unifiedBase);

    // bez fixace by týž rok vyšel jinak (jinak by test nic neověřoval):
    // tržba 30 000 USD kurzem 21,84 vs. 30 Kč = rozdíl statisíců
    const withoutPin: ProfileRow = { ...afterSwitch, pinnedTaxYears: {} };
    expect(base10(withoutPin, 2025, TXS, DAILY)).not.toBe(unifiedBase);
  });

  it('zafixovaný rok si drží výklad limitu 100k i po přepnutí profilu (R-02c)', { timeout: 30_000 }, async () => {
    const db = await createPgliteDb();
    const profile = await seed(db, { limit100kStrict: true });

    const pinned = await pinTaxYear(db, profile, 2025, 2026);
    expect(pinned.pinnedTaxYears?.[2025]?.limit100kIncludesTimeTestExempt).toBe(true);
    // bezpečný výklad: 90 000 − 40 000 (osvobození do 100k nenáleží, úhrn je 590 000)
    expect(base10(pinned, 2025, LIMIT_TXS)).toBe('50000');

    const afterSwitch = await updateProfile(db, { limit100kStrict: false });
    const result = analyzeTaxYear(engineInputForUser(LIMIT_TXS, afterSwitch, 2025));
    expect(result.options.limit100kIncludesTimeTestExempt).toBe(true);
    expect(result.securities.base10Czk.toString()).toBe('50000');

    // bez fixace by mírnější výklad prodej osvobodil (úhrn jen 90 000 Kč)
    const withoutPin: ProfileRow = { ...afterSwitch, pinnedTaxYears: {} };
    expect(base10(withoutPin, 2025, LIMIT_TXS)).toBe('0');
  });

  it('fixace zapíše všechny volby, které mění výsledek', { timeout: 30_000 }, async () => {
    const db = await createPgliteDb();
    const profile = await seed(db, {
      matchingMethod: 'MAX_LOSS',
      fxMethod: 'CNB_DAILY',
      limit100kStrict: false,
    });

    await pinTaxYear(db, profile, 2025, 2026);

    const [row] = await listPinnedTaxYears(db, 'u1');
    expect(row).toMatchObject({
      taxYear: 2025,
      matchingMethod: 'MAX_LOSS',
      fxMethod: 'CNB_DAILY',
      limit100kStrict: false,
    });
    expect(taxYearOptions((await getProfile(db, 'u1'))!, 2025)).toEqual({
      matchingMethod: 'MAX_LOSS',
      fxMethod: 'CNB_DAILY',
      limit100kIncludesTimeTestExempt: false,
    });
  });

  it('denní kurzy se načtou i profilu s jednotným kurzem, když je má zafixovaný rok', { timeout: 30_000 }, async () => {
    const db = await createPgliteDb();
    const profile = await seed(db, { fxMethod: 'CNB_DAILY' });
    await pinTaxYear(db, profile, 2025, 2026);
    const afterSwitch = await updateProfile(db, { fxMethod: 'UNIFIED' });

    // bez tohohle by engine u zafixovaného roku sáhl po denním kurzu, žádný
    // nenašel a potichu dosadil jednotný (FxConverter má fallback) — tedy jiná
    // čísla, než jaká uživatel podal
    const rates = await dailyRatesForProfile(db, TXS, afterSwitch, 2026);
    expect(rates).toBeDefined();
    expect(rates!.getRate('USD', '2025-06-11')?.toString()).toBe('30');

    // uživatel bez jediné fixace na denní kurzy si backfill platit nemá
    const noPins: ProfileRow = { ...afterSwitch, pinnedTaxYears: {} };
    await expect(dailyRatesForProfile(db, TXS, noPins, 2026)).resolves.toBeUndefined();
  });

  it('přehled i report berou pro zafixovaný rok stejnou konfiguraci', { timeout: 30_000 }, async () => {
    const db = await createPgliteDb();
    const profile = await seed(db, { matchingMethod: 'LIFO' });
    await pinTaxYear(db, profile, 2025, 2026);
    const fresh = await updateProfile(db, { matchingMethod: 'MAX_PROFIT', fxMethod: 'CNB_DAILY' });

    // /prehled a /portfolio jdou přes analyzeForUser, /report přes engineInputForUser
    const prehled = analyzeForUser(TXS, fresh, 2025, '2025-12-31', DAILY);
    const report = analyzeTaxYear(engineInputForUser(TXS, fresh, 2025, DAILY));
    expect(prehled.result.options.matchingMethod).toBe('LIFO');
    expect(prehled.result.options.fxMethod).toBe('UNIFIED');
    expect(prehled.result.securities.base10Czk.toString()).toBe(
      report.securities.base10Czk.toString(),
    );
  });

  it('další generování podkladů fixaci nepřepíše (idempotence)', { timeout: 30_000 }, async () => {
    const db = await createPgliteDb();
    const profile = await seed(db, { matchingMethod: 'LIFO' });
    await pinTaxYear(db, profile, 2025, 2026);
    const [first] = await listPinnedTaxYears(db, 'u1');

    const changed = await updateProfile(db, {
      matchingMethod: 'FIFO',
      fxMethod: 'CNB_DAILY',
      limit100kStrict: false,
    });
    const second = await pinTaxYear(db, changed, 2025, 2026);

    const rows = await listPinnedTaxYears(db, 'u1');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      matchingMethod: 'LIFO',
      fxMethod: 'UNIFIED',
      limit100kStrict: true,
    });
    expect(rows[0]!.pinnedAt.getTime()).toBe(first!.pinnedAt.getTime());
    expect(second.pinnedTaxYears?.[2025]?.matchingMethod).toBe('LIFO');

    // ani volající, který fixace vůbec nenačetl (profil bez `pinnedTaxYears`),
    // nesmí uložené hodnoty přepsat — jinak by je jedno zapomenuté místo v kódu
    // tiše přeplo na aktuální profil
    const blind: ProfileRow = { ...changed, pinnedTaxYears: undefined };
    await pinTaxYear(db, blind, 2025, 2026);
    expect((await listPinnedTaxYears(db, 'u1'))[0]).toMatchObject({
      matchingMethod: 'LIFO',
      fxMethod: 'UNIFIED',
      limit100kStrict: true,
    });
  });

  it('běžící rok se nefixuje — za neskončený rok se přiznání podat nedá', { timeout: 30_000 }, async () => {
    const db = await createPgliteDb();
    const profile = await seed(db, { matchingMethod: 'LIFO' });

    expect(isPinnableTaxYear(2026, 2026)).toBe(false);
    expect(isPinnableTaxYear(2025, 2026)).toBe(true);

    const after = await pinTaxYear(db, profile, 2026, 2026);
    expect(after.pinnedTaxYears?.[2026]).toBeUndefined();
    expect(await listPinnedTaxYears(db, 'u1')).toHaveLength(0);

    // a rok bez fixace sleduje profil
    const fresh = await updateProfile(db, { matchingMethod: 'FIFO', fxMethod: 'CNB_DAILY' });
    expect(taxYearOptions(fresh, 2026)).toEqual({
      matchingMethod: 'FIFO',
      fxMethod: 'CNB_DAILY',
      limit100kIncludesTimeTestExempt: true,
    });
  });

  it('zrušení fixace vrátí rok ke konfiguraci z profilu a zneplatní cache výsledků', { timeout: 30_000 }, async () => {
    const db = await createPgliteDb();
    const profile = await seed(db, { matchingMethod: 'LIFO' });
    await pinTaxYear(db, profile, 2025, 2026);
    await updateProfile(db, {
      matchingMethod: 'FIFO',
      fxMethod: 'CNB_DAILY',
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    });

    await unpinTaxYear(db, 'u1', 2025);

    const after = (await getProfile(db, 'u1'))!;
    expect(await listPinnedTaxYears(db, 'u1')).toHaveLength(0);
    expect(taxYearOptions(after, 2025)).toEqual({
      matchingMethod: 'FIFO',
      fxMethod: 'CNB_DAILY',
      limit100kIncludesTimeTestExempt: true,
    });
    const options = analyzeTaxYear(engineInputForUser(TXS, after, 2025, DAILY)).options;
    expect(options.matchingMethod).toBe('FIFO');
    expect(options.fxMethod).toBe('CNB_DAILY');
    // otisk cache (lib/engine-cache) stojí na updatedAt — bez posunu by přehled
    // dál servíroval čísla spočítaná zafixovanou konfigurací
    expect(after.updatedAt.getTime()).toBeGreaterThan(new Date('2026-01-01T00:00:00Z').getTime());
  });

  it('fixace je per uživatel — cizí rok se do profilu nepromítne', { timeout: 30_000 }, async () => {
    const db = await createPgliteDb();
    const profile = await seed(db, { matchingMethod: 'LIFO', fxMethod: 'CNB_DAILY' });
    await pinTaxYear(db, profile, 2025, 2026);

    await db.insert(user).values({ id: 'u2', name: 'Druhý', email: 'druhy@danero.cz' });
    await db.insert(taxpayerProfiles).values({ userId: 'u2', regime: 'PAUSAL', matchingMethod: 'FIFO' });
    const other = (await getProfile(db, 'u2'))!;

    expect(other.pinnedTaxYears).toEqual({});
    expect(taxYearOptions(other, 2025)).toEqual({
      matchingMethod: 'FIFO',
      fxMethod: 'UNIFIED',
      limit100kIncludesTimeTestExempt: true,
    });
  });

  it('smazání účtu odnese i jeho fixace (kaskáda)', { timeout: 30_000 }, async () => {
    const db = await createPgliteDb();
    const profile = await seed(db, { matchingMethod: 'LIFO' });
    await pinTaxYear(db, profile, 2025, 2026);

    await db.delete(user).where(eq(user.id, 'u1'));
    expect(await db.select().from(taxYearSettings)).toHaveLength(0);
  });
});

describe('vysvětlení fixace v reportu', () => {
  it('věta pojmenuje rok, VŠECHNY TŘI zafixované volby i důvod — bez žargonu', () => {
    // Zafixované jsou tři věci, ne jen párování: kurzová soustava mění daň víc
    // (rozdíl 28 770 Kč v nálezu A1-02) a výklad limitu 100k překlápí i to,
    // jestli je limit 50k prolomený. Věta o nich musí mluvit taky.
    const note = pinnedMethodNote(2025, {
      matchingMethod: 'LIFO',
      fxMethod: 'CNB_DAILY',
      limit100kIncludesTimeTestExempt: false,
    });
    expect(note).toContain('Rok 2025');
    expect(note).toContain('LIFO');
    expect(note).toContain('denní kurzy ČNB');
    expect(note).toContain('mírnější');
    expect(note).toContain('Nastavení');
  });
});
