ALTER TABLE "failed_imports" ALTER COLUMN "content" DROP NOT NULL;--> statement-breakpoint
UPDATE "failed_imports" SET "content" = NULL WHERE "status" <> 'open';
