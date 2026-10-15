import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * Stropy proti plnění databáze a zahlcení funkce přes importní server actions
 * (bezpečnostní revize 15. 10. 2026, nález 3). Akce jsou veřejné endpointy:
 * formulář v prohlížeči omezuje, co se pošle, ale útočník si požadavek
 * poskládá sám.
 */

const current = vi.hoisted(() => ({ userId: '' }));

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('@/lib/session', () => ({
  requireUser: async () => ({
    id: current.userId,
    email: `${current.userId}@test.cz`,
    name: 'Test',
    twoFactorEnabled: false,
  }),
}));

async function redirectTarget(run: () => Promise<void>): Promise<string> {
  try {
    await run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith('REDIRECT:')) return message.slice('REDIRECT:'.length);
    throw error;
  }
  throw new Error('Server action neskončila redirectem');
}

async function newUser(id: string): Promise<void> {
  const { getDb } = await import('@/db');
  const { user } = await import('@/db/schema');
  await (await getDb()).insert(user).values({ id, name: 'Test', email: `${id}@test.cz` });
  current.userId = id;
}

function aliasForm(rows: Array<{ symbol: string; isin: string }>): FormData {
  const data = new FormData();
  data.append('pocet', String(rows.length));
  rows.forEach((row, i) => {
    data.append(`broker-${i}`, 'fio');
    data.append(`symbol-${i}`, row.symbol);
    data.append(`isin-${i}`, row.isin);
  });
  return data;
}

describe('stropy importních akcí proti zneužití (bezpečnostní revize, nález 3)', () => {
  beforeAll(() => {
    process.env.PGLITE_DATA_DIR = ':memory:';
  });

  it('číselník neuloží symbol delší, než jaký kdy vydá výpis', { timeout: 30_000 }, async () => {
    await newUser('dlouhy-symbol');
    const { saveAliasesAction } = await import('@/app/(app)/import/actions');
    const { aliasCount } = await import('@/lib/instrument-aliases');
    const { getDb } = await import('@/db');

    await redirectTarget(() =>
      saveAliasesAction(
        aliasForm([
          { symbol: 'X'.repeat(20_000), isin: 'US0378331005' },
          { symbol: 'CEZ', isin: 'CZ0005112300' },
        ]),
      ),
    );

    // podvržený řádek zmizel, poctivý vedle něj se uložil
    expect(await aliasCount(await getDb(), 'dlouhy-symbol')).toBe(1);
  });

  it('plný číselník další záznamy nepřijme a řekne proč', { timeout: 30_000 }, async () => {
    await newUser('plny-ciselnik');
    const { saveAliasesAction } = await import('@/app/(app)/import/actions');
    const { aliasCount, MAX_ALIASES_PER_USER } = await import('@/lib/instrument-aliases');
    const { getDb } = await import('@/db');
    const { instrumentAliases } = await import('@/db/schema');
    const db = await getDb();
    await db.insert(instrumentAliases).values(
      Array.from({ length: MAX_ALIASES_PER_USER }, (_, i) => ({
        userId: 'plny-ciselnik',
        broker: 'fio',
        symbol: `S${i}`,
        isin: 'US0378331005',
      })),
    );

    expect(
      await redirectTarget(() =>
        saveAliasesAction(aliasForm([{ symbol: 'NAVIC', isin: 'CZ0005112300' }])),
      ),
    ).toBe('/import?chyba=ciselnik-plny');
    expect(await aliasCount(db, 'plny-ciselnik')).toBe(MAX_ALIASES_PER_USER);

    // úprava existujícího záznamu počet nezvětší — plný číselník ji pustí
    expect(
      await redirectTarget(() =>
        saveAliasesAction(aliasForm([{ symbol: 'S7', isin: 'CZ0005112300' }])),
      ),
    ).toBe('/import?ulozeno=ciselnik');
    const [updated] = await db
      .select({ isin: instrumentAliases.isin })
      .from(instrumentAliases)
      .where(eq(instrumentAliases.symbol, 'S7'));
    expect(updated?.isin).toBe('CZ0005112300');
  });

  it('opakované ukládání do číselníku narazí na limit', { timeout: 60_000 }, async () => {
    await newUser('limit-ciselniku');
    const { saveAliasesAction } = await import('@/app/(app)/import/actions');

    const targets: string[] = [];
    for (let i = 0; i < 31; i += 1) {
      targets.push(
        await redirectTarget(() =>
          saveAliasesAction(aliasForm([{ symbol: `T${i}`, isin: 'US0378331005' }])),
        ),
      );
    }
    expect(targets.slice(0, 30).every((target) => target === '/import?ulozeno=ciselnik')).toBe(
      true,
    );
    expect(targets[30]).toBe('/import?chyba=ciselnik-limit');
  });

  it('jedno nahrání s víc než 20 soubory se odmítne celé', { timeout: 30_000 }, async () => {
    await newUser('moc-souboru');
    const { uploadImportAction } = await import('@/app/(app)/import/actions');
    const { getDb } = await import('@/db');
    const { importBatches } = await import('@/db/schema');

    const data = new FormData();
    for (let i = 0; i < 21; i += 1) {
      data.append('soubory', new File(['Datum;Titul\n'], `vypis-${i}.csv`, { type: 'text/csv' }));
    }
    expect(await redirectTarget(() => uploadImportAction(data))).toBe(
      '/import?chyba=pocet-souboru',
    );
    const db = await getDb();
    expect(
      await db.select().from(importBatches).where(eq(importBatches.userId, 'moc-souboru')),
    ).toEqual([]);
  });
});
