-- K5-08: transakce bez dávky nesmí existovat.
--
-- Pád spojení uprostřed importu uměl uložit transakce a dávku už ne. Takový
-- řádek se počítá do daně (lib/portfolio.ts čte transactions bez vazby na
-- dávky), ale uživatel ho nevidí v historii a vrátit ho nejde — undoImportBatch
-- maže podle existující dávky. Nejdřív se proto osiřelým řádkům dávka dopočítá
-- ze stopy, kterou po sobě nechaly (drží pořád batch_id té mrtvé), a teprve
-- pak se stav zamkne cizím klíčem.
--
-- Idempotentní schválně (druhý běh po obnově ze zálohy): podruhé už žádný
-- osiřelý řádek není a přidání cizího klíče je obalené v DO bloku.
INSERT INTO "import_batches" (
  "id", "user_id", "broker", "filename",
  "added", "duplicates", "error_count", "skipped_count", "warning_count",
  "issues", "created_at"
)
SELECT
  t."batch_id",
  min(t."user_id"),
  min(t."broker"),
  'Obnovený import (přerušené ukládání)',
  count(*)::int, 0, 0, 0, 0,
  '{"errors":[],"skipped":[],"warnings":[]}'::jsonb,
  min(t."created_at")
FROM "transactions" t
WHERE NOT EXISTS (SELECT 1 FROM "import_batches" b WHERE b."id" = t."batch_id")
GROUP BY t."batch_id"
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transactions" ADD CONSTRAINT "transactions_batch_id_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."import_batches"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
