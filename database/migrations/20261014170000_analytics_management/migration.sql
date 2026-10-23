INSERT INTO "admin_role_permissions" ("role_id", "permission")
SELECT "id", 'analytics.read' FROM "admin_roles" WHERE "code" = 'OWNER' AND "system" = 1;

INSERT INTO "admin_roles" ("id", "code", "name", "system", "version", "created_at", "updated_at")
VALUES ('khui_system_analytics_viewer', 'ANALYTICS_VIEWER', '运营分析查看员', 1, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

INSERT INTO "admin_role_permissions" ("role_id", "permission")
VALUES ('khui_system_analytics_viewer', 'analytics.read');
