-- R-06 + R-02c: k zafixované metodě párování (migrace 0026) přibývá kurzová
-- soustava a výklad limitu 100k. Obojí mění už podaný rok zpětně stejně jako
-- párování (u kurzů jde o desítky tisíc Kč), a R-06 žádá jednu soustavu pro
-- celé zdaňovací období — patří tedy do fixace.
--
-- Existující fixace se dopočítají z profilu uživatele, tedy přesně z hodnot,
-- kterými se ty roky počítaly do téhle chvíle: migrace nesmí nikomu pohnout
-- s čísly, která už poslal na finanční úřad. Proto sloupce vznikají jako NULL,
-- naplní se z profilu a teprve pak dostanou NOT NULL.
ALTER TABLE "tax_year_settings" ADD COLUMN IF NOT EXISTS "fx_method" text;--> statement-breakpoint
ALTER TABLE "tax_year_settings" ADD COLUMN IF NOT EXISTS "limit_100k_strict" boolean;--> statement-breakpoint
UPDATE "tax_year_settings" AS t
SET "fx_method" = COALESCE(t."fx_method", p."fx_method"),
    "limit_100k_strict" = COALESCE(t."limit_100k_strict", p."limit_100k_strict")
FROM "taxpayer_profiles" AS p
WHERE p."user_id" = t."user_id";--> statement-breakpoint
-- fixace bez profilu je teoreticky nemožná (bez profilu se podklady negenerují),
-- ale NOT NULL potřebuje jistotu — zbytek dostane konzervativní default z docs/02
UPDATE "tax_year_settings" SET "fx_method" = 'UNIFIED' WHERE "fx_method" IS NULL;--> statement-breakpoint
UPDATE "tax_year_settings" SET "limit_100k_strict" = true WHERE "limit_100k_strict" IS NULL;--> statement-breakpoint
ALTER TABLE "tax_year_settings" ALTER COLUMN "fx_method" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tax_year_settings" ALTER COLUMN "limit_100k_strict" SET NOT NULL;
