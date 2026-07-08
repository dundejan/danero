CREATE TABLE "fx_rates" (
	"day" text NOT NULL,
	"currency" text NOT NULL,
	"rate" numeric(18, 6) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "fx_rates_day_currency_pk" PRIMARY KEY("day","currency")
);
