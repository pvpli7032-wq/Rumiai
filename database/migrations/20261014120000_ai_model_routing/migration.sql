CREATE TABLE "ai_models" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "key" TEXT NOT NULL,
  "display_name" TEXT NOT NULL,
  "model_code" TEXT NOT NULL,
  "provider_id" TEXT NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT false,
  "is_default" BOOLEAN NOT NULL DEFAULT false,
  "default_slot" TEXT,
  "is_fallback" BOOLEAN NOT NULL DEFAULT false,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "timeout_ms" INTEGER NOT NULL DEFAULT 60000,
  "max_retries" INTEGER NOT NULL DEFAULT 1,
  "max_output_tokens" INTEGER NOT NULL DEFAULT 800,
  "last_check_at" DATETIME,
  "last_check_status" TEXT,
  "version" INTEGER NOT NULL DEFAULT 0,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" DATETIME NOT NULL,
  CONSTRAINT "ai_models_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "ai_providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ai_models_key_key" ON "ai_models"("key");
CREATE UNIQUE INDEX "ai_models_default_slot_key" ON "ai_models"("default_slot");
CREATE UNIQUE INDEX "ai_models_provider_id_model_code_key" ON "ai_models"("provider_id", "model_code");
CREATE INDEX "ai_models_is_active_is_default_is_fallback_sort_order_id_idx" ON "ai_models"("is_active", "is_default", "is_fallback", "sort_order", "id");

INSERT INTO "admin_role_permissions" ("role_id", "permission")
SELECT "id", permission FROM "admin_roles" CROSS JOIN (
  SELECT 'ai.models.read' AS permission UNION ALL
  SELECT 'ai.models.manage' UNION ALL
  SELECT 'ai.models.test'
) WHERE "code" = 'OWNER';
INSERT INTO "admin_roles" ("id", "code", "name", "system", "version", "created_at", "updated_at")
VALUES ('system_ai_model_manager', 'AI_MODEL_MANAGER', 'AI 模型管理员', 1, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT INTO "admin_role_permissions" ("role_id", "permission") VALUES
  ('system_ai_model_manager', 'ai.providers.read'),
  ('system_ai_model_manager', 'ai.models.read'),
  ('system_ai_model_manager', 'ai.models.manage'),
  ('system_ai_model_manager', 'ai.models.test');
