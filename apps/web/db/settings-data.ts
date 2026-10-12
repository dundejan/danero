import { pgTable, text } from 'drizzle-orm/pg-core';
import { notificationPrefColumns, taxpayerProfileColumns, user } from './schema';

/**
 * Tabulky nastavení bez sloupců pořadí odeslání (`save_instance`,
 * `save_sequence`, migrace 0047) — tudy se daňový profil a nastavení
 * upozornění čtou a zapisují všude, kde na pořadí nezáleží.
 *
 * PROČ. Drizzle v `select()`, `insert()` i `returning()` jmenuje všechny
 * sloupce tabulky, i ty, které volající nenastavuje. Push do `main` spouští
 * migraci a build na Vercelu souběžně a pořadí nikdo nezaručuje
 * (`docs/08-provoz.md`, M-5): kdykoli nasazení migraci předběhne — nebo
 * migrace spadne —, skončil by každý dotaz na úplnou tabulku chybou
 * `column "save_instance" does not exist`. A profil čte každá stránka
 * aplikace, `/api/epo` i cron upozornění (revize R8, B1).
 *
 * Pohled, který ty dva sloupce nezná, je k databázi před migrací i po ní
 * stejně lhostejný. Úplné tabulky (`db/schema.ts`) používá jen zápis
 * s pořadím v `app/(app)/nastaveni/save.ts`, a ten si chybějící sloupec
 * ošetřuje sám. Pořadí odeslání navíc není údaj uživatele — do profilu ani do
 * exportu jeho dat nepatří, a tudy se do nich nedostane.
 *
 * Sloupce uživatele jsou tytéž objekty jako v `schema.ts`, takže se obě
 * podoby tabulky nemůžou rozejít (hlídá `test/settings-before-migration.test.ts`).
 * Mimo `schema.ts` jsou schválně: `drizzle-kit` bere každou tabulku, kterou
 * tam najde, a dvě se stejným jménem by mu rozbily snímek schématu.
 */
const userId = () =>
  text('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' });

export const taxpayerProfileData = pgTable('taxpayer_profiles', {
  userId: userId(),
  ...taxpayerProfileColumns,
});

export const notificationPrefData = pgTable('notification_prefs', {
  userId: userId(),
  ...notificationPrefColumns,
});
