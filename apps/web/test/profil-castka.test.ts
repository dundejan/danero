import { beforeAll, describe, expect, it, vi } from 'vitest';
import { d } from '@danero/shared';
import type { Db } from '@/db';

/**
 * Pole „Další zdanitelné příjmy" je jediné místo v nastavení, kam člověk píše
 * vlastní text — všechno ostatní jsou nabídky. A píše ho po lidsku: „10 000",
 * „1 234,50", často zkopírované rovnou z Danera, které tisíce odděluje
 * NEDĚLITELNOU mezerou.
 *
 * Dokud se hodnota kontrolovala dvěma `.refine()` za sebou, Zod pustil i to
 * druhé, přestože první selhalo — `d('10 000')` pak vyhodilo `DecimalError`,
 * tedy výjimku uvnitř `safeParse`. Server action tím spadla a uživatel místo
 * hlášky dostal CHYBOVOU STRÁNKU. Nastavení se navíc ukládá samo při opuštění
 * pole, takže stačilo napsat částku tak, jak ji píše celý svět.
 */
const stav = vi.hoisted(() => ({ db: null as unknown as Db }));

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('@/db', async () => {
  const actual = await vi.importActual<typeof import('@/db')>('@/db');
  return { ...actual, getDb: async () => stav.db };
});
vi.mock('@/lib/session', () => ({
  requireUser: async () => ({ id: 'u-castka', email: 'jan@danero.cz', name: 'Jan' }),
}));

/** Cíl redirectu, kterým akce skončila — nebo vyhozená výjimka. */
async function cil(run: () => Promise<void>): Promise<string> {
  try {
    await run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith('REDIRECT:')) return message.slice('REDIRECT:'.length);
    return `VÝJIMKA: ${message}`;
  }
  return 'BEZ REDIRECTU';
}

const form = (castka: string, rezim = 'PAUSAL'): FormData => {
  const data = new FormData();
  for (const [key, value] of Object.entries({
    rezim,
    'ostatni-prijmy': castka,
    parovani: 'FIFO',
    kurzy: 'UNIFIED',
    'limit-100k': 'strict',
    'zaklad-casoveho-testu': 'settlement',
    'derivaty-vydaje': 'restrictive',
    'emt-casovy-test': 'safe',
    'vratka-kapitalu': 'safe',
  })) {
    data.append(key, value);
  }
  return data;
};

describe('částka v nastavení se čte tak, jak ji lidé píšou', () => {
  beforeAll(async () => {
    const { createPgliteDb } = await vi.importActual<typeof import('@/db')>('@/db');
    stav.db = await createPgliteDb();
    const { user } = await import('@/db/schema');
    await stav.db.insert(user).values({ id: 'u-castka', name: 'Jan', email: 'jan@danero.cz' });
  }, 30_000);

  /** Mezera i NEDĚLITELNÁ mezera (U+00A0) — tu vyrábí formátování v aplikaci. */
  const prijate: [string, string][] = [
    ['10000', '10000'],
    ['10 000', '10000'],
    ['10 000', '10000'],
    ['1 234,50', '1234.50'],
    ['12000,5', '12000.5'],
    ['', '0'],
  ];

  for (const [vstup, ulozeno] of prijate) {
    it(`„${vstup}" se uloží jako ${ulozeno}`, { timeout: 30_000 }, async () => {
      const { saveProfileAction } = await import('@/app/(app)/nastaveni/actions');
      const kam = await cil(() => saveProfileAction(form(vstup)));
      expect(kam, `„${vstup}" mělo projít, skončilo na ${kam}`).toMatch(
        // první uložení účtu bez dat vede ke kroku 2 (Zdroje dat), další zůstávají v nastavení
        /^\/(import\?ulozeno=profil|prehled|nastaveni\?ok=)/,
      );

      const { taxpayerProfiles } = await import('@/db/schema');
      const [row] = await stav.db.select().from(taxpayerProfiles);
      // DB je `numeric(18,2)`, takže vrací „10000.00" — porovnáváme hodnotu, ne zápis
      expect(d(row?.otherIncomeCzk ?? '-1').eq(ulozeno)).toBe(true);
    });
  }

  it('nesmysl skončí hláškou, NIKDY výjimkou (a tedy chybovou stránkou)', async () => {
    const { saveProfileAction } = await import('@/app/(app)/nastaveni/actions');
    for (const vstup of ['12 000 Kč', 'abc', '10.000', '-5', '1e9']) {
      const kam = await cil(() => saveProfileAction(form(vstup)));
      expect(kam, `„${vstup}" nesmí spadnout`).toBe('/nastaveni?chyba=prijmy');
    }
  });

  /**
   * Server dřív odmítal částku nad bilion, kterou `pattern` v prohlížeči
   * pustil — kdo s ní zavřel panel, nedozvěděl se, že se neuložila (prohlížeč
   * se při odchodu ptá jen u textu, o kterém ví, že neprojde). Mez je proto
   * počet číslic a obě strany ji čtou z jedné konstanty.
   */
  it('horní mez částky pozná prohlížeč stejně jako server', { timeout: 30_000 }, async () => {
    const { saveProfileAction } = await import('@/app/(app)/nastaveni/actions');
    const { OTHER_INCOME_PATTERN } = await import('@/app/(app)/nastaveni/form-state');
    const browser = new RegExp(`^(?:${OTHER_INCOME_PATTERN})$`, 'v');
    const { taxpayerProfiles } = await import('@/db/schema');

    for (const vstup of ['999999999999,99', '999 999 999 999']) {
      expect(browser.test(vstup), `„${vstup}" má prohlížeč pustit`).toBe(true);
      const kam = await cil(() => saveProfileAction(form(vstup)));
      expect(kam, `„${vstup}" má server uložit`).not.toBe('/nastaveni?chyba=prijmy');
      const [row] = await stav.db.select().from(taxpayerProfiles);
      expect(d(row?.otherIncomeCzk ?? '-1').eq(vstup.replace(/\s/g, '').replace(',', '.'))).toBe(true);
    }
    for (const vstup of ['1000000000000', '1 000 000 000 000,00', '99999999999999999999']) {
      expect(browser.test(vstup), `„${vstup}" má prohlížeč zastavit`).toBe(false);
      const kam = await cil(() => saveProfileAction(form(vstup)));
      expect(kam, `„${vstup}" má server odmítnout`).toBe('/nastaveni?chyba=prijmy');
    }
  });
});

/**
 * Auto-save má u pole atribut `pattern`: prohlížeč podle něj pozná rozepsanou
 * částku, kterou server odmítne, dřív než s ní člověk zavře panel (pak už není
 * kde to říct). Vzor proto nesmí být přísnější než server — platnou částku by
 * při odchodu neuložil. Prohlížeč vzor obaluje `^(?:…)$` a překládá s příznakem `v`.
 */
describe('tvar částky pro prohlížeč odpovídá tomu, co přijme server', () => {
  it('pustí všechno, co server uloží, a zastaví, co server odmítne', async () => {
    const { OTHER_INCOME_PATTERN } = await import('@/app/(app)/nastaveni/form-state');
    const browser = new RegExp(`^(?:${OTHER_INCOME_PATTERN})$`, 'v');
    for (const vstup of ['10000', '10 000', '10\u00a0000', '1 234,50', '12000,5', '12000.5', '', ' 7 ']) {
      expect(browser.test(vstup), `„${vstup}" má projít`).toBe(true);
    }
    for (const vstup of ['12 000 Kč', 'abc', '10.000', '-5', '1e9', '1,5,5', '12,', ',5']) {
      expect(browser.test(vstup), `„${vstup}" nemá projít`).toBe(false);
    }
  });

  it('auto-save odmítnutou částku vrátí s hláškou a jménem pole', { timeout: 30_000 }, async () => {
    const { createPgliteDb } = await vi.importActual<typeof import('@/db')>('@/db');
    stav.db = await createPgliteDb();
    const { user } = await import('@/db/schema');
    await stav.db.insert(user).values({ id: 'u-castka', name: 'Jan', email: 'jan@danero.cz' });
    const { autoSaveProfileAction } = await import('@/app/(app)/nastaveni/actions');
    expect(await autoSaveProfileAction(form('12 000 Kč'))).toEqual({
      ok: false,
      message: expect.stringMatching(/Další zdanitelné příjmy zadej jako částku/),
      field: 'ostatni-prijmy',
    });
    expect(await autoSaveProfileAction(form('12 000'))).toEqual({
      ok: true,
      message: 'Uloženo. Výpočty se přepočítají podle nového profilu.',
    });
  });
});

/**
 * L7i-01 (rozhodnutí R8): daňový režim nemá předvolbu. Do revize 5 byl
 * předvolený „OSVČ v paušálu“, takže zaměstnanec, který profil jen odklikl,
 * četl při 21 382 Kč „povinnost podat přiznání nevzniká“ — hlídal se mu limit
 * 50 000 Kč místo 20 000 Kč. Režim z dat zjistit nejde, tak se na něj ptáme.
 */
describe('daňový režim se při prvním uložení musí vybrat (L7i-01, R8)', () => {
  beforeAll(async () => {
    const { createPgliteDb } = await vi.importActual<typeof import('@/db')>('@/db');
    stav.db = await createPgliteDb();
    const { user } = await import('@/db/schema');
    await stav.db.insert(user).values({ id: 'u-castka', name: 'Jan', email: 'jan@danero.cz' });
  }, 30_000);

  it('bez vybraného režimu se profil neuloží a hláška říká, co chybí', { timeout: 30_000 }, async () => {
    const { saveProfileAction } = await import('@/app/(app)/nastaveni/actions');
    expect(await cil(() => saveProfileAction(form('0', '')))).toBe('/nastaveni?chyba=rezim');

    const { taxpayerProfiles } = await import('@/db/schema');
    expect(await stav.db.select().from(taxpayerProfiles)).toHaveLength(0);
  });

  it('formulář nového uživatele žádný režim nepředvybírá a pole je povinné', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const page = readFileSync(
      join(import.meta.dirname, '..', 'app', '(app)', 'nastaveni', 'page.tsx'),
      'utf8',
    );
    const select = page.slice(page.indexOf('id="rezim"'), page.indexOf('<option value="PAUSAL">'));
    // výchozí hodnota jde ze stavu formuláře (`form-state.ts`) — a ten bez
    // profilu žádný režim nenese, takže se vybere prázdná položka
    expect(select).toContain("defaultValue={shown.get(PROFILE_FIELDS.regime) ?? ''}");
    const { profileFormEntries } = await import('@/app/(app)/nastaveni/form-state');
    expect(profileFormEntries(null).map(([name]) => name)).not.toContain('rezim');
    expect(select).toContain('required');
    expect(select).toContain('<option value="" disabled>');
    expect(page).not.toMatch(/regime \?\? 'PAUSAL'/);
  });

  it('hláška pro chybějící režim existuje', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const toast = readFileSync(
      join(import.meta.dirname, '..', 'app', '(app)', 'nastaveni', 'settings-toast.tsx'),
      'utf8',
    );
    expect(toast).toMatch(/rezim: 'Vyber svůj daňový režim/);
  });
});
