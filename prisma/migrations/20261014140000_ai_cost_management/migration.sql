CREATE TABLE "ai_daily_cost_budgets" (
  "currency" TEXT NOT NULL PRIMARY KEY,
  "site_limit" REAL,
  "user_limit" REAL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "version" INTEGER NOT NULL DEFAULT 0,
  "updated_by" TEXT NOT NULL,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" DATETIME NOT NULL,
  CONSTRAINT "ai_daily_cost_budgets_currency_check" CHECK ("currency" GLOB '[A-Z][A-Z][A-Z]'),
  CONSTRAINT "ai_daily_cost_budgets_positive_limits_check" CHECK (("site_limit" IS NULL OR "site_limit" > 0) AND ("user_limit" IS NULL OR "user_limit" > 0) AND ("site_limit" IS NOT NULL OR "user_limit" IS NOT NULL))
);
CREATE TABLE "ai_cost_policies" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'GLOBAL',
  "circuit_breaker_enabled" BOOLEAN NOT NULL DEFAULT false,
  "version" INTEGER NOT NULL DEFAULT 0,
  "updated_by" TEXT NOT NULL,
  "updated_at" DATETIME NOT NULL,
  CONSTRAINT "ai_cost_policies_global_id_check" CHECK ("id" = 'GLOBAL')
);
INSERT INTO "admin_role_permissions" ("role_id", "permission")
SELECT "id", permission FROM "admin_roles" CROSS JOIN (
  SELECT 'ai.costs.read' AS permission UNION ALL
  SELECT 'ai.costs.manage'
) WHERE "code" = 'OWNER';
INSERT INTO "admin_roles" ("id", "code", "name", "system", "version", "created_at", "updated_at")
VALUES ('system_ai_cost_manager', 'AI_COST_MANAGER', 'AI 成本管理员', 1, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT INTO "admin_role_permissions" ("role_id", "permission") VALUES
  ('system_ai_cost_manager', 'ai.costs.read'),
  ('system_ai_cost_manager', 'ai.costs.manage');

