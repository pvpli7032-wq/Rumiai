CREATE TABLE "maintenance_policies" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "message" TEXT NOT NULL DEFAULT '系统维护中，暂时无法提交操作，请稍后重试。',
  "retry_after_seconds" INTEGER NOT NULL DEFAULT 300,
  "version" INTEGER NOT NULL DEFAULT 0,
  "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "maintenance_policies" ("id") VALUES ('primary');
INSERT OR IGNORE INTO "admin_role_permissions" ("role_id", "permission")
SELECT "id", 'operations.maintenance.manage' FROM "admin_roles" WHERE "code" = 'OWNER' AND "system" = 1;
INSERT OR IGNORE INTO "admin_roles" ("id", "code", "name", "system", "version", "created_at", "updated_at")
VALUES ('khui_system_operations_manager', 'OPERATIONS_MANAGER', '运维配置管理员', 1, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT OR IGNORE INTO "admin_role_permissions" ("role_id", "permission") VALUES
  ('khui_system_operations_manager', 'operations.read'),
  ('khui_system_operations_manager', 'operations.maintenance.manage');
