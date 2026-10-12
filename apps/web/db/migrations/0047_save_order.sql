-- Revize R7 (M3): pořadí odeslání formuláře nastavení.
--
-- Auto-save posílá odeslání téhož formuláře za sebou — až na odchod ze stránky:
-- co čeká, jde hned a souběžně s tím, co ještě běží (jiná cesta, na Vercelu
-- jiná funkce), a na server můžou dorazit obráceně. Kdo přepnul párování tam
-- a zpět a zavřel panel, skončil na starší volbě.
--
-- Řádek si proto pamatuje, které odeslání ho zapsalo naposledy: označení
-- formuláře (jedno na načtení stránky) a pořadové číslo. Starší odeslání
-- téhož formuláře, které dorazí později, už nezapíše nic. Bez paměti na
-- serveru to rozhodnout nejde: opožděné odeslání vypadá stejně jako jediné.
--
-- Sloupce jsou prázdné, dokud řádek nezapíše odeslání s pořadím (první
-- uložení tlačítkem ho nenese) — prázdná hodnota znamená „zapiš“. Žádná data
-- se nepřepisují.
--
-- Idempotentní: druhý běh (obnova ze zálohy, ruční spuštění) sloupce najde.
ALTER TABLE "notification_prefs" ADD COLUMN IF NOT EXISTS "save_instance" text;--> statement-breakpoint
ALTER TABLE "notification_prefs" ADD COLUMN IF NOT EXISTS "save_sequence" integer;--> statement-breakpoint
ALTER TABLE "taxpayer_profiles" ADD COLUMN IF NOT EXISTS "save_instance" text;--> statement-breakpoint
ALTER TABLE "taxpayer_profiles" ADD COLUMN IF NOT EXISTS "save_sequence" integer;
