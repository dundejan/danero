CREATE TABLE "broker_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"broker" text NOT NULL,
	"label" text DEFAULT 'Trading212' NOT NULL,
	"credentials_encrypted" text NOT NULL,
	"last_synced_at" timestamp,
	"last_sync_status" text,
	"last_reconciliation" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "broker_accounts" ADD CONSTRAINT "broker_accounts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;