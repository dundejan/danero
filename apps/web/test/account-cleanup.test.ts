import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createPgliteDb } from '@/db';
import { user, verification, waitlist } from '@/db/schema';
import { purgeAfterAccountDeletion } from '@/lib/account-cleanup';

/**
 * K4-07 a K4-08: hard delete účtu shodí kaskádou všechno, co visí na
 * `user_id` — jenže `verification` ani `waitlist` na něm nevisí. Zůstával tak
 * nevyzvednutý odkaz na obnovu hesla s id smazaného uživatele (do vypršení
 * a do nejbližšího úklidového cronu, tedy až o den víc) a adresa v čekací
 * listině, ačkoli /soukromi slibuje smazání „všech tvých dat“.
 */
describe('úklid po zrušení účtu', () => {
  it('smaže vydané odkazy na obnovu hesla i adresu v čekací listině', { timeout: 30_000 }, async () => {
    const db = await createPgliteDb();
    await db.insert(user).values([
      { id: 'u1', name: 'Mizí', email: 'Mizi@Danero.cz' },
      { id: 'u2', name: 'Zůstává', email: 'zustava@danero.cz' },
    ]);
    await db.insert(waitlist).values([
      { email: 'mizi@danero.cz' },
      { email: 'nekdo-jiny@danero.cz' },
    ]);
    const expiresAt = new Date(Date.now() + 3_600_000);
    await db.insert(verification).values([
      { id: 'v1', identifier: 'reset-password:aaa', value: 'u1', expiresAt },
      { id: 'v2', identifier: 'reset-password:bbb', value: 'u2', expiresAt },
      // 2FA se úklid netýká — maže se právě jedna třída řádků
      { id: 'v3', identifier: '2fa-otp-xyz', value: 'u1', expiresAt },
    ]);

    // e-mail chodí ze session tak, jak ho uživatel napsal (i s velkými písmeny)
    await purgeAfterAccountDeletion(db, { userId: 'u1', email: 'Mizi@Danero.cz' });

    const zbyleTokeny = await db.select().from(verification);
    expect(zbyleTokeny.map((row) => row.id).sort()).toEqual(['v2', 'v3']);
    const zbyleAdresy = await db.select().from(waitlist);
    expect(zbyleAdresy.map((row) => row.email)).toEqual(['nekdo-jiny@danero.cz']);
  });

  it('server action úklid opravdu volá (jinak by tenhle test hlídal mrtvý kód)', () => {
    const actions = readFileSync(
      join(import.meta.dirname, '..', 'app', '(app)', 'nastaveni', 'actions.ts'),
      'utf8',
    );
    const deleteAction = actions.slice(actions.indexOf('export async function deleteAccountAction'));
    expect(deleteAction).toContain('purgeAfterAccountDeletion');
    // až po deleteUser — dřív není ověřené heslo
    expect(deleteAction.indexOf('api.deleteUser')).toBeLessThan(
      deleteAction.indexOf('purgeAfterAccountDeletion'),
    );
  });
});
