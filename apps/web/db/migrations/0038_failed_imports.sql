CREATE TABLE "failed_imports" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"batch_id" text NOT NULL,
	"filename" text NOT NULL,
	"byte_size" integer NOT NULL,
	"content_hash" text NOT NULL,
	"content" text NOT NULL,
	"reason" text NOT NULL,
	"reported_platform" text,
	"reported_note" text,
	"reported_at" timestamp,
	"status" text DEFAULT 'open' NOT NULL,
	"resolution_note" text,
	"resolved_at" timestamp,
	"resolved_batch_id" text,
	"notified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "failed_imports" ADD CONSTRAINT "failed_imports_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "failed_imports_user_hash_idx" ON "failed_imports" USING btree ("user_id","content_hash");--> statement-breakpoint
CREATE INDEX "failed_imports_status_idx" ON "failed_imports" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "failed_imports_batch_idx" ON "failed_imports" USING btree ("batch_id");