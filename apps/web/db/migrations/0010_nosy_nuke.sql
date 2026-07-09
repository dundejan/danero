CREATE TABLE "portfolios" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "portfolios" ADD CONSTRAINT "portfolios_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
INSERT INTO "portfolios" ("id", "user_id", "name") SELECT 'pf-' || "id", "id", 'Moje portfolio' FROM "user";--> statement-breakpoint
ALTER TABLE "broker_accounts" ADD COLUMN "portfolio_id" text;--> statement-breakpoint
ALTER TABLE "import_batches" ADD COLUMN "portfolio_id" text;--> statement-breakpoint
ALTER TABLE "instrument_aliases" ADD COLUMN "portfolio_id" text;--> statement-breakpoint
ALTER TABLE "instrument_prices" ADD COLUMN "portfolio_id" text;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "portfolio_id" text;--> statement-breakpoint
ALTER TABLE "taxpayer_profiles" ADD COLUMN "portfolio_id" text;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "portfolio_id" text;--> statement-breakpoint
UPDATE "broker_accounts" SET "portfolio_id" = 'pf-' || "user_id";--> statement-breakpoint
UPDATE "import_batches" SET "portfolio_id" = 'pf-' || "user_id";--> statement-breakpoint
UPDATE "instrument_aliases" SET "portfolio_id" = 'pf-' || "user_id";--> statement-breakpoint
UPDATE "instrument_prices" SET "portfolio_id" = 'pf-' || "user_id";--> statement-breakpoint
UPDATE "notifications" SET "portfolio_id" = 'pf-' || "user_id";--> statement-breakpoint
UPDATE "taxpayer_profiles" SET "portfolio_id" = 'pf-' || "user_id";--> statement-breakpoint
UPDATE "transactions" SET "portfolio_id" = 'pf-' || "user_id";--> statement-breakpoint
ALTER TABLE "broker_accounts" ALTER COLUMN "portfolio_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "import_batches" ALTER COLUMN "portfolio_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "instrument_aliases" ALTER COLUMN "portfolio_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "instrument_prices" ALTER COLUMN "portfolio_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ALTER COLUMN "portfolio_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "taxpayer_profiles" ALTER COLUMN "portfolio_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "portfolio_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "instrument_aliases" DROP CONSTRAINT "instrument_aliases_user_id_broker_symbol_pk";--> statement-breakpoint
ALTER TABLE "instrument_prices" DROP CONSTRAINT "instrument_prices_user_id_isin_pk";--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_user_id_dedupe_key_pk";--> statement-breakpoint
ALTER TABLE "transactions" DROP CONSTRAINT "transactions_user_id_dedupe_key_pk";--> statement-breakpoint
ALTER TABLE "taxpayer_profiles" DROP CONSTRAINT "taxpayer_profiles_pkey";--> statement-breakpoint
ALTER TABLE "instrument_aliases" ADD CONSTRAINT "instrument_aliases_portfolio_id_broker_symbol_pk" PRIMARY KEY("portfolio_id","broker","symbol");--> statement-breakpoint
ALTER TABLE "instrument_prices" ADD CONSTRAINT "instrument_prices_portfolio_id_isin_pk" PRIMARY KEY("portfolio_id","isin");--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_portfolio_id_dedupe_key_pk" PRIMARY KEY("portfolio_id","dedupe_key");--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_portfolio_id_dedupe_key_pk" PRIMARY KEY("portfolio_id","dedupe_key");--> statement-breakpoint
ALTER TABLE "taxpayer_profiles" ADD CONSTRAINT "taxpayer_profiles_pkey" PRIMARY KEY("portfolio_id");--> statement-breakpoint
ALTER TABLE "broker_accounts" ADD CONSTRAINT "broker_accounts_portfolio_id_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."portfolios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_portfolio_id_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."portfolios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instrument_aliases" ADD CONSTRAINT "instrument_aliases_portfolio_id_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."portfolios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instrument_prices" ADD CONSTRAINT "instrument_prices_portfolio_id_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."portfolios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_portfolio_id_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."portfolios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "taxpayer_profiles" ADD CONSTRAINT "taxpayer_profiles_portfolio_id_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."portfolios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_portfolio_id_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."portfolios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transactions_portfolio_date_idx" ON "transactions" USING btree ("portfolio_id","tx_date");
