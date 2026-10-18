CREATE TABLE "admin_operators" (
 "user_id" TEXT NOT NULL PRIMARY KEY,
 "enabled" BOOLEAN NOT NULL DEFAULT true,
 "version" INTEGER NOT NULL DEFAULT 0,
 "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updated_at" DATETIME NOT NULL,
 CONSTRAINT "admin_operators_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE "admin_roles" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "code" TEXT NOT NULL,
 "name" TEXT NOT NULL,
 "system" BOOLEAN NOT NULL DEFAULT false,
 "version" INTEGER NOT NULL DEFAULT 0,
 "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updated_at" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "admin_roles_code_key" ON "admin_roles"("code");
CREATE TABLE "admin_role_permissions" (
 "role_id" TEXT NOT NULL,
 "permission" TEXT NOT NULL,
 PRIMARY KEY ("role_id", "permission"),
 CONSTRAINT "admin_role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "admin_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "admin_role_assignments" (
 "user_id" TEXT NOT NULL,
 "role_id" TEXT NOT NULL,
 "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY ("user_id", "role_id"),
 CONSTRAINT "admin_role_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "admin_operators"("user_id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "admin_role_assignments_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "admin_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "admin_role_assignments_role_id_idx" ON "admin_role_assignments"("role_id");
CREATE TABLE "admin_audit_logs" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "actor_id" TEXT NOT NULL,
 "action" TEXT NOT NULL,
 "target_id" TEXT NOT NULL,
 "reason" TEXT NOT NULL,
 "changes" TEXT NOT NULL,
 "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "admin_audit_logs_created_at_idx" ON "admin_audit_logs"("created_at");
CREATE INDEX "admin_audit_logs_target_id_created_at_idx" ON "admin_audit_logs"("target_id", "created_at");
