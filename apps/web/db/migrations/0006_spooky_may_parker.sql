CREATE TABLE "instrument_aliases" (
	"user_id" text NOT NULL,
	"broker" text NOT NULL,
	"symbol" text NOT NULL,
	"isin" text NOT NULL,
	"currency" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "instrument_aliases_user_id_broker_symbol_pk" PRIMARY KEY("user_id","broker","symbol")
);
--> statement-breakpoint
ALTER TABLE "instrument_aliases" ADD CONSTRAINT "instrument_aliases_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;