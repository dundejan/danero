import { describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { parseTransactions } from '@danero/shared';
import { createPgliteDb, type Db } from '@/db';
import { notifications, taxpayerProfiles, user } from '@/db/schema';
import { importCsvText } from '@/lib/import-service';
import { dailyRatesForProfile, unifiedRatesCover, type ProfileRow } from '@/lib/portfolio';

/**
 * Mock denních kurzů ČNB: žádná síť, žádný backfill — provider vrací pro USD
 * fixní kurz 21 Kč (jednotný kurz 2026 je 20,80 — rozdíl odliší, kterou
 * metodou se počítalo).
 */
vi.mock('@/lib/cnb', async () => {
  const { d } = await import('@danero/shared');
  return {
    ensureCnbYears: vi.fn(async () => {}),
    loadCnbRateProvider: vi.fn(async () => ({
      isEmpty: false,
      getRate: (currency: string) => (currency === 'USD' ? d('21') : undefined),
    })),
  };
});

const profileRow = (fxMethod: 'UNIFIED' | 'CNB_DAILY'): ProfileRow => ({
  userId: 'u1',
  regime: 'PAUSAL',
  hasBusinessAssets: false,
  w8benFiled: true,
  otherIncomeCzk: '0',
  matchingMethod: 'FIFO',
  fxMethod,
  limit100kStrict: true,
  timeTestBasis: 'settlement',
  derivativesExpensesPerType: false,
  emtTimeTestExempt: false,
  returnOfCapitalReducesBasis: false,
  createdAt: new Date(),
  updatedAt: new Date(),
});

const buy = (id: string, overrides: Record<string, unknown>) => ({
  type: 'BUY',
  id,
  isin: 'US0378331005',
  quantity: '10',
  pricePerShare: '100',
  currency: 'USD',
  tradeDate: '2024-05-10',
  settlementDate: '2024-05-13',
  ...overrides,
});

describe('pokrytí jednotné tabulky kurzů (unifiedRatesCover)', () => {
  it('transakce v hlavní měně a pokrytém roce projde; rok/měna mimo tabulku ne', () => {
    expect(unifiedRatesCover(parseTransactions([buy('a', {})]))).toBe(true);
    // rok 2018 — jednotná tabulka začíná 2020
    expect(
      unifiedRatesCover(
        parseTransactions([buy('b', { tradeDate: '2018-05-10', settlementDate: '2018-05-14' })]),
      ),
    ).toBe(false);
    // exotická měna mimo tabulku (HUF pokyny vyhlašují, my zatím ne — docs/14)
    expect(unifiedRatesCover(parseTransactions([buy('c', { currency: 'HUF' })]))).toBe(false);
    // GBX (pence) se převádí přes GBP — pokrytá měna
    expect(unifiedRatesCover(parseTransactions([buy('d', { currency: 'GBX' })]))).toBe(true);
    // dividenda v nepokryté měně
    expect(
      unifiedRatesCover(
        parseTransactions([
          { type: 'DIVIDEND', id: 'e', gross: '10', currency: 'TRY', date: '2024-06-01' },
        ]),
      ),
    ).toBe(false);
  });
});

describe('dailyRatesForProfile — denní kurzy jako fallback UNIFIED profilu', () => {
  const db = {} as Db; // mocknuté @/lib/cnb se DB nedotkne

  it('UNIFIED + transakce 2018/USD (mimo tabulku) → vrátí denní kurzy', async () => {
    const txs = parseTransactions([
      buy('f1', { tradeDate: '2018-05-10', settlementDate: '2018-05-14' }),
    ]);
    const rates = await dailyRatesForProfile(db, txs, profileRow('UNIFIED'), 2026);
    expect(rates).toBeDefined();
    expect(rates!.getRate('USD', '2018-05-10')?.toString()).toBe('21');
  });

  it('UNIFIED + plně pokryté transakce → undefined (žádný zbytečný backfill)', async () => {
    const txs = parseTransactions([buy('g1', {})]);
    await expect(dailyRatesForProfile(db, txs, profileRow('UNIFIED'), 2026)).resolves.toBeUndefined();
  });

  it('CNB_DAILY → denní kurzy vždy (beze změny chování)', async () => {
    const txs = parseTransactions([buy('h1', {})]);
    const rates = await dailyRatesForProfile(db, txs, profileRow('CNB_DAILY'), 2026);
    expect(rates).toBeDefined();
  });
});

describe('notifikační cron počítá stejnou kurzovou metodou jako aplikace', () => {
  it(
    'CNB_DAILY uživatel: limit 100k se vyhodnotí denním kurzem (21), ne jednotným (20,80)',
    { timeout: 30_000 },
    async () => {
      const db = await createPgliteDb();
      await db.insert(user).values({ id: 'ufx', name: 'Fx', email: 'fx@danero.cz' });
      await db
        .insert(taxpayerProfiles)
        .values({ userId: 'ufx', regime: 'PAUSAL', fxMethod: 'CNB_DAILY' });
      // prodej za 4 800 USD: denním kurzem 21 → 100 800 Kč (limit 100k PROLOMEN),
      // jednotným 20,80 → 99 840 Kč (jen CRITICAL) — EXCEEDED dokazuje denní kurz
      const csv = [
        'type,date,settlement_date,isin,ticker,name,quantity,price,currency,fee,fee_currency,amount,withholding_tax,source_country,note',
        'BUY,2026-01-10,2026-01-10,US0378331005,AAPL,Apple,10,100,USD,,,,,,',
        'SELL,2026-04-01,2026-04-01,US0378331005,AAPL,Apple,10,480,USD,,,,,,',
      ].join('\n');
      await importCsvText(db, 'ufx', 'fixtura.csv', csv);

      const { processUserNotifications } = await import('@/lib/notifications');
      await processUserNotifications(db, { id: 'ufx', email: 'fx@danero.cz' }, {
        send: async () => {},
        today: '2026-07-20',
      });

      const rows = await db.select().from(notifications).where(eq(notifications.userId, 'ufx'));
      const keys = rows.map((r) => r.dedupeKey);
      expect(keys).toContain('limit|100k|EXCEEDED|2026');
      expect(keys).not.toContain('limit|100k|CRITICAL|2026');
    },
  );
});
