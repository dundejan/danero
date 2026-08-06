-- Pravidlo 1 z CLAUDE.md: identifikátory anglicky. Sloupec nesl české
-- „druh" prorostlé z migrace 0008 přes engine až do formuláře.
ALTER TABLE "taxpayer_profiles" RENAME COLUMN "derivatives_expenses_per_druh" TO "derivatives_expenses_per_type";
