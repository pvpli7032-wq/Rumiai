-- Membership catalogue, immutable purchase snapshots, grants, usage, and refunds.
CREATE TABLE "membership_plans" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "duration_days" INTEGER NOT NULL,
  "price_cents" INTEGER,
  "benefits_json" TEXT NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "version" INTEGER NOT NULL DEFAULT 0,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "membership_plans_code_key" ON "membership_plans"("code");
CREATE INDEX "membership_plans_is_active_sort_order_idx" ON "membership_plans"("is_active", "sort_order");

CREATE TABLE "membership_policies" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "refund_window_hours" INTEGER NOT NULL DEFAULT 24,
  "usage_charge_period_hours" INTEGER NOT NULL DEFAULT 24,
  "version" INTEGER NOT NULL DEFAULT 0,
  "updated_at" DATETIME NOT NULL
);

CREATE TABLE "membership_orders" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "order_no" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "plan_id" TEXT NOT NULL,
  "payment_order_id" TEXT,
  "amount_cents" INTEGER NOT NULL,
  "duration_days" INTEGER NOT NULL,
  "refund_window_hours" INTEGER NOT NULL,
  "usage_charge_period_hours" INTEGER NOT NULL,
  "benefits_json" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "paid_at" DATETIME,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" DATETIME NOT NULL,
  CONSTRAINT "membership_orders_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "membership_plans" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "membership_orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "membership_orders_payment_order_id_fkey" FOREIGN KEY ("payment_order_id") REFERENCES "payment_orders" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "membership_orders_order_no_key" ON "membership_orders"("order_no");
CREATE UNIQUE INDEX "membership_orders_payment_order_id_key" ON "membership_orders"("payment_order_id");
CREATE UNIQUE INDEX "membership_orders_user_id_idempotency_key_key" ON "membership_orders"("user_id", "idempotency_key");
CREATE INDEX "membership_orders_user_id_created_at_idx" ON "membership_orders"("user_id", "created_at");
CREATE INDEX "membership_orders_status_created_at_idx" ON "membership_orders"("status", "created_at");

CREATE TABLE "membership_grants" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "order_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "starts_at" DATETIME NOT NULL,
  "expires_at" DATETIME NOT NULL,
  "benefits_json" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revoked_at" DATETIME,
  CONSTRAINT "membership_grants_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "membership_orders" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "membership_grants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "membership_grants_order_id_key" ON "membership_grants"("order_id");
CREATE INDEX "membership_grants_user_id_status_expires_at_idx" ON "membership_grants"("user_id", "status", "expires_at");

CREATE TABLE "membership_usage" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "order_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "benefit_code" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL DEFAULT 1,
  "state" TEXT NOT NULL DEFAULT 'CONSUMED',
  "charge_id" TEXT,
  "idempotency_key" TEXT NOT NULL,
  "metadata_json" TEXT,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "membership_usage_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "membership_orders" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "membership_usage_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "membership_usage_idempotency_key_key" ON "membership_usage"("idempotency_key");
CREATE UNIQUE INDEX "membership_usage_charge_id_benefit_code_key" ON "membership_usage"("charge_id", "benefit_code");
CREATE INDEX "membership_usage_order_id_created_at_idx" ON "membership_usage"("order_id", "created_at");
CREATE INDEX "membership_usage_user_id_created_at_idx" ON "membership_usage"("user_id", "created_at");

CREATE TABLE "membership_refunds" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "order_id" TEXT NOT NULL,
  "amount_cents" INTEGER NOT NULL,
  "deducted_cents" INTEGER NOT NULL,
  "attempt" INTEGER NOT NULL DEFAULT 1,
  "reason" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "provider_refund_no" TEXT,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" DATETIME,
  CONSTRAINT "membership_refunds_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "membership_orders" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "membership_refunds_order_id_key" ON "membership_refunds"("order_id");
CREATE UNIQUE INDEX "membership_refunds_provider_refund_no_key" ON "membership_refunds"("provider_refund_no");
CREATE INDEX "membership_refunds_status_created_at_idx" ON "membership_refunds"("status", "created_at");

INSERT INTO "membership_policies" ("id", "refund_window_hours", "usage_charge_period_hours", "version", "updated_at") VALUES ('primary', 24, 24, 0, CURRENT_TIMESTAMP);
INSERT INTO "membership_plans" ("id", "code", "name", "duration_days", "price_cents", "benefits_json", "is_active", "sort_order", "version", "created_at", "updated_at") VALUES
 ('membership_monthly', 'MONTHLY', '月度会员', 30, NULL, '[]', 0, 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
 ('membership_quarterly', 'QUARTERLY', '季度会员', 90, NULL, '[]', 0, 1, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
 ('membership_yearly', 'YEARLY', '年度会员', 365, NULL, '[]', 0, 2, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
