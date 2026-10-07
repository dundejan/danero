import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createPgliteDb } from '@/db';
import { notificationPrefs, user } from '@/db/schema';
import { getNotificationPrefs } from '@/lib/notifications';

/**
 * Migrace 0043: účtům založeným před zrušením plateb (8. 10. 2026) zůstávají
 * hlídací e-maily vypnuté, dokud si je nezapnou.
 *
 * Bez ní by první běh hlídače po nasazení poslal každému staršímu účtu všechna
 * nastřádaná upozornění — chybějící řádek v `notification_prefs` znamená
 * „všechno zapnuté" a nastavení ti lidé nikdy neviděli (schovával ho paywall).
 *
 * `createPgliteDb` aplikuje migrace nad PRÁZDNOU databází, takže tam 0043
 * nemá co udělat. Chování nad daty se proto ověřuje spuštěním téhož SQL
 * znovu — což je zároveň druhý běh, který musí dopadnout stejně (obnova ze
 * zálohy, ruční spuštění; viz „Datovou migraci pusť dvakrát" v CLAUDE.md).
 */
const MIGRATION = readFileSync(
  join(import.meta.dirname, '..', 'db', 'migrations', '0043_existing_accounts_email_opt_in.sql'),
  'utf8',
);

const BEFORE = new Date('2026-10-07T12:00:00Z');
const AFTER = new Date('2026-10-08T12:00:00Z');

describe('migrace 0043: starší účty mají hlídací e-maily vypnuté', () => {
  it('vypne je jen účtům z doby před změnou, které nastavení nemají', { timeout: 30_000 }, async () => {
    const db = await createPgliteDb();
    await db.insert(user).values([
      { id: 'old-no-prefs', name: 'A', email: 'a@danero.cz', createdAt: BEFORE },
      { id: 'old-with-prefs', name: 'B', email: 'b@danero.cz', createdAt: BEFORE },
      { id: 'new-no-prefs', name: 'C', email: 'c@danero.cz', createdAt: AFTER },
    ]);
    // někdejší předplatitel, který si nastavení uložil — tomu se nesmí změnit nic
    await db
      .insert(notificationPrefs)
      .values({ userId: 'old-with-prefs', emailEnabled: true, emailFrequency: 'WEEKLY' });

    await db.execute(sql.raw(MIGRATION));

    expect((await getNotificationPrefs(db, 'old-no-prefs')).emailEnabled).toBe(false);
    const kept = await getNotificationPrefs(db, 'old-with-prefs');
    expect(kept.emailEnabled).toBe(true);
    expect(kept.emailFrequency).toBe('WEEKLY');
    // nový účet nastavení vidí od začátku → běžné výchozí hodnoty, žádný řádek
    expect((await getNotificationPrefs(db, 'new-no-prefs')).emailEnabled).toBe(true);
    expect(await db.select().from(notificationPrefs)).toHaveLength(2);
  });

  it('vypnutý účet má jinak výchozí pravidla hlídače, ne prázdná', { timeout: 30_000 }, async () => {
    const db = await createPgliteDb();
    await db.insert(user).values({ id: 'old', name: 'A', email: 'a@danero.cz', createdAt: BEFORE });
    await db.execute(sql.raw(MIGRATION));

    // řádek vzniká jen se dvěma sloupci; zbytek musí doplnit výchozí hodnoty
    // tabulky tak, aby po zapnutí e-mailů hlídač hlídal to, co web slibuje
    const prefs = await getNotificationPrefs(db, 'old');
    const defaults = await getNotificationPrefs(db, 'nobody');
    expect({ ...prefs, userId: '', emailEnabled: true, updatedAt: null }).toEqual({
      ...defaults,
      userId: '',
      updatedAt: null,
    });
  });

  it('druhý běh nic nezmění — ani účtům, které mezitím přibyly nebo si e-maily zapnuly', { timeout: 30_000 }, async () => {
    const db = await createPgliteDb();
    await db.insert(user).values({ id: 'old', name: 'A', email: 'a@danero.cz', createdAt: BEFORE });
    await db.execute(sql.raw(MIGRATION));

    // mezi běhy: starší účet si e-maily zapne a zaregistruje se nový
    await db.update(notificationPrefs).set({ emailEnabled: true });
    await db.insert(user).values({ id: 'new', name: 'C', email: 'c@danero.cz', createdAt: AFTER });

    await db.execute(sql.raw(MIGRATION));

    expect((await getNotificationPrefs(db, 'old')).emailEnabled).toBe(true);
    expect((await getNotificationPrefs(db, 'new')).emailEnabled).toBe(true);
    expect(await db.select().from(notificationPrefs)).toHaveLength(1);
  });
});
