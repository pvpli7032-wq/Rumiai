ALTER TABLE "payment_refunds" ADD COLUMN "approved_by_id" TEXT;
ALTER TABLE "payment_refunds" ADD COLUMN "approved_at" DATETIME;
ALTER TABLE "payment_refunds" ADD COLUMN "approval_reason" TEXT;
ALTER TABLE "payment_refunds" ADD COLUMN "rejected_by_id" TEXT;
ALTER TABLE "payment_refunds" ADD COLUMN "rejected_at" DATETIME;
ALTER TABLE "payment_refunds" ADD COLUMN "rejection_reason" TEXT;
ALTER TABLE "payment_refunds" ADD COLUMN "last_action_by_id" TEXT;
UPDATE "payment_refunds"
SET "approved_by_id" = "actor_id",
    "approved_at" = "created_at",
    "approval_reason" = '旧流程退款记录迁移：已按原执行状态保留',
    "last_action_by_id" = "actor_id"
WHERE "status" <> 'PENDING_APPROVAL';

INSERT OR IGNORE INTO "admin_role_permissions" ("role_id", "permission")
SELECT "id", 'finance.refunds.request' FROM "admin_roles" WHERE "code" = 'OWNER' AND "system" = 1;
INSERT OR IGNORE INTO "admin_role_permissions" ("role_id", "permission")
SELECT "id", 'finance.refunds.approve' FROM "admin_roles" WHERE "code" = 'OWNER' AND "system" = 1;
INSERT OR IGNORE INTO "admin_role_permissions" ("role_id", "permission")
SELECT "id", 'finance.refunds.request' FROM "admin_roles" WHERE "code" = 'FINANCE_MANAGER' AND "system" = 1;
UPDATE "admin_roles" SET "name" = '财务经办员', "updated_at" = CURRENT_TIMESTAMP WHERE "code" = 'FINANCE_MANAGER' AND "system" = 1;

INSERT INTO "admin_roles" ("id", "code", "name", "system", "version", "created_at", "updated_at")
VALUES ('khui_system_finance_refund_approver', 'FINANCE_REFUND_APPROVER', '退款审批员', 1, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT INTO "admin_role_permissions" ("role_id", "permission")
VALUES ('khui_system_finance_refund_approver', 'finance.read'),
       ('khui_system_finance_refund_approver', 'finance.refunds.approve'),
       ('khui_system_finance_refund_approver', 'finance.refunds.execute');
