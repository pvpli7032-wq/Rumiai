CREATE INDEX "characters_review_status_updated_at_id_idx" ON "characters"("review_status", "updated_at", "id");
INSERT OR IGNORE INTO "admin_role_permissions" ("role_id", "permission") SELECT "id", 'characters.read' FROM "admin_roles" WHERE "code"='OWNER' AND "system"=1;
INSERT OR IGNORE INTO "admin_role_permissions" ("role_id", "permission") SELECT "id", 'characters.write' FROM "admin_roles" WHERE "code"='OWNER' AND "system"=1;
INSERT OR IGNORE INTO "admin_role_permissions" ("role_id", "permission") SELECT "id", 'characters.publish' FROM "admin_roles" WHERE "code"='OWNER' AND "system"=1;
INSERT OR IGNORE INTO "admin_roles" ("id", "code", "name", "system", "version", "created_at", "updated_at") VALUES ('khui_system_character_manager', 'CHARACTER_MANAGER', '角色管理员', 1, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT OR IGNORE INTO "admin_role_permissions" ("role_id", "permission") SELECT "id", 'characters.read' FROM "admin_roles" WHERE "code"='CHARACTER_MANAGER' AND "system"=1;
INSERT OR IGNORE INTO "admin_role_permissions" ("role_id", "permission") SELECT "id", 'characters.write' FROM "admin_roles" WHERE "code"='CHARACTER_MANAGER' AND "system"=1;
INSERT OR IGNORE INTO "admin_role_permissions" ("role_id", "permission") SELECT "id", 'characters.publish' FROM "admin_roles" WHERE "code"='CHARACTER_MANAGER' AND "system"=1;
