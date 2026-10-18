ALTER TABLE "missions" ADD COLUMN "condition_type" TEXT NOT NULL DEFAULT 'MANUAL';
ALTER TABLE "missions" ADD COLUMN "condition_target" INTEGER NOT NULL DEFAULT 1 CHECK ("condition_target" BETWEEN 1 AND 10000);
ALTER TABLE "missions" ADD COLUMN "period" TEXT NOT NULL DEFAULT 'ONCE';
ALTER TABLE "missions" ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "missions" ADD COLUMN "sort_order" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "missions" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "missions" ADD COLUMN "starts_at" DATETIME;
ALTER TABLE "missions" ADD COLUMN "ends_at" DATETIME;
CREATE INDEX "missions_is_active_sort_order_created_at_idx" ON "missions"("is_active", "sort_order", "created_at");

ALTER TABLE "user_missions" ADD COLUMN "period_key" TEXT NOT NULL DEFAULT 'ONCE';
DROP INDEX "user_missions_user_id_mission_id_key";
CREATE UNIQUE INDEX "user_missions_user_id_mission_id_period_key_key" ON "user_missions"("user_id", "mission_id", "period_key");

ALTER TABLE "character_quests" ADD COLUMN "required_messages" INTEGER NOT NULL DEFAULT 1 CHECK ("required_messages" BETWEEN 1 AND 10000);

CREATE TABLE "checkin_reward_rules" (
  "streak_day" INTEGER NOT NULL PRIMARY KEY CHECK ("streak_day" BETWEEN 1 AND 7),
  "reward_coins" INTEGER NOT NULL CHECK ("reward_coins" BETWEEN 0 AND 10000),
  "version" INTEGER NOT NULL DEFAULT 0,
  "updated_by" TEXT,
  "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "checkin_reward_rules" ("streak_day", "reward_coins") VALUES
  (1, 10), (2, 15), (3, 20), (4, 25), (5, 30), (6, 40), (7, 50);

INSERT INTO "admin_role_permissions" ("role_id", "permission")
SELECT "id", 'growth.read' FROM "admin_roles" WHERE "code" = 'OWNER' AND "system" = 1;
INSERT INTO "admin_role_permissions" ("role_id", "permission")
SELECT "id", 'growth.manage' FROM "admin_roles" WHERE "code" = 'OWNER' AND "system" = 1;
INSERT INTO "admin_roles" ("id", "code", "name", "system", "version", "created_at", "updated_at")
VALUES ('khui_system_growth_manager', 'GROWTH_MANAGER', '任务与增长管理员', 1, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT INTO "admin_role_permissions" ("role_id", "permission")
VALUES ('khui_system_growth_manager', 'growth.read'), ('khui_system_growth_manager', 'growth.manage');
