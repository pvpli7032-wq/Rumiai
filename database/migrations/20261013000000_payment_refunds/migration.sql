CREATE TABLE "payment_refunds" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "payment_order_id" TEXT NOT NULL,
 "refund_no" TEXT NOT NULL,
 "provider_refund_no" TEXT,
 "actor_id" TEXT NOT NULL,
 "reason" TEXT NOT NULL,
 "amount_cny_cents" INTEGER NOT NULL,
 "coin_amount" INTEGER NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'PROCESSING',
 "error_code" TEXT,
 "attempted_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "completed_at" DATETIME,
 CONSTRAINT "payment_refunds_payment_order_id_fkey" FOREIGN KEY ("payment_order_id") REFERENCES "payment_orders" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "payment_refunds_payment_order_id_key" ON "payment_refunds"("payment_order_id");
CREATE UNIQUE INDEX "payment_refunds_refund_no_key" ON "payment_refunds"("refund_no");
CREATE UNIQUE INDEX "payment_refunds_provider_refund_no_key" ON "payment_refunds"("provider_refund_no");
CREATE INDEX "payment_refunds_status_created_at_idx" ON "payment_refunds"("status", "created_at");
ALTER TABLE "coin_transactions" ADD COLUMN "refund_id" TEXT REFERENCES "payment_refunds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "coin_transactions" ADD COLUMN "refund_release_id" TEXT REFERENCES "payment_refunds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "coin_transactions_refund_id_key" ON "coin_transactions"("refund_id");
CREATE UNIQUE INDEX "coin_transactions_refund_release_id_key" ON "coin_transactions"("refund_release_id");
