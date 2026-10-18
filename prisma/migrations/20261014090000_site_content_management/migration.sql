ALTER TABLE "tags" ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "badges" ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "site_content_drafts" (
  "content_type" TEXT NOT NULL,
  "content_id" TEXT NOT NULL,
  "draft_json" TEXT NOT NULL,
  "scheduled_at" DATETIME,
  "version" INTEGER NOT NULL DEFAULT 0,
  "actor_id" TEXT NOT NULL,
  "updated_at" DATETIME NOT NULL,
  PRIMARY KEY ("content_type", "content_id"),
  CONSTRAINT "site_content_drafts_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "site_content_drafts_content_type_scheduled_at_idx" ON "site_content_drafts"("content_type", "scheduled_at");

CREATE TABLE "site_content_revisions" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "content_type" TEXT NOT NULL,
  "content_id" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "snapshot_json" TEXT NOT NULL,
  "actor_id" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "site_content_revisions_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "site_content_revisions_content_type_content_id_created_at_idx" ON "site_content_revisions"("content_type", "content_id", "created_at");

INSERT OR IGNORE INTO "admin_role_permissions" ("role_id", "permission") SELECT "id", 'site.content.read' FROM "admin_roles" WHERE "code"='OWNER' AND "system"=1;
INSERT OR IGNORE INTO "admin_role_permissions" ("role_id", "permission") SELECT "id", 'site.content.manage' FROM "admin_roles" WHERE "code"='OWNER' AND "system"=1;
INSERT OR IGNORE INTO "admin_role_permissions" ("role_id", "permission") SELECT "id", 'site.content.publish' FROM "admin_roles" WHERE "code"='OWNER' AND "system"=1;

INSERT OR IGNORE INTO "admin_roles" ("id", "code", "name", "system", "version", "created_at", "updated_at")
VALUES ('khui_system_site_content_manager', 'SITE_CONTENT_MANAGER', '站点内容管理员', 1, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT OR IGNORE INTO "admin_role_permissions" ("role_id", "permission") SELECT "id", 'site.content.read' FROM "admin_roles" WHERE "code"='SITE_CONTENT_MANAGER' AND "system"=1;
INSERT OR IGNORE INTO "admin_role_permissions" ("role_id", "permission") SELECT "id", 'site.content.manage' FROM "admin_roles" WHERE "code"='SITE_CONTENT_MANAGER' AND "system"=1;
INSERT OR IGNORE INTO "admin_role_permissions" ("role_id", "permission") SELECT "id", 'site.content.publish' FROM "admin_roles" WHERE "code"='SITE_CONTENT_MANAGER' AND "system"=1;
