ALTER TABLE "users" ADD COLUMN "suspended_at" DATETIME;
ALTER TABLE "users" ADD COLUMN "suspension_reason" TEXT;
ALTER TABLE "users" ADD COLUMN "account_version" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "users" ADD COLUMN "last_login_at" DATETIME;
ALTER TABLE "users" ADD COLUMN "last_active_at" DATETIME;
CREATE INDEX "users_created_at_id_idx" ON "users"("created_at", "id");
CREATE INDEX "users_suspended_at_deleted_at_idx" ON "users"("suspended_at", "deleted_at");

-- Expand existing system owners without changing any custom role grants.
INSERT INTO "admin_role_permissions" ("role_id", "permission") SELECT "id", 'accounts.read' FROM "admin_roles" WHERE "code" = 'OWNER' AND "system" = 1;
INSERT INTO "admin_role_permissions" ("role_id", "permission") SELECT "id", 'accounts.manage' FROM "admin_roles" WHERE "code" = 'OWNER' AND "system" = 1;
INSERT INTO "admin_role_permissions" ("role_id", "permission") SELECT "id", 'accounts.sessions.revoke' FROM "admin_roles" WHERE "code" = 'OWNER' AND "system" = 1;
INSERT INTO "admin_role_permissions" ("role_id", "permission") SELECT "id", 'accounts.community.manage' FROM "admin_roles" WHERE "code" = 'OWNER' AND "system" = 1;
INSERT INTO "admin_roles" ("id", "code", "name", "system", "version", "created_at", "updated_at") VALUES ('khui_system_support_agent', 'SUPPORT_AGENT', '用户客服', 1, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT INTO "admin_role_permissions" ("role_id", "permission") VALUES ('khui_system_support_agent', 'accounts.read'), ('khui_system_support_agent', 'accounts.community.manage');
