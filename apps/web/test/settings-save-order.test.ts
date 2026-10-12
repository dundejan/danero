import { beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Db } from '@/db';
import type { AutoSaveOutcome, SaveJob } from '@/lib/save-queue';
import {
  BASELINE_FIELD,
  CHANGED_FIELD,
  encodeBaseline,
  OWNER_FIELD,
  SUBMISSION_FIELD,
} from '@/lib/form-baseline';

/**
 * Pořadí odeslání formuláře nastavení (revize R7, M3).
 *
 * Auto-save posílá odeslání za sebou — až na odchod ze stránky: co čeká, jde
 * hned, souběžně s tím, co ještě běží, a jinou cestou. Naměřeno 11. 10. 2026:
 * párování přepnuté na LIFO (akce zdržená o 1,5 s), hned zpět na FIFO
 * a skrytý panel → odchodové FIFO dorazilo první, opožděné LIFO ho přepsalo
 * a server skončil na volbě, kterou si uživatel rozmyslel.
 *
 * Odeslání proto nese pořadí a starší odeslání téhož formuláře, které dorazí
 * po novějším, nezapíše nic.
 */
const state = vi.hoisted(() => ({ db: null as unknown as Db, userId: 'u-poradi' }));

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
    email: 'poradi@priklad.test',
    name: 'Pořadí',
    twoFactorEnabled: false,
  }),
}));

type Entries = Array<[string, string]>;

/** Odeslání panelu vykresleného se stavem `rendered`: změna `changes`, pořadí `mark`. */
function submission(
  rendered: Entries,
  changes: Record<string, string | null>,
  mark?: string,
): FormData {
  const data = new FormData();
  data.append(BASELINE_FIELD, encodeBaseline(rendered));
  for (const name of Object.keys(changes)) data.append(CHANGED_FIELD, name);
  for (const [name, value] of rendered) if (!(name in changes)) data.append(name, value);
  for (const [name, value] of Object.entries(changes)) if (value !== null) data.append(name, value);
  if (mark !== undefined) data.append(SUBMISSION_FIELD, mark);
  return data;
}

describe('daňový profil: pořadí odeslání', () => {
  async function profile() {
    const { getProfile } = await import('@/lib/portfolio');
    return (await getProfile(state.db, state.userId))!;
  }
  async function rendered(): Promise<Entries> {
    const { profileFormEntries } = await import('@/app/(app)/nastaveni/form-state');
    return profileFormEntries(await profile());
  }
  async function save(form: FormData): Promise<boolean> {
    const { saveProfile } = await import('@/app/(app)/nastaveni/save');
    return (await saveProfile(state.userId, form)).ok;
  }
  async function audits(): Promise<number> {
    const { auditLog } = await import('@/db/schema');
    return (await state.db.select().from(auditLog).where(eq(auditLog.userId, state.userId))).filter(
      (event) => event.type === 'PROFILE_CHANGE',
    ).length;
  }
  async function reset(matching: string): Promise<void> {
    const { taxpayerProfiles } = await import('@/db/schema');
    await state.db
      .update(taxpayerProfiles)
      .set({ matchingMethod: matching, saveInstance: null, saveSequence: null })
      .where(eq(taxpayerProfiles.userId, state.userId));
  }

  beforeAll(async () => {
    const { createPgliteDb } = await vi.importActual<typeof import('@/db')>('@/db');
    state.db = await createPgliteDb();
    const { user } = await import('@/db/schema');
    await state.db.insert(user).values({ id: 'u-poradi', name: 'Pořadí', email: 'poradi@priklad.test' });
    const { profileFormEntries } = await import('@/app/(app)/nastaveni/form-state');
    await save(submission(profileFormEntries(null), { rezim: 'PAUSAL' }));
  }, 30_000);

  it('starší odeslání, které dorazí po novějším, volbu nepřepíše', { timeout: 30_000 }, async () => {
    await reset('FIFO');
    const panel = await rendered();
    const before = await audits();
    // 1: FIFO → LIFO (zdrží se v síti), 2: zpět na FIFO (odchod ze stránky, dorazí první)
    expect(await save(submission(panel, { parovani: 'FIFO' }, 'panel-a.2'))).toBe(true);
    expect(await save(submission(panel, { parovani: 'LIFO' }, 'panel-a.1'))).toBe(true);
    expect((await profile()).matchingMethod).toBe('FIFO');
    // nic se nezměnilo → nic v historii účtu
    expect(await audits()).toBe(before);
  });

  it('v běžném pořadí platí poslední odeslání', { timeout: 30_000 }, async () => {
    await reset('FIFO');
    const panel = await rendered();
    const before = await audits();
    await save(submission(panel, { parovani: 'LIFO' }, 'panel-a.1'));
    await save(submission(panel, { parovani: 'FIFO' }, 'panel-a.2'));
    expect((await profile()).matchingMethod).toBe('FIFO');
    expect(await audits()).toBe(before + 2);
  });

  it('pozdější odeslání nese i změny dřívějšího — přeskočené odeslání nic neztratí', { timeout: 30_000 }, async () => {
    await reset('FIFO');
    const panel = await rendered();
    // 1: kurzy; 2: párování — stav formuláře při druhém už kurzy obsahuje
    const second = submission(panel, { parovani: 'LIFO', kurzy: 'CNB_DAILY' }, 'panel-b.2');
    second.delete(CHANGED_FIELD);
    second.append(CHANGED_FIELD, 'parovani');
    await save(second);
    await save(submission(panel, { kurzy: 'CNB_DAILY' }, 'panel-b.1'));
    expect(await profile()).toMatchObject({ matchingMethod: 'LIFO', fxMethod: 'CNB_DAILY' });
    await save(submission(await rendered(), { kurzy: 'UNIFIED' }, 'panel-b.3'));
  });

  it('opožděné odeslání přepíše i volbu, kterou novější jen potvrdilo — a tu mu nedovolíme', { timeout: 30_000 }, async () => {
    // novější odeslání hodnotu nemění (FIFO je v databázi), přesto musí zanechat pořadí
    await reset('FIFO');
    const panel = await rendered();
    await save(submission(panel, { parovani: 'FIFO' }, 'panel-c.5'));
    const { taxpayerProfiles } = await import('@/db/schema');
    const [row] = await state.db
      .select()
      .from(taxpayerProfiles)
      .where(eq(taxpayerProfiles.userId, state.userId));
    expect(row).toMatchObject({ saveInstance: 'panel-c', saveSequence: 5 });
    await save(submission(panel, { parovani: 'MAX_LOSS' }, 'panel-c.4'));
    expect((await profile()).matchingMethod).toBe('FIFO');
  });

  it('jiný formulář (jiný panel, stránka načtená znovu) se pořadím neřídí', { timeout: 30_000 }, async () => {
    await reset('FIFO');
    const panel = await rendered();
    await save(submission(panel, { parovani: 'LIFO' }, 'panel-d.9'));
    // jiné označení s nižším číslem: mezi formuláři platí, kdo přišel poslední
    await save(submission(panel, { parovani: 'MAX_PROFIT' }, 'panel-e.1'));
    expect((await profile()).matchingMethod).toBe('MAX_PROFIT');
    // a opožděné odeslání prvního panelu po něm taky projde — pořadí mezi panely neznáme
    await save(submission(panel, { parovani: 'LIFO' }, 'panel-d.8'));
    expect((await profile()).matchingMethod).toBe('LIFO');
  });

  it('totéž odeslání podruhé projde a nezapíše se do historie účtu dvakrát', { timeout: 30_000 }, async () => {
    await reset('FIFO');
    const panel = await rendered();
    const before = await audits();
    await save(submission(panel, { parovani: 'LIFO' }, 'panel-f.1'));
    await save(submission(panel, { parovani: 'LIFO' }, 'panel-f.1'));
    expect((await profile()).matchingMethod).toBe('LIFO');
    expect(await audits()).toBe(before + 1);
  });

  it('odeslání bez pořadí (první uložení, starší stránka) se ukládá jako dřív', { timeout: 30_000 }, async () => {
    await reset('FIFO');
    const panel = await rendered();
    await save(submission(panel, { parovani: 'LIFO' }, 'panel-g.7'));
    await save(submission(panel, { parovani: 'MAX_LOSS' }));
    expect((await profile()).matchingMethod).toBe('MAX_LOSS');
    // podvržený tvar pořadí se nepoužije
    await save(submission(panel, { parovani: 'FIFO' }, "panel-g.1'; --"));
    expect((await profile()).matchingMethod).toBe('FIFO');
  });

  it('pořadí není součást profilu ani exportu dat', { timeout: 30_000 }, async () => {
    const shown = (await rendered()).map(([name]) => name);
    expect(shown).not.toContain(SUBMISSION_FIELD);
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    // profil po uložení s pořadím ho nenese — a export čte tutéž podobu tabulek
    // bez sloupců pořadí (`db/settings-data.ts`), ne ty úplné
    await save(submission(await rendered(), { parovani: 'LIFO' }, 'panel-h.1'));
    expect(await profile()).not.toHaveProperty('saveInstance');
    expect(await profile()).not.toHaveProperty('saveSequence');
    const route = readFileSync(join(import.meta.dirname, '..', 'app', 'api', 'export', 'route.ts'), 'utf8');
    expect(route).toContain('.from(taxpayerProfileData)');
    expect(route).toContain('.from(notificationPrefData)');
    expect(route).not.toMatch(/\b(taxpayerProfiles|notificationPrefs)\b\s*[,)]/);
  });
});

describe('upozornění: pořadí odeslání', () => {
  async function prefs() {
    const { getNotificationPrefs } = await import('@/lib/notifications');
    return getNotificationPrefs(state.db, state.userId);
  }
  async function rendered(): Promise<Entries> {
    const { notificationFormEntries } = await import('@/app/(app)/nastaveni/form-state');
    return notificationFormEntries(await prefs());
  }
  async function save(form: FormData): Promise<void> {
    const { saveNotificationPrefs } = await import('@/app/(app)/nastaveni/save');
    await saveNotificationPrefs(state.userId, form);
  }

  it('starší odeslání, které dorazí po novějším, přepínač nevrátí', { timeout: 30_000 }, async () => {
    const panel = await rendered();
    // 1: týdně (zdrží se), 2: zpět na denně (odchod, dorazí první — řádek teprve vzniká)
    await save(submission(panel, { 'frekvence-emailu': 'DAILY' }, 'panel-u.2'));
    await save(submission(panel, { 'frekvence-emailu': 'WEEKLY' }, 'panel-u.1'));
    expect((await prefs()).emailFrequency).toBe('DAILY');
    // v běžném pořadí platí poslední
    await save(submission(panel, { 'frekvence-emailu': 'WEEKLY' }, 'panel-u.3'));
    expect((await prefs()).emailFrequency).toBe('WEEKLY');
    // odeslání bez pořadí se ukládá jako dřív
    await save(submission(panel, { 'frekvence-emailu': 'DAILY' }));
    expect((await prefs()).emailFrequency).toBe('DAILY');
  });
});

/**
 * Revize R8, D1 — fronta a server dohromady. Ochrana pořadí výš zahazuje
 * starší odeslání; to je správně jen tehdy, když ho pozdější odeslání
 * obsahuje. Naměřeno 12. 10. 2026 v Chromiu i Firefoxu: párování FIFO → LIFO
 * (akce běží), hned zpět na FIFO (čeká), skrytí panelu pošle vrácení cestou
 * odchodu a to se zdrží; po návratu změna kurzů dorazí dřív. Kurzy nesly jen
 * své jméno, server opožděné vrácení zahodil a zůstal na LIFO — s hláškou
 * „Uloženo“. Odeslání tu vyrábí skutečná fronta a ukládá skutečný server;
 * test jen rozhoduje, v jakém pořadí dorazí.
 */
describe('pořadí odeslání: vrácená změna, kterou předběhne pozdější odeslání', () => {
  /** Fronta, jejíž odeslání čekají „v síti“, dokud je test nedoručí (`deliver`). */
  async function wired(save: (body: FormData) => Promise<unknown>, instance: string) {
    const { createSaveQueue, saveBody } = await import('@/lib/save-queue');
    const wire: Array<() => Promise<void>> = [];
    const sending = (job: SaveJob): Promise<AutoSaveOutcome> =>
      new Promise((resolve) => {
        wire.push(async () => {
          await save(saveBody(job));
          resolve({ ok: true, message: '' });
        });
      });
    const queue = createSaveQueue({ send: sending, sendLeaving: sending, report: () => {} }, instance);
    const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
    const deliver = async (index: number): Promise<void> => {
      await wire[index]!();
      await settle();
    };
    return { queue, wire, deliver };
  }
  /** Změna pole `name`: `state` je celý stav formuláře po ní (proti stavu při vykreslení). */
  const change = (rendered: Entries, state: Record<string, string | null>, name: string): SaveJob => ({
    data: submission(rendered, state),
    triggers: [name],
  });

  it('daňový profil skončí na poslední volbě uživatele', { timeout: 30_000 }, async () => {
    const { taxpayerProfiles } = await import('@/db/schema');
    const { getProfile } = await import('@/lib/portfolio');
    const { profileFormEntries } = await import('@/app/(app)/nastaveni/form-state');
    const { saveProfile } = await import('@/app/(app)/nastaveni/save');
    await state.db
      .update(taxpayerProfiles)
      .set({ matchingMethod: 'FIFO', fxMethod: 'UNIFIED', saveInstance: null, saveSequence: null })
      .where(eq(taxpayerProfiles.userId, state.userId));
    const panel = profileFormEntries(await getProfile(state.db, state.userId));
    const { queue, wire, deliver } = await wired((body) => saveProfile(state.userId, body), 'panel-r8');

    queue.enqueue(change(panel, { parovani: 'LIFO' }, 'parovani')); // 1: akce běží
    queue.enqueue(change(panel, { parovani: 'FIFO' }, 'parovani')); // 2: čeká
    queue.flush(); // skrytí panelu: 2 odchází cestou odchodu — a zdrží se
    expect(wire).toHaveLength(2);
    await deliver(0);
    // 3: po návratu do panelu jiné pole; dorazí dřív než 2
    queue.enqueue(change(panel, { parovani: 'FIFO', kurzy: 'CNB_DAILY' }, 'kurzy'));
    expect(wire).toHaveLength(3);
    await deliver(2);
    await deliver(1);

    expect(await getProfile(state.db, state.userId)).toMatchObject({
      matchingMethod: 'FIFO',
      fxMethod: 'CNB_DAILY',
    });
  });

  it('nastavení upozornění taky', { timeout: 30_000 }, async () => {
    const { getNotificationPrefs } = await import('@/lib/notifications');
    const { notificationFormEntries } = await import('@/app/(app)/nastaveni/form-state');
    const { saveNotificationPrefs } = await import('@/app/(app)/nastaveni/save');
    const before = await getNotificationPrefs(state.db, state.userId);
    expect(before).toMatchObject({ emailFrequency: 'DAILY', limitEvents: true });
    const panel = notificationFormEntries(before);
    const { queue, deliver } = await wired(
      (body) => saveNotificationPrefs(state.userId, body),
      'panel-r8u',
    );

    queue.enqueue(change(panel, { 'frekvence-emailu': 'WEEKLY' }, 'frekvence-emailu'));
    queue.enqueue(change(panel, { 'frekvence-emailu': 'DAILY' }, 'frekvence-emailu'));
    queue.flush();
    await deliver(0);
    queue.enqueue(
      change(panel, { 'frekvence-emailu': 'DAILY', 'upozorneni-limity': null }, 'upozorneni-limity'),
    );
    await deliver(2);
    await deliver(1);

    expect(await getNotificationPrefs(state.db, state.userId)).toMatchObject({
      emailFrequency: 'DAILY',
      limitEvents: false,
    });
  });
});

/**
 * Revize R8, M1 — formulář jednoho účtu pod přihlášením druhého. Přihlášení se
 * v prohlížeči může změnit, aniž se stránka načte znovu (odhlášení a přihlášení
 * jiného účtu v témže panelu nebo ve vedlejším). Naměřeno 12. 10. 2026:
 * odeslání účtu A pozdržené přes odhlášení dorazilo s cookie účtu B a server
 * volbu účtu A zapsal do profilu B. Auto-save proto k odeslání přidává označení
 * účtu, kterému stránka formulář vykreslila, a server cizí formulář nezapíše.
 */
describe('formulář jiného účtu, než který je přihlášený', () => {
  async function tagFor(userId: string): Promise<string> {
    const { ownerTag } = await import('@/lib/owner-tag');
    return ownerTag(userId);
  }
  const withOwner = (form: FormData, owner: string): FormData => {
    form.append(OWNER_FIELD, owner);
    return form;
  };

  it('daňový profil nezapíše — vlastní a neoznačený formulář ano', { timeout: 30_000 }, async () => {
    const { getProfile } = await import('@/lib/portfolio');
    const { profileFormEntries } = await import('@/app/(app)/nastaveni/form-state');
    const { autoSaveProfile } = await import('@/app/(app)/nastaveni/save');
    const before = (await getProfile(state.db, state.userId))!;
    const panel = profileFormEntries(before);
    const other = before.matchingMethod === 'MAX_LOSS' ? 'MAX_PROFIT' : 'MAX_LOSS';

    const foreign = await autoSaveProfile(
      state.userId,
      withOwner(submission(panel, { parovani: other }, 'panel-x.1'), await tagFor('u-nekdo-jiny')),
    );
    expect(foreign).toMatchObject({ ok: false, foreign: true });
    expect((await getProfile(state.db, state.userId))!.matchingMethod).toBe(before.matchingMethod);

    // vlastní formulář projde; bez označení (první uložení tlačítkem, starší stránka) taky
    const own = await autoSaveProfile(
      state.userId,
      withOwner(submission(panel, { parovani: other }, 'panel-x.2'), await tagFor(state.userId)),
    );
    expect(own.ok).toBe(true);
    expect((await getProfile(state.db, state.userId))!.matchingMethod).toBe(other);
    const unmarked = await autoSaveProfile(state.userId, submission(panel, { parovani: 'FIFO' }));
    expect(unmarked.ok).toBe(true);
    expect((await getProfile(state.db, state.userId))!.matchingMethod).toBe('FIFO');
  });

  it('nastavení upozornění taky ne', { timeout: 30_000 }, async () => {
    const { getNotificationPrefs } = await import('@/lib/notifications');
    const { notificationFormEntries } = await import('@/app/(app)/nastaveni/form-state');
    const { autoSaveNotificationPrefs } = await import('@/app/(app)/nastaveni/save');
    const before = await getNotificationPrefs(state.db, state.userId);
    const panel = notificationFormEntries(before);
    const other = before.emailFrequency === 'DAILY' ? 'WEEKLY' : 'DAILY';

    const foreign = await autoSaveNotificationPrefs(
      state.userId,
      withOwner(submission(panel, { 'frekvence-emailu': other }), await tagFor('u-nekdo-jiny')),
    );
    expect(foreign).toMatchObject({ ok: false, foreign: true });
    expect((await getNotificationPrefs(state.db, state.userId)).emailFrequency).toBe(
      before.emailFrequency,
    );
    const own = await autoSaveNotificationPrefs(
      state.userId,
      withOwner(submission(panel, { 'frekvence-emailu': other }), await tagFor(state.userId)),
    );
    expect(own.ok).toBe(true);
    expect((await getNotificationPrefs(state.db, state.userId)).emailFrequency).toBe(other);
  });
});
