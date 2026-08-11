-- Naléhavost události (prolomený limit, osvobození do týdne, blížící se termín)
-- se ukládá při vzniku: jedině tam se ví, kolik dní doopravdy zbývá. Z názvu
-- typu `TIME_TEST_30` to vyčíst nejde — při lhůtách bez krátkého intervalu do
-- něj spadne i pozice den před osvobozením. Staré řádky zůstávají nenaléhavé.
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "urgent" boolean DEFAULT false NOT NULL;
