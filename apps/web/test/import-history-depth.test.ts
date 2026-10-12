import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '@/db';
import { importBatches, user } from '@/db/schema';
import {
  HISTORY_LOOKBACK,
  historyLimit,
  historyQueryLimit,
  nextHistoryLimit,
} from '@/lib/import-feedback';

/**
 * Historie importů musí dosáhnout na každou dávku, ne jen na posledních 200.
 *
 * Záznam o dávce je jediná cesta, jak její transakce vrátit (proto ho úklid
 * po 90 dnech nemaže, dokud na něm transakce visí — `lib/retention.ts`).
 * Stránka ale načítala nejvýš 200 posledních dávek a odkaz „Zobrazit starší“
 * končil tamtéž. Napojený účet přitom zapíše dávku při každé denní
 * synchronizaci, takže ruční výpis z doby před napojením z dosahu vypadl
 * během měsíců — a s ním i dokumentovaný postup „vrať import zpět a nahraj
 * znovu“.
 */
const state = vi.hoisted(() => ({ db: null as unknown as Db }));

vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
  useRouter: () => ({ refresh: () => undefined }),
}));
vi.mock('@/lib/session', () => ({ requireUser: async () => ({ id: 'u1' }) }));
vi.mock('@/db', async () => {
  const actual = await vi.importActual<typeof import('@/db')>('@/db');
  return { ...actual, getDb: async () => state.db };
});

async function renderImportPage(params: Record<string, string> = {}): Promise<string> {
  const { default: ImportPage } = await import('@/app/(app)/import/page');
  return renderToStaticMarkup(await ImportPage({ searchParams: Promise.resolve(params) }));
}

const OLDEST = 'rucni-vypis-2024.csv';
const BATCH_COUNT = HISTORY_LOOKBACK + 30;

/** Nejstarší je ruční výpis s transakcemi, nad ním denní synchronizace. */
async function seedHistory(db: Db): Promise<void> {
  const start = Date.UTC(2026, 0, 1);
  const rows = Array.from({ length: BATCH_COUNT }, (_, index) => ({
    id: `b${index}`,
    userId: 'u1',
    broker: index === 0 ? 'universal' : 'trading212',
    filename: index === 0 ? OLDEST : 't212-api-2026.csv',
    added: index === 0 ? 12 : 0,
    duplicates: index === 0 ? 0 : 40,
    errorCount: 0,
    skippedCount: 0,
    warningCount: 0,
    issues: {},
    createdAt: new Date(start + index * 86_400_000),
  }));
  await db.insert(importBatches).values(rows);
}

beforeEach(async () => {
  const { createPgliteDb } = await import('@/db');
  const db = await createPgliteDb();
  await db.insert(user).values({ id: 'u1', name: 'Test', email: 'test@danero.cz' });
  await seedHistory(db);
  state.db = db;
}, 30_000);

describe('historie importů: hloubka', () => {
  it('délka z adresy nemá strop dvě stě', () => {
    expect(historyLimit({ historie: '260' })).toBe(260);
    expect(historyLimit({ historie: '9999' })).toBe(9999);
    // odkaz „Zobrazit starší“ nesmí vést na délku, kterou stránka nepřijme —
    // se čtyřmi číslicemi spadl krok z 9 900 na 10 000 zpátky na dvacet
    expect(historyLimit({ historie: String(nextHistoryLimit(9900)) })).toBe(10_000);
  });

  it('krok roste: po dvaceti do stovky, pak po stovce', () => {
    expect(nextHistoryLimit(20)).toBe(40);
    expect(nextHistoryLimit(80)).toBe(100);
    expect(nextHistoryLimit(100)).toBe(200);
    expect(nextHistoryLimit(200)).toBe(300);
  });

  it('dotaz načte o jednu dávku víc, než se ukáže — a nikdy míň než dohled číselníku', () => {
    expect(historyQueryLimit(20)).toBe(HISTORY_LOOKBACK);
    expect(historyQueryLimit(HISTORY_LOOKBACK)).toBe(HISTORY_LOOKBACK + 1);
    expect(historyQueryLimit(300)).toBe(301);
  });

  it('na dvou stech odkaz „Zobrazit starší“ nekončí', { timeout: 30_000 }, async () => {
    const html = await renderImportPage({ historie: String(HISTORY_LOOKBACK) });

    expect(html).not.toContain(OLDEST);
    expect(html).toContain(`/import?historie=${HISTORY_LOOKBACK + 100}#starsi`);
  });

  it('nejstarší dávka jde dohledat a vrátit', { timeout: 30_000 }, async () => {
    const html = await renderImportPage({ historie: String(HISTORY_LOOKBACK + 100) });

    expect(html).toContain(OLDEST);
    expect(html).toContain('Vrátit import zpět');
    // starší už nejsou — odkaz zmizí
    expect(html).not.toContain('Zobrazit starší');
  });
});
