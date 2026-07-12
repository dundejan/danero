ALTER TABLE "broker_accounts" ALTER COLUMN "label" SET DEFAULT 'Trading 212';
--> statement-breakpoint
UPDATE "broker_accounts" SET "label" = 'Trading 212' WHERE "label" = 'Trading212';
