ALTER TABLE "notification_prefs" ADD COLUMN "calendar_emails" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_prefs" ADD COLUMN "email_frequency" text DEFAULT 'DAILY' NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_prefs" ADD COLUMN "last_digest_at" timestamp;