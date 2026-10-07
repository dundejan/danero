-- Danero je od 8. 10. 2026 celé zdarma: placené tarify, Stripe i paywall jsou
-- pryč a s nimi tabulky, které držely stav předplatného a nákupy podkladů.
--
-- ⚠️ Schválně SAMOSTATNÝ commit až po nasazení kódu, který tyhle tabulky
-- nečte. Migrace běží souběžně s buildem (viz docs/08-provoz.md): kdyby šla
-- ve stejném pushi jako odstranění kódu, starší nasazení by po dobu buildu
-- — a při nepovedeném buildu natrvalo — padalo na dotazech do tabulek, které
-- už neexistují.
--
-- Mazat tu nebylo co cizího: jediné předplatné v produkci bylo provozovatelovo
-- vlastní, zkušební (koupené, vrácené a zrušené 9. 8. 2026), nákup podkladů
-- žádný. Doklady o té jedné platbě drží Stripe.
--
-- Kdyby se platby někdy vracely: poslední nasazený stav s nimi je pod značkou
-- `placene-tarify`, schéma obou tabulek v `apps/web/db/schema.ts` tamtéž.
--
-- `IF EXISTS` schválně — migrace musí projít i podruhé (obnova ze zálohy
-- pořízené po ní, ruční spuštění, přesun databáze).
DROP TABLE IF EXISTS "report_purchases" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "subscriptions" CASCADE;
