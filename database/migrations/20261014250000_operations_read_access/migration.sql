INSERT OR IGNORE INTO "admin_role_permissions" ("role_id","permission")
SELECT "id",'operations.read' FROM "admin_roles" WHERE "code"='OWNER' AND "system"=1;
INSERT OR IGNORE INTO "admin_roles" ("id","code","name","system","version","created_at","updated_at")
VALUES ('khui_system_operations_viewer','OPERATIONS_VIEWER','运维状态查看员',1,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
INSERT OR IGNORE INTO "admin_role_permissions" ("role_id","permission")
VALUES ('khui_system_operations_viewer','operations.read');