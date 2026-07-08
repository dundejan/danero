CREATE TABLE "instrument_prices" (
	"user_id" text NOT NULL,
	"isin" text NOT NULL,
	"price" text NOT NULL,
	"currency" text NOT NULL,
	"source" text NOT NULL,
	"as_of" timestamp NOT NULL,
	CONSTRAINT "instrument_prices_user_id_isin_pk" PRIMARY KEY("user_id","isin")
);
--> statement-breakpoint
ALTER TABLE "instrument_prices" ADD CONSTRAINT "instrument_prices_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;