-- Danero je od 8. 10. 2026 celé zdarma, takže hlídací e-maily (dřív součást
-- placeného tarifu) nově dostává každý. Účty založené PŘED tou změnou ale
-- nastavení upozornění nikdy neviděly — stránka jim místo něj ukazovala nabídku
-- předplatného — a chybějící řádek v `notification_prefs` znamená „všechno
-- zapnuté". První běh hlídače po nasazení by jim tak bez varování poslal
-- všechna nastřádaná upozornění najednou.
--
-- Těmhle účtům proto e-maily zůstávají VYPNUTÉ, dokud si je sami nezapnou
-- (Nastavení → Upozornění; v aplikaci upozornění vidí dál). Kdo se registruje
-- po změně, nastavení vidí od první minuty a platí pro něj běžné výchozí hodnoty.
--
-- Komu už řádek existuje (měl předplatné a nastavení si uložil), tomu se nic
-- nemění. Hranice je pevné datum, ne „teď": migrace musí při druhém běhu
-- (obnova ze zálohy, ruční spuštění) udělat totéž co při prvním, ne vypnout
-- e-maily i účtům, které mezitím přibyly.
INSERT INTO "notification_prefs" ("user_id", "email_enabled")
SELECT u."id", false
FROM "user" u
WHERE u."created_at" < TIMESTAMP '2026-10-08 00:00:00'
  AND NOT EXISTS (
    SELECT 1 FROM "notification_prefs" p WHERE p."user_id" = u."id"
  );
