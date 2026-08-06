-- Pořadí událostí ze Stripe (C-3) + doklad o zaplacení u jednorázových nákupů (E-4).
-- `IF NOT EXISTS`: migrace musí projít i na databázi, kde sloupec vznikl ručně
-- (hotfix na produkci) — jinak by se zasekl celý migrační krok deploye.
ALTER TABLE "report_purchases" ADD COLUMN IF NOT EXISTS "stripe_customer_id" text;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "last_event_at" timestamp;
