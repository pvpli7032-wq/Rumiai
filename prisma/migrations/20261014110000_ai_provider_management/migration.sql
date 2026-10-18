CREATE TABLE "ai_providers" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "protocol" TEXT NOT NULL DEFAULT 'OPENAI_COMPATIBLE',
  "base_url" TEXT NOT NULL,
  "secret_ciphertext" TEXT,
  "secret_nonce" TEXT,
  "secret_tag" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT false,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "version" INTEGER NOT NULL DEFAULT 0,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "ai_providers_name_key" ON "ai_providers"("name");
CREATE INDEX "ai_providers_is_active_sort_order_id_idx" ON "ai_providers"("is_active", "sort_order", "id");

INSERT INTO "admin_role_permissions" ("role_id", "permission")
SELECT "id", permission FROM "admin_roles" CROSS JOIN (
  SELECT 'ai.providers.read' AS permission UNION ALL
  SELECT 'ai.providers.manage' UNION ALL
  SELECT 'ai.providers.secrets.manage' UNION ALL
  SELECT 'ai.providers.test'
) WHERE "code" = 'OWNER';

INSERT INTO "admin_roles" ("id", "code", "name", "system", "version", "created_at", "updated_at")
VALUES ('system_ai_provider_manager', 'AI_PROVIDER_MANAGER', 'AI 供应商管理员', 1, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

INSERT INTO "admin_role_permissions" ("role_id", "permission") VALUES
  ('system_ai_provider_manager', 'ai.providers.read'),
  ('system_ai_provider_manager', 'ai.providers.manage'),
  ('system_ai_provider_manager', 'ai.providers.secrets.manage'),
  ('system_ai_provider_manager', 'ai.providers.test');
