-- R-13b: přepínač okamžiku příjmu z prodeje nakrátko se ruší. Bezpečná
-- varianta (příjem plyne už prodejem) je nově jediné chování enginu, takže
-- sloupec nemá co ovlivňovat — uložená hodnota `false` by jen mlčky lhala,
-- že se počítá mírnějším výkladem.
-- IF EXISTS kvůli druhému běhu migrace (obnova ze zálohy, ruční spuštění).
ALTER TABLE "taxpayer_profiles" DROP COLUMN IF EXISTS "short_sale_income_on_sale";
