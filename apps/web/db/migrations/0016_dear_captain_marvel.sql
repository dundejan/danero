-- Zrušení oddělených portfolií (G8c → pryč): každý účet měl právě jedno
-- portfolio pf-{userId}, kolaps na userId je proto bezztrátový. Pořadí je
-- důležité: nejdřív FK vazby a PK obsahující portfolio_id, pak sloupce,
-- nakonec samotná tabulka portfolios.
ALTER TABLE "broker_accounts" DROP CONSTRAINT "broker_accounts_portfolio_id_portfolios_id_fk";--> statement-breakpoint
ALTER TABLE "import_batches" DROP CONSTRAINT "import_batches_portfolio_id_portfolios_id_fk";--> statement-breakpoint
ALTER TABLE "instrument_aliases" DROP CONSTRAINT "instrument_aliases_portfolio_id_portfolios_id_fk";--> statement-breakpoint
ALTER TABLE "instrument_prices" DROP CONSTRAINT "instrument_prices_portfolio_id_portfolios_id_fk";--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_portfolio_id_portfolios_id_fk";--> statement-breakpoint
ALTER TABLE "taxpayer_profiles" DROP CONSTRAINT "taxpayer_profiles_portfolio_id_portfolios_id_fk";--> statement-breakpoint
ALTER TABLE "transactions" DROP CONSTRAINT "transactions_portfolio_id_portfolios_id_fk";--> statement-breakpoint
DROP INDEX "import_batches_portfolio_created_idx";--> statement-breakpoint
DROP INDEX "transactions_portfolio_date_idx";--> statement-breakpoint
ALTER TABLE "instrument_aliases" DROP CONSTRAINT "instrument_aliases_portfolio_id_broker_symbol_pk";--> statement-breakpoint
ALTER TABLE "instrument_prices" DROP CONSTRAINT "instrument_prices_portfolio_id_isin_pk";--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_portfolio_id_dedupe_key_pk";--> statement-breakpoint
ALTER TABLE "transactions" DROP CONSTRAINT "transactions_portfolio_id_dedupe_key_pk";--> statement-breakpoint
ALTER TABLE "taxpayer_profiles" DROP CONSTRAINT "taxpayer_profiles_pkey";--> statement-breakpoint
-- Dedup před kolapsem PK: účet s více portfolii (UI je umělo založit) by jinak
-- migraci shodil na duplicate key. Deterministicky přežívá řádek s nejmenším
-- portfolio_id (výchozí pf-{userId} řadí před pf-{uuid} jen náhodou — jde
-- čistě o determinismus, reálné účty mají portfolio jedno).
DELETE FROM "taxpayer_profiles" a USING "taxpayer_profiles" b WHERE a.user_id = b.user_id AND a.portfolio_id > b.portfolio_id;--> statement-breakpoint
DELETE FROM "instrument_aliases" a USING "instrument_aliases" b WHERE a.user_id = b.user_id AND a.broker = b.broker AND a.symbol = b.symbol AND a.portfolio_id > b.portfolio_id;--> statement-breakpoint
DELETE FROM "instrument_prices" a USING "instrument_prices" b WHERE a.user_id = b.user_id AND a.isin = b.isin AND a.portfolio_id > b.portfolio_id;--> statement-breakpoint
DELETE FROM "notifications" a USING "notifications" b WHERE a.user_id = b.user_id AND a.dedupe_key = b.dedupe_key AND a.portfolio_id > b.portfolio_id;--> statement-breakpoint
DELETE FROM "transactions" a USING "transactions" b WHERE a.user_id = b.user_id AND a.dedupe_key = b.dedupe_key AND a.portfolio_id > b.portfolio_id;--> statement-breakpoint
ALTER TABLE "taxpayer_profiles" ADD PRIMARY KEY ("user_id");--> statement-breakpoint
ALTER TABLE "instrument_aliases" ADD CONSTRAINT "instrument_aliases_user_id_broker_symbol_pk" PRIMARY KEY("user_id","broker","symbol");--> statement-breakpoint
ALTER TABLE "instrument_prices" ADD CONSTRAINT "instrument_prices_user_id_isin_pk" PRIMARY KEY("user_id","isin");--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_dedupe_key_pk" PRIMARY KEY("user_id","dedupe_key");--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_dedupe_key_pk" PRIMARY KEY("user_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "import_batches_user_created_idx" ON "import_batches" USING btree ("user_id","created_at");--> statement-breakpoint
ALTER TABLE "broker_accounts" DROP COLUMN "portfolio_id";--> statement-breakpoint
ALTER TABLE "import_batches" DROP COLUMN "portfolio_id";--> statement-breakpoint
ALTER TABLE "instrument_aliases" DROP COLUMN "portfolio_id";--> statement-breakpoint
ALTER TABLE "instrument_prices" DROP COLUMN "portfolio_id";--> statement-breakpoint
ALTER TABLE "notifications" DROP COLUMN "portfolio_id";--> statement-breakpoint
ALTER TABLE "taxpayer_profiles" DROP COLUMN "portfolio_id";--> statement-breakpoint
ALTER TABLE "transactions" DROP COLUMN "portfolio_id";--> statement-breakpoint
DROP TABLE "portfolios";
