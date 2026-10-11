import { beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Db } from '@/db';
import { BASELINE_FIELD, encodeBaseline, CHANGED_FIELD } from '@/lib/form-baseline';

/**
 * Zastaralý panel nesmí přepsat cizí změnu.
 *
 * Nastavení se odesílá celé. Změřeno 11. 10. 2026 (dva kontexty prohlížeče,
 * obě stránky nastavení, stejně i na `main`): v panelu 1 změna párování,
 * v panelu 2 — který pořád ukazuje starý stav — změna kurzů, a párování se
 * potichu vrátilo. Formulář proto nese stav, se kterým byl vykreslen, a server
 * zapíše jen pole, která se od něj liší.
 *
 * Testy skládají formulář stejně jako stránka: výchozí hodnoty i skrytý stav
 * z `form-state.ts`, změna je přepsaná dvojice.
 */
const state = vi.hoisted(() => ({ db: null as unknown as Db, userId: 'u-panel' }));

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('@/db', async () => {
  const actual = await vi.importActual<typeof import('@/db')>('@/db');
  return { ...actual, getDb: async () => state.db };
});
vi.mock('@/lib/session', () => ({
  requireUser: async () => ({
    id: state.userId,
    email: 'panel@priklad.test',
    name: 'Panel',
    twoFactorEnabled: false,
  }),
}));

/** Cíl přesměrování, kterým akce skončila. */
async function redirectTarget(run: () => Promise<void>): Promise<string> {
  try {
    await run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith('REDIRECT:')) return message.slice('REDIRECT:'.length);
    throw error;
  }
  throw new Error('server action neskončila přesměrováním');
}

type Entries = Array<[string, string]>;

/**
 * Formulář, jak ho odešle panel vykreslený se stavem `rendered`, ve kterém
 * člověk změnil pole `changes` (`null` = odškrtnuté políčko, pole = skupina
 * políček). `changed` je pole, jehož změna odeslání vyvolala (plní auto-save).
 */
function submittedForm(
  rendered: Entries,
  changes: Record<string, string | string[] | null>,
  { changed = '', baseline = true }: { changed?: string; baseline?: boolean } = {},
): FormData {
  const data = new FormData();
  if (baseline) data.append(BASELINE_FIELD, encodeBaseline(rendered));
  data.append(CHANGED_FIELD, changed);
  for (const [name, value] of rendered) if (!(name in changes)) data.append(name, value);
  for (const [name, value] of Object.entries(changes)) {
    for (const item of value === null ? [] : [value].flat()) data.append(name, item);
  }
  return data;
}

describe('daňový profil: zastaralý panel', () => {
  async function profile() {
    const { getProfile } = await import('@/lib/portfolio');
    return (await getProfile(state.db, state.userId))!;
  }
  async function rendered(): Promise<Entries> {
    const { profileFormEntries } = await import('@/app/(app)/nastaveni/form-state');
    return profileFormEntries(await profile());
  }
  async function save(form: FormData): Promise<string> {
    const { saveProfileAction } = await import('@/app/(app)/nastaveni/actions');
    return redirectTarget(() => saveProfileAction(form));
  }

  beforeAll(async () => {
    const { createPgliteDb } = await vi.importActual<typeof import('@/db')>('@/db');
    state.db = await createPgliteDb();
    const { user } = await import('@/db/schema');
    await state.db.insert(user).values([
      { id: 'u-panel', name: 'Panel', email: 'panel@priklad.test' },
      { id: 'u-novacek', name: 'Nováček', email: 'novacek@priklad.test' },
    ]);
    const { profileFormEntries } = await import('@/app/(app)/nastaveni/form-state');
    await save(submittedForm(profileFormEntries(null), { rezim: 'PAUSAL' }));
  }, 30_000);

  it('změna v panelu se starým stavem nevrátí pole změněné jinde', { timeout: 30_000 }, async () => {
    // oba panely se vykreslily se stejným stavem
    const stale = await rendered();
    expect((await profile()).matchingMethod).toBe('FIFO');

    // panel 1: párování
    await save(submittedForm(stale, { parovani: 'LIFO' }));
    expect((await profile()).matchingMethod).toBe('LIFO');

    // panel 2 pořád ukazuje FIFO a mění kurzy
    expect(await save(submittedForm(stale, { kurzy: 'CNB_DAILY' }))).toBe('/nastaveni?ok=profil#dan');
    const after = await profile();
    expect(after.fxMethod).toBe('CNB_DAILY');
    expect(after.matchingMethod).toBe('LIFO');
  });

  it('platí i pro částku, přepínač a sporný výklad', { timeout: 30_000 }, async () => {
    const stale = await rendered();
    await save(
      submittedForm(stale, {
        'ostatni-prijmy': '12 000,50',
        'obchodni-majetek': 'on',
        'limit-100k': 'lenient',
      }),
    );
    await save(submittedForm(stale, { 'zaklad-casoveho-testu': 'trade' }));
    const after = await profile();
    expect(after.timeTestBasis).toBe('trade');
    expect(after.otherIncomeCzk).toBe('12000.50');
    expect(after.hasBusinessAssets).toBe(true);
    expect(after.limit100kStrict).toBe(false);
  });

  it('odškrtnutý přepínač je změna, i když ve formuláři chybí', { timeout: 30_000 }, async () => {
    expect((await profile()).hasBusinessAssets).toBe(true);
    await save(submittedForm(await rendered(), { 'obchodni-majetek': null }));
    expect((await profile()).hasBusinessAssets).toBe(false);
  });

  it(
    'změna vrácená během běžícího ukládání se zapíše, i když se od vykresleného stavu neliší',
    { timeout: 30_000 },
    async () => {
      // přepínač zapnutý a hned vypnutý: druhé odeslání nese totéž, co stálo
      // ve formuláři při vykreslení — samotné srovnání by řeklo „beze změny“
      const shown = await rendered();
      await save(submittedForm(shown, { 'obchodni-majetek': 'on' }));
      expect((await profile()).hasBusinessAssets).toBe(true);
      await save(submittedForm(shown, {}, { changed: 'obchodni-majetek' }));
      expect((await profile()).hasBusinessAssets).toBe(false);
    },
  );

  it('uložení beze změny nic nepřepíše a nezapíše se do historie účtu', { timeout: 30_000 }, async () => {
    const stale = await rendered();
    await save(submittedForm(stale, { parovani: 'MAX_PROFIT' }));
    const { auditLog } = await import('@/db/schema');
    const countChanges = async () =>
      (await state.db.select().from(auditLog).where(eq(auditLog.userId, state.userId))).filter(
        (row) => row.type === 'PROFILE_CHANGE',
      ).length;
    const before = await countChanges();

    // tlačítko Uložit bez JavaScriptu v panelu, kde se nic nezměnilo
    expect(await save(submittedForm(stale, {}))).toBe('/nastaveni?ok=profil#dan');
    expect((await profile()).matchingMethod).toBe('MAX_PROFIT');
    expect(await countChanges()).toBe(before);
  });

  it('formulář bez výchozího stavu se uloží celý jako dřív', { timeout: 30_000 }, async () => {
    const stale = await rendered();
    await save(submittedForm(stale, { parovani: 'LIFO' }));
    await save(submittedForm(stale, { kurzy: 'UNIFIED' }, { baseline: false }));
    const after = await profile();
    expect(after.fxMethod).toBe('UNIFIED');
    // stará stránka (bez skrytého pole) přepisuje vše, co ukazuje
    expect(after.matchingMethod).toBe(new URLSearchParams(stale).get('parovani'));
  });

  it(
    'formulář prvního uložení otevřený vedle už uloženého profilu nepřepíše jeho nastavení předvolbami',
    { timeout: 30_000 },
    async () => {
      state.userId = 'u-novacek';
      const { profileFormEntries } = await import('@/app/(app)/nastaveni/form-state');
      const firstForm = profileFormEntries(null);
      // panel 1 profil založí a upraví
      expect(await save(submittedForm(firstForm, { rezim: 'ZAMESTNANEC' }))).toBe(
        '/import?ulozeno=profil',
      );
      await save(submittedForm(await rendered(), { kurzy: 'CNB_DAILY', 'limit-100k': 'lenient' }));
      // panel 2 pořád ukazuje formulář prvního uložení s předvolbami
      await save(submittedForm(firstForm, { rezim: 'PAUSAL' }));
      const after = await profile();
      expect(after.regime).toBe('PAUSAL');
      expect(after.fxMethod).toBe('CNB_DAILY');
      expect(after.limit100kStrict).toBe(false);
      state.userId = 'u-panel';
    },
  );
});

describe('upozornění: zastaralý panel', () => {
  async function prefs() {
    const { getNotificationPrefs } = await import('@/lib/notifications');
    return getNotificationPrefs(state.db, state.userId);
  }
  async function rendered(): Promise<Entries> {
    const { notificationFormEntries } = await import('@/app/(app)/nastaveni/form-state');
    return notificationFormEntries(await prefs());
  }
  async function save(form: FormData): Promise<string> {
    const { saveNotificationPrefsAction } = await import('@/app/(app)/nastaveni/actions');
    return redirectTarget(() => saveNotificationPrefsAction(form));
  }

  it(
    'první uložení v zastaralém panelu nepřepíše to, co mezitím uložil jiný',
    { timeout: 30_000 },
    async () => {
      // řádek v databázi ještě není — oba panely ukazují výchozí pravidla
      const stale = await rendered();
      await save(submittedForm(stale, { 'frekvence-emailu': 'WEEKLY' }));
      expect((await prefs()).emailFrequency).toBe('WEEKLY');

      expect(await save(submittedForm(stale, { 'nalehave-hned': null }))).toBe(
        '/nastaveni/upozorneni?ok=notifikace',
      );
      const after = await prefs();
      expect(after.urgentImmediately).toBe(false);
      expect(after.emailFrequency).toBe('WEEKLY');
    },
  );

  it('skupina zaškrtávacích políček se bere jako jedno pole', { timeout: 30_000 }, async () => {
    const stale = await rendered();
    // panel 1 přidá hranici 50 %, panel 2 (pořád 60, 85, 100) vypne kalendář
    await save(submittedForm(stale, { 'hranice-limitu': ['50', '60', '85', '100'] }));
    await save(submittedForm(stale, { 'upozorneni-kalendar': null }));
    let after = await prefs();
    expect(after.limitThresholdsPct).toBe('50,60,85,100');
    expect(after.calendarEmails).toBe(false);

    // odškrtnutí všech lhůt je taky změna
    await save(submittedForm(await rendered(), { 'lhuta-casoveho-testu': null }));
    after = await prefs();
    expect(after.timeTestLeadDays).toBe('');
    expect(after.limitThresholdsPct).toBe('50,60,85,100');
  });

  it('nabídky se zapisují jen při změně', { timeout: 30_000 }, async () => {
    const stale = await rendered();
    await save(submittedForm(stale, { 'pravidelny-prehled': 'MONTHLY', 'lhuta-terminu': '14' }));
    await save(submittedForm(stale, { 'emaily-zapnute': null }));
    const after = await prefs();
    expect(after.emailEnabled).toBe(false);
    expect(after.summaryFrequency).toBe('MONTHLY');
    expect(after.deadlineLeadDays).toBe(14);
  });
});
