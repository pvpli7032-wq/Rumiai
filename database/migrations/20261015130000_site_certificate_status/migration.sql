CREATE TABLE "site_certificate_status" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "hostname" TEXT,
  "port" INTEGER,
  "status" TEXT NOT NULL DEFAULT 'NOT_CHECKED',
  "verified" BOOLEAN NOT NULL DEFAULT false,
  "valid_from" DATETIME,
  "valid_until" DATETIME,
  "checked_at" DATETIME,
  "error_code" TEXT,
  "fingerprint256" TEXT
);
INSERT INTO "site_certificate_status" ("id") VALUES ('primary');
INSERT OR IGNORE INTO "admin_role_permissions" ("role_id", "permission")
SELECT "id", 'operations.certificates.check' FROM "admin_roles"
WHERE "system" = 1 AND "code" IN ('OWNER', 'OPERATIONS_MANAGER');
