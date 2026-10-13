PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_circles" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "name" TEXT NOT NULL,
 "description" TEXT NOT NULL,
 "tags" TEXT,
 "owner_id" TEXT,
 "universe_id" TEXT,
 "status" TEXT NOT NULL DEFAULT 'ACTIVE',
 "is_featured" BOOLEAN NOT NULL DEFAULT false,
 "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updated_at" DATETIME NOT NULL,
 CONSTRAINT "circles_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "circles_universe_id_fkey" FOREIGN KEY ("universe_id") REFERENCES "universes" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_circles" ("id","name","description","tags","owner_id","universe_id","status","created_at","updated_at") SELECT "id","name","description","tags","owner_id","universe_id","status","created_at","updated_at" FROM "circles";
DROP TABLE "circles";
ALTER TABLE "new_circles" RENAME TO "circles";
CREATE INDEX "circles_status_created_at_idx" ON "circles"("status","created_at");
CREATE INDEX "circles_status_is_featured_created_at_id_idx" ON "circles"("status","is_featured","created_at","id");
CREATE INDEX "circles_status_updated_at_id_idx" ON "circles"("status","updated_at","id");
CREATE INDEX "circle_members_circle_id_created_at_user_id_idx" ON "circle_members"("circle_id","created_at","user_id");
CREATE TRIGGER "open_account_circles_insert" BEFORE INSERT ON "circles"
WHEN EXISTS (SELECT 1 FROM "users" WHERE "id" = NEW."owner_id" AND "deleted_at" IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'ACCOUNT_CLOSED'); END;
CREATE TRIGGER "open_account_circles_update" BEFORE UPDATE OF name,description,tags ON "circles"
WHEN EXISTS (SELECT 1 FROM "users" WHERE "id" = NEW."owner_id" AND "deleted_at" IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'ACCOUNT_CLOSED'); END;
CREATE TABLE "circle_membership_restrictions" (
 "circle_id" TEXT NOT NULL,
 "user_id" TEXT NOT NULL,
 "actor_id" TEXT NOT NULL,
 "reason" TEXT NOT NULL,
 "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updated_at" DATETIME NOT NULL,
 PRIMARY KEY ("circle_id","user_id"),
 CONSTRAINT "circle_membership_restrictions_circle_id_fkey" FOREIGN KEY ("circle_id") REFERENCES "circles" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "circle_membership_restrictions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "circle_membership_restrictions_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "circle_membership_restrictions_user_id_idx" ON "circle_membership_restrictions"("user_id");
CREATE INDEX "circle_membership_restrictions_circle_id_created_at_user_id_idx" ON "circle_membership_restrictions"("circle_id","created_at","user_id");
INSERT OR IGNORE INTO "admin_role_permissions" ("role_id","permission") SELECT "id", 'community.read' FROM "admin_roles" WHERE "code"='OWNER' AND "system"=1;
INSERT OR IGNORE INTO "admin_role_permissions" ("role_id","permission") SELECT "id", 'community.write' FROM "admin_roles" WHERE "code"='OWNER' AND "system"=1;
INSERT OR IGNORE INTO "admin_role_permissions" ("role_id","permission") SELECT "id", 'community.members.manage' FROM "admin_roles" WHERE "code"='OWNER' AND "system"=1;
INSERT OR IGNORE INTO "admin_roles" ("id","code","name","system","version","created_at","updated_at") VALUES ('khui_system_community_manager','COMMUNITY_MANAGER','社区管理员',1,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
INSERT OR IGNORE INTO "admin_role_permissions" ("role_id","permission") SELECT "id", 'community.read' FROM "admin_roles" WHERE "code"='COMMUNITY_MANAGER' AND "system"=1;
INSERT OR IGNORE INTO "admin_role_permissions" ("role_id","permission") SELECT "id", 'community.write' FROM "admin_roles" WHERE "code"='COMMUNITY_MANAGER' AND "system"=1;
INSERT OR IGNORE INTO "admin_role_permissions" ("role_id","permission") SELECT "id", 'community.members.manage' FROM "admin_roles" WHERE "code"='COMMUNITY_MANAGER' AND "system"=1;
INSERT OR IGNORE INTO "admin_role_permissions" ("role_id","permission") SELECT "id", 'moderation.read' FROM "admin_roles" WHERE "code"='COMMUNITY_MANAGER' AND "system"=1;
INSERT OR IGNORE INTO "admin_role_permissions" ("role_id","permission") SELECT "id", 'moderation.write' FROM "admin_roles" WHERE "code"='COMMUNITY_MANAGER' AND "system"=1;
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
