import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createPgliteDb, type Db } from '@/db';
import { notifications, taxpayerProfiles, taxYearSettings, user } from '@/db/schema';
import {
  dropStaleLimitNotifications,
  profileAffectsCalculations,
} from '@/lib/profile-changes';

/**
 * K2-02: uložená upozornění hlídače po změně profilu.
 *
 * Scénář z auditu: uživatel zadá „další zdanitelné příjmy 80 000", hlídač
 * pošle „Prolomen limit 50 000 Kč", uživatel zjistí, že se spletl, a příjmy
 * vynuluje. Toast tvrdí „Uloženo. Výpočty se přepočítají podle nového profilu."
 *
 * Naměřeno bylo dvojí: přehled hlásil prolomený limit dál, a hlavně v tabulce
 * zůstal dedupe klíč `limit|50k|…|<rok>` s vyplněným `emailedAt` — takže až
 * limit padne doopravdy, e-mail nepřijde. Třetí běh cronu po skutečném
 * prolomení vrátil `{"created":0,"emailed":0}`.
 */
const VALUES = {
  regime: 'PAUSAL',
  hasBusinessAssets: false,
  otherIncomeCzk: '0',
  matchingMethod: 'FIFO',
  fxMethod: 'UNIFIED',
  limit100kStrict: true,
  timeTestBasis: 'settlement',
  derivativesExpensesPerType: false,
  emtTimeTestExempt: false,
  returnOfCapitalReducesBasis: false,
  updatedAt: new Date(),
};

async function setup(db: Db): Promise<void> {
  await db.insert(user).values({ id: 'u1', name: 'Test', email: 'profil@danero.cz' });
  await db.insert(taxpayerProfiles).values({ userId: 'u1', ...VALUES, otherIncomeCzk: '80000' });
  await db.insert(notifications).values([
    {
      userId: 'u1',
      dedupeKey: 'limit|50k|EXCEEDED|2026',
      type: 'LIMIT_EXCEEDED',
      title: 'Prolomen limit 50 000 Kč',
      body: 'x',
      emailedAt: new Date('2026-07-01T10:00:00Z'),
    },
    {
      userId: 'u1',
      dedupeKey: 'limit|100k|WARNING|2026',
      type: 'LIMIT_WARNING',
      title: 'Za polovinou',
      body: 'x',
    },
    // kalendářní událost na profilu nezávisí — musí přežít
    {
      userId: 'u1',
      dedupeKey: 'termin|elektronicky|2026',
      type: 'DEADLINE',
      title: 'Blíží se termín',
      body: 'x',
      emailedAt: new Date('2026-04-01T10:00:00Z'),
    },
  ]);
}

const keysOf = async (db: Db): Promise<string[]> =>
  (await db.select().from(notifications).where(eq(notifications.userId, 'u1')))
    .map((row) => row.dedupeKey)
    .sort();

describe('změna daňového profilu × uložená upozornění (K2-02)', () => {
  it('smaže limitová upozornění, kalendářní nechá', { timeout: 30_000 }, async () => {
    const db = await createPgliteDb();
    await setup(db);

    expect(await dropStaleLimitNotifications(db, 'u1')).toBe(2);
    expect(await keysOf(db)).toEqual(['termin|elektronicky|2026']);
  });

  it('zafixovaný rok se nemaže — jeho čísla se změnou profilu nemění', {
    timeout: 30_000,
  }, async () => {
    const db = await createPgliteDb();
    await setup(db);
    await db.insert(taxYearSettings).values({
      userId: 'u1',
      taxYear: 2026,
      matchingMethod: 'FIFO',
      fxMethod: 'UNIFIED',
      limit100kStrict: true,
    });

    expect(await dropStaleLimitNotifications(db, 'u1')).toBe(0);
    expect(await keysOf(db)).toHaveLength(3);
  });

  it('uložení, které nic nezměnilo, se do tabulky nesahá (auto-save)', async () => {
    const previous = { userId: 'u1', ...VALUES } as never;
    expect(profileAffectsCalculations(previous, VALUES)).toBe(false);
    expect(profileAffectsCalculations(previous, { ...VALUES, otherIncomeCzk: '80000' })).toBe(
      true,
    );
    expect(profileAffectsCalculations(previous, { ...VALUES, regime: 'OSVC' })).toBe(true);
    // první uložení profilu nemá co zneplatňovat
    expect(profileAffectsCalculations(undefined, VALUES)).toBe(false);
  });
});
