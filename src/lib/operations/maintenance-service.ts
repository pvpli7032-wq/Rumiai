import {db, pragmasReady} from '@/lib/db';
import {hasAdminPermission} from '@/lib/admin/authorization';
import {recordAdminAudit} from '@/lib/admin/management-service';

export class MaintenancePolicyError extends Error {
  constructor(message: string, readonly status = 400) {super(message); this.name = 'MaintenancePolicyError';}
}

/** Always read the singleton: changes apply across application processes without cache invalidation. */
export async function readPublicMaintenance() {
  const policy = await db.maintenancePolicy.findUniqueOrThrow({where: {id: 'primary'}, select: {enabled: true, message: true, retryAfterSeconds: true}});
  return policy;
}

export async function readMaintenancePolicy(actor: string) {
  if (!await hasAdminPermission(actor, 'operations.read')) throw new MaintenancePolicyError('当前账号没有运维查看权限。', 403);
  return db.maintenancePolicy.findUniqueOrThrow({where: {id: 'primary'}});
}

export async function saveMaintenancePolicy(actor: string, input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new MaintenancePolicyError('维护设置数据格式不正确。');
  const row = input as Record<string, unknown>;
  if (typeof row.enabled !== 'boolean') throw new MaintenancePolicyError('维护开关无效。');
  if (typeof row.message !== 'string' || !row.message.trim() || row.message.trim().length > 300) throw new MaintenancePolicyError('请填写 1–300 字维护提示。');
  if (!Number.isSafeInteger(row.retryAfterSeconds) || Number(row.retryAfterSeconds) < 60 || Number(row.retryAfterSeconds) > 86400) throw new MaintenancePolicyError('建议重试时间须为 60–86400 秒的整数。');
  if (!Number.isSafeInteger(row.version) || Number(row.version) < 0) throw new MaintenancePolicyError('维护设置版本无效。');
  if (typeof row.reason !== 'string' || !row.reason.trim() || row.reason.trim().length > 500) throw new MaintenancePolicyError('请填写 1–500 字变更理由。');
  const data = {enabled: row.enabled, message: row.message.trim(), retryAfterSeconds: Number(row.retryAfterSeconds)};
  const reason = row.reason.trim();
  await pragmasReady;
  return db.$transaction(async tx => {
    await tx.$executeRaw`UPDATE users SET account_version=account_version WHERE id=${actor}`;
    if (!await hasAdminPermission(actor, 'operations.read', tx) || !await hasAdminPermission(actor, 'operations.maintenance.manage', tx)) throw new MaintenancePolicyError('当前账号没有维护模式管理权限。', 403);
    const before = await tx.maintenancePolicy.findUniqueOrThrow({where: {id: 'primary'}});
    if (before.version !== row.version) throw new MaintenancePolicyError('维护设置已被修改，请刷新后重试。', 409);
    const after = await tx.maintenancePolicy.update({where: {id: 'primary'}, data: {...data, version: {increment: 1}}});
    await recordAdminAudit(tx, actor, 'UPDATE_MAINTENANCE_POLICY', 'maintenance-policy:primary', reason, {before, after});
    return after;
  });
}
