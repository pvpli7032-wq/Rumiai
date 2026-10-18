CREATE TABLE "payment_reconciliation_batches" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "provider" TEXT NOT NULL DEFAULT 'EZFP',
  "source_sha256" TEXT NOT NULL UNIQUE,
  "imported_by_id" TEXT NOT NULL,
  "import_reason" TEXT NOT NULL,
  "row_count" INTEGER NOT NULL,
  "matched_row_count" INTEGER NOT NULL,
  "exception_row_count" INTEGER NOT NULL,
  "gross_cny_cents" BIGINT NOT NULL,
  "fee_cny_cents" BIGINT NOT NULL,
  "period_start" DATETIME NOT NULL,
  "period_end" DATETIME NOT NULL,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "payment_reconciliation_batches_created_at_idx" ON "payment_reconciliation_batches"("created_at");

CREATE TABLE "payment_reconciliation_entries" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "batch_id" TEXT NOT NULL,
  "line_number" INTEGER NOT NULL,
  "provider_trade_no" TEXT NOT NULL,
  "order_no" TEXT NOT NULL,
  "gross_cny_cents" INTEGER NOT NULL,
  "fee_cny_cents" INTEGER NOT NULL,
  "paid_at" DATETIME NOT NULL,
  "match_status" TEXT NOT NULL,
  "exception_code" TEXT,
  "payment_order_id" TEXT,
  "internal_amount_cny_cents" INTEGER,
  "internal_order_status" TEXT,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payment_reconciliation_entries_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "payment_reconciliation_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "payment_reconciliation_entries_payment_order_id_fkey" FOREIGN KEY ("payment_order_id") REFERENCES "payment_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "payment_reconciliation_entries_batch_id_line_number_key" ON "payment_reconciliation_entries"("batch_id", "line_number");
CREATE INDEX "payment_reconciliation_entries_batch_id_match_status_idx" ON "payment_reconciliation_entries"("batch_id", "match_status");
CREATE INDEX "payment_reconciliation_entries_provider_trade_no_idx" ON "payment_reconciliation_entries"("provider_trade_no");
CREATE INDEX "payment_reconciliation_entries_order_no_idx" ON "payment_reconciliation_entries"("order_no");

-- Allow synthetic rows for paid local orders absent from the imported statement.
CREATE TABLE "new_payment_reconciliation_entries" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "batch_id" TEXT NOT NULL,
  "entry_source" TEXT NOT NULL DEFAULT 'STATEMENT',
  "line_number" INTEGER,
  "provider_trade_no" TEXT,
  "order_no" TEXT NOT NULL,
  "gross_cny_cents" INTEGER,
  "fee_cny_cents" INTEGER,
  "paid_at" DATETIME NOT NULL,
  "match_status" TEXT NOT NULL,
  "exception_code" TEXT,
  "payment_order_id" TEXT,
  "internal_amount_cny_cents" INTEGER,
  "internal_order_status" TEXT,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "new_payment_reconciliation_entries_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "payment_reconciliation_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "new_payment_reconciliation_entries_payment_order_id_fkey" FOREIGN KEY ("payment_order_id") REFERENCES "payment_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_payment_reconciliation_entries" ("id","batch_id","entry_source","line_number","provider_trade_no","order_no","gross_cny_cents","fee_cny_cents","paid_at","match_status","exception_code","payment_order_id","internal_amount_cny_cents","internal_order_status","created_at")
SELECT "id","batch_id",'STATEMENT',"line_number","provider_trade_no","order_no","gross_cny_cents","fee_cny_cents","paid_at","match_status","exception_code","payment_order_id","internal_amount_cny_cents","internal_order_status","created_at" FROM "payment_reconciliation_entries";
DROP TABLE "payment_reconciliation_entries";
ALTER TABLE "new_payment_reconciliation_entries" RENAME TO "payment_reconciliation_entries";
CREATE UNIQUE INDEX "payment_reconciliation_entries_batch_id_line_number_key" ON "payment_reconciliation_entries"("batch_id", "line_number");
CREATE INDEX "payment_reconciliation_entries_batch_id_match_status_idx" ON "payment_reconciliation_entries"("batch_id", "match_status");
CREATE INDEX "payment_reconciliation_entries_provider_trade_no_idx" ON "payment_reconciliation_entries"("provider_trade_no");
CREATE INDEX "payment_reconciliation_entries_order_no_idx" ON "payment_reconciliation_entries"("order_no");

INSERT INTO "admin_role_permissions" ("role_id", "permission")
SELECT "id", 'finance.reconciliation.import' FROM "admin_roles" WHERE "code" = 'OWNER' AND "system" = 1;
INSERT INTO "admin_role_permissions" ("role_id", "permission")
SELECT "id", 'finance.reconciliation.import' FROM "admin_roles" WHERE "code" = 'FINANCE_MANAGER' AND "system" = 1;
