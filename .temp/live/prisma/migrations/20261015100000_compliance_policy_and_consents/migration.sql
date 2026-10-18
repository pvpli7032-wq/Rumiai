CREATE TABLE "compliance_policies" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "age_gate_enabled" BOOLEAN NOT NULL DEFAULT false,
  "minimum_age" INTEGER,
  "age_policy_version" TEXT,
  "terms_version" TEXT,
  "privacy_version" TEXT,
  "version" INTEGER NOT NULL DEFAULT 0,
  "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO "compliance_policies" ("id", "age_gate_enabled", "version") VALUES ('primary', false, 0);

CREATE TABLE "user_consents" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "user_id" TEXT NOT NULL,
  "policy_type" TEXT NOT NULL,
  "policy_version" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'REGISTER',
  "accepted_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_consents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "user_consents_user_id_policy_type_policy_version_key" ON "user_consents"("user_id", "policy_type", "policy_version");
CREATE INDEX "user_consents_policy_type_policy_version_accepted_at_idx" ON "user_consents"("policy_type", "policy_version", "accepted_at");
CREATE INDEX "user_consents_user_id_accepted_at_idx" ON "user_consents"("user_id", "accepted_at");

INSERT OR IGNORE INTO "admin_role_permissions" ("role_id", "permission")
SELECT "id", 'compliance.read' FROM "admin_roles" WHERE "code" = 'OWNER' AND "system" = 1;
INSERT OR IGNORE INTO "admin_role_permissions" ("role_id", "permission")
SELECT "id", 'compliance.manage' FROM "admin_roles" WHERE "code" = 'OWNER' AND "system" = 1;
INSERT OR IGNORE INTO "admin_roles" ("id", "code", "name", "system", "version", "created_at", "updated_at")
VALUES ('khui_system_compliance_manager', 'COMPLIANCE_MANAGER', '合规设置管理员', 1, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT OR IGNORE INTO "admin_role_permissions" ("role_id", "permission") VALUES
  ('khui_system_compliance_manager', 'compliance.read'),
  ('khui_system_compliance_manager', 'compliance.manage');
