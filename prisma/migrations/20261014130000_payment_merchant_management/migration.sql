ALTER TABLE "payment_orders" ADD COLUMN "merchant_revision_id" TEXT REFERENCES "payment_merchant_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "payment_merchants" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'EZFP',
  "environment" TEXT NOT NULL DEFAULT 'PRODUCTION',
  "is_active" BOOLEAN NOT NULL DEFAULT false,
  "active_slot" TEXT,
  "current_revision_id" TEXT,
  "version" INTEGER NOT NULL DEFAULT 0,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" DATETIME NOT NULL,
  CONSTRAINT "payment_merchants_current_revision_id_fkey" FOREIGN KEY ("current_revision_id") REFERENCES "payment_merchant_revisions"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "payment_merchant_revisions" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "merchant_id" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "merchant_no" TEXT NOT NULL,
  "api_base_url" TEXT NOT NULL,
  "private_key_ciphertext" TEXT NOT NULL,
  "private_key_nonce" TEXT NOT NULL,
  "private_key_tag" TEXT NOT NULL,
  "platform_key_ciphertext" TEXT NOT NULL,
  "platform_key_nonce" TEXT NOT NULL,
  "platform_key_tag" TEXT NOT NULL,
  "refunds_enabled" BOOLEAN NOT NULL DEFAULT false,
  "created_by" TEXT NOT NULL,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payment_merchant_revisions_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "payment_merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "payment_merchants_name_key" ON "payment_merchants"("name");
CREATE UNIQUE INDEX "payment_merchants_active_slot_key" ON "payment_merchants"("active_slot");
CREATE UNIQUE INDEX "payment_merchants_current_revision_id_key" ON "payment_merchants"("current_revision_id");
CREATE INDEX "payment_merchants_provider_environment_is_active_idx" ON "payment_merchants"("provider","environment","is_active");
CREATE UNIQUE INDEX "payment_merchant_revisions_merchant_id_revision_key" ON "payment_merchant_revisions"("merchant_id","revision");
CREATE INDEX "payment_merchant_revisions_merchant_id_created_at_idx" ON "payment_merchant_revisions"("merchant_id","created_at");
CREATE INDEX "payment_orders_merchant_revision_id_idx" ON "payment_orders"("merchant_revision_id");

PRAGMA foreign_keys=OFF;
CREATE TABLE "new_payment_orders" (
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
  "merchant_revision_id" TEXT,
  "provider_trade_no" TEXT,
  "provider_pay_type" TEXT,
  "provider_pay_info" TEXT,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" DATETIME NOT NULL,
  "paid_at" DATETIME,
  CONSTRAINT "payment_orders_merchant_revision_id_fkey" FOREIGN KEY ("merchant_revision_id") REFERENCES "payment_merchant_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "payment_orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_payment_orders" SELECT "id","order_no","idempotency_key","user_id","package_id","package_coins","package_bonus","coin_amount","amount_cny_cents","currency","status","provider",NULL,"provider_trade_no","provider_pay_type","provider_pay_info","created_at","updated_at","paid_at" FROM "payment_orders";
DROP TABLE "payment_orders";
ALTER TABLE "new_payment_orders" RENAME TO "payment_orders";
CREATE UNIQUE INDEX "payment_orders_order_no_key" ON "payment_orders"("order_no");
CREATE UNIQUE INDEX "payment_orders_provider_trade_no_key" ON "payment_orders"("provider_trade_no");
CREATE UNIQUE INDEX "payment_orders_user_id_idempotency_key_key" ON "payment_orders"("user_id","idempotency_key");
CREATE INDEX "payment_orders_user_id_created_at_idx" ON "payment_orders"("user_id","created_at");
CREATE INDEX "payment_orders_status_created_at_idx" ON "payment_orders"("status","created_at");
CREATE INDEX "payment_orders_merchant_revision_id_idx" ON "payment_orders"("merchant_revision_id");
PRAGMA foreign_keys=ON;

INSERT INTO "admin_role_permissions" ("role_id", "permission")
SELECT "id", permission FROM "admin_roles" CROSS JOIN (
  SELECT 'payments.merchants.read' AS permission UNION ALL
  SELECT 'payments.merchants.manage' UNION ALL
  SELECT 'payments.merchants.secrets.manage' UNION ALL
  SELECT 'payments.merchants.test'
) WHERE "code" = 'OWNER';
INSERT INTO "admin_roles" ("id", "code", "name", "system", "version", "created_at", "updated_at")
VALUES ('system_payment_merchant_manager', 'PAYMENT_MERCHANT_MANAGER', '支付商户管理员', 1, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT INTO "admin_role_permissions" ("role_id", "permission") VALUES
  ('system_payment_merchant_manager', 'payments.merchants.read'),
  ('system_payment_merchant_manager', 'payments.merchants.manage'),
  ('system_payment_merchant_manager', 'payments.merchants.secrets.manage'),
  ('system_payment_merchant_manager', 'payments.merchants.test');

