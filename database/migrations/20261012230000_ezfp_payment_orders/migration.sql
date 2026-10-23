ALTER TABLE "coin_packages" ADD COLUMN "price_cny_cents" INTEGER;

CREATE TABLE "payment_orders" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "order_no" TEXT NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "package_id" TEXT,
  "package_coins" INTEGER NOT NULL,
  "package_bonus" INTEGER NOT NULL,
  "coin_amount" INTEGER NOT NULL,
  "amount_cny_cents" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'CNY',
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "provider" TEXT NOT NULL DEFAULT 'EZFP',
  "provider_trade_no" TEXT,
  "provider_pay_type" TEXT,
  "provider_pay_info" TEXT,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" DATETIME NOT NULL,
  "paid_at" DATETIME,
  CONSTRAINT "payment_orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "payment_orders_order_no_key" ON "payment_orders"("order_no");
CREATE UNIQUE INDEX "payment_orders_provider_trade_no_key" ON "payment_orders"("provider_trade_no");
CREATE UNIQUE INDEX "payment_orders_user_id_idempotency_key_key" ON "payment_orders"("user_id", "idempotency_key");
CREATE INDEX "payment_orders_user_id_created_at_idx" ON "payment_orders"("user_id", "created_at");
CREATE INDEX "payment_orders_status_created_at_idx" ON "payment_orders"("status", "created_at");

CREATE TABLE "coin_transactions_new" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "user_id" TEXT NOT NULL,
  "payment_order_id" TEXT,
  "amount" INTEGER NOT NULL,
  "type" TEXT NOT NULL,
  "description" TEXT,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "coin_transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "coin_transactions_payment_order_id_fkey" FOREIGN KEY ("payment_order_id") REFERENCES "payment_orders" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "coin_transactions_new" ("id", "user_id", "payment_order_id", "amount", "type", "description", "created_at")
SELECT "id", "user_id", NULL, "amount", "type", "description", "created_at" FROM "coin_transactions";

DROP TABLE "coin_transactions";
ALTER TABLE "coin_transactions_new" RENAME TO "coin_transactions";

CREATE UNIQUE INDEX "coin_transactions_payment_order_id_key" ON "coin_transactions"("payment_order_id");
CREATE INDEX "coin_transactions_user_id_idx" ON "coin_transactions"("user_id");
CREATE INDEX "coin_transactions_type_idx" ON "coin_transactions"("type");
CREATE INDEX "coin_transactions_created_at_idx" ON "coin_transactions"("created_at");
