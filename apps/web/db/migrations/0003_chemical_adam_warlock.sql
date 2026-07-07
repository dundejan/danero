CREATE TABLE "notifications" (
	"user_id" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"emailed_at" timestamp,
	CONSTRAINT "notifications_user_id_dedupe_key_pk" PRIMARY KEY("user_id","dedupe_key")
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;