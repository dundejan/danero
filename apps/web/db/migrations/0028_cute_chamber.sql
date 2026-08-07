ALTER TABLE "report_purchases" ADD COLUMN "revoked_at" timestamp;--> statement-breakpoint
ALTER TABLE "report_purchases" ADD COLUMN "revoked_reason" text;