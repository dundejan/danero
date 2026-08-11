-- Vlastní pravidla hlídače (lib/notification-rules.ts): lhůty před osvobozením,
-- hranice čerpání limitů, kadence souhrnu a pravidelný přehled. Výchozí hodnoty
-- opisují chování, které měl hlídač natvrdo v kódu, takže se nikomu nezmění,
-- co mu chodí.
ALTER TABLE "notification_prefs" ADD COLUMN IF NOT EXISTS "time_test_lead_days" text DEFAULT '30,7' NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_prefs" ADD COLUMN IF NOT EXISTS "time_test_done" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_prefs" ADD COLUMN IF NOT EXISTS "limit_thresholds_pct" text DEFAULT '60,85,100' NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_prefs" ADD COLUMN IF NOT EXISTS "deadline_lead_days" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_prefs" ADD COLUMN IF NOT EXISTS "summary_frequency" text DEFAULT 'OFF' NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_prefs" ADD COLUMN IF NOT EXISTS "urgent_immediately" boolean DEFAULT true NOT NULL;
