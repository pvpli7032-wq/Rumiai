import { db, pragmasReady } from '@rumiai/backend/infrastructure/database/client';
import { effectivePackageBonus } from './package-service';
import { hasAdminPermission } from '@rumiai/backend/modules/admin/authorization';
import { claimWriter, recordAdminAudit } from '@rumiai/backend/modules/admin/management-service';

export class PackageManagementError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

function integer(value: unknown, name: string, min = 0, max = 1_000_000_000) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) throw new PackageManagementError(`${name}须为 ${min}–${max} 的整数。`);
  return value;
}
function date(value: unknown): Date | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) throw new PackageManagementError('活动时间须为有效 UTC 时间。');
  const result = new Date(value);
  if (result.toISOString().slice(0, 19) !== value.slice(0, 19)) throw new PackageManagementError('活动日期不存在。');
  return result;
}
export function validatePackageConfiguration(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new PackageManagementError('套餐数据格式错误。');
  const row = input as Record<string, unknown>;
  if (typeof row.label !== 'string' || !row.label.trim() || row.label.trim().length > 32) throw new PackageManagementError('套餐名称须为 1–32 字。');
  if (typeof row.isActive !== 'boolean') throw new PackageManagementError('上架状态格式错误。');
  const coins = integer(row.coins, '基础金币', 1), bonus = integer(row.bonus, '赠送金币');
  if (coins + bonus > 2_000_000_000) throw new PackageManagementError('金币总数超过上限。');
  const bonusStartsAt = date(row.bonusStartsAt), bonusEndsAt = date(row.bonusEndsAt);
  if (!!bonusStartsAt !== !!bonusEndsAt || (bonusStartsAt && bonusEndsAt && bonusEndsAt <= bonusStartsAt)) throw new PackageManagementError('定时活动须同时填写开始与结束，且结束晚于开始。');
  if (bonus === 0 && bonusStartsAt) throw new PackageManagementError('定时活动须设置赠送金币。');
  let benefitsJson: string | undefined;
  if (row.benefits !== undefined) {
    if (!Array.isArray(row.benefits) || row.benefits.length > 8 || row.benefits.some(item => typeof item !== 'string' || !item.trim() || item.trim().length > 80)) throw new PackageManagementError('权益说明最多 8 条，每条须为 1–80 字。');
    const benefits = row.benefits.map(item => (item as string).trim());
    if (new Set(benefits).size !== benefits.length) throw new PackageManagementError('权益说明不能重复。');
    benefitsJson = JSON.stringify(benefits);
  }
  return { label: row.label.trim(), coins, bonus, ...(benefitsJson !== undefined ? {benefitsJson} : {}), priceCnyCents: integer(row.priceCnyCents, '人民币价格（分）', 1), sortOrder: integer(row.sortOrder, '排序', 0, 10000), isActive: row.isActive, bonusStartsAt, bonusEndsAt };
}

export async function readPackageManagement() {
  await pragmasReady;
  return db.$transaction(async tx => {
    const packages = await tx.coinPackage.findMany({ orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] });
    const references = packages.length ? await tx.paymentOrder.groupBy({ by: ['packageId'], where: { packageId: { in: packages.map(item => item.id) } }, _count: { _all: true } }) : [];
    const referenceCounts = new Map(references.map(item => [item.packageId, item._count._all]));
    const changes = await tx.coinPackageChange.findMany({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 20 });
    const now = new Date();
    return { packages: packages.map(pkg => ({ ...pkg, benefits: parseBenefits(pkg.benefitsJson), referenceCount: referenceCounts.get(pkg.id) ?? 0, effectiveBonus: effectivePackageBonus(pkg, now), totalCoins: pkg.coins + effectivePackageBonus(pkg, now) })), changes };
  });
}

function parseBenefits(value: string): string[] {
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed.filter(item => typeof item === 'string') : []; }
  catch { return []; }
}

export async function createManagedPackage(actorId: string, input: unknown) {
  const data = validatePackageConfiguration(input);
  await pragmasReady;
  return db.$transaction(async tx => {
    // THB is a retained legacy field; no invented exchange conversion for new rows.
    const pkg = await tx.coinPackage.create({ data: { ...data, priceThb: 0 } });
    await tx.coinPackageChange.create({ data: { packageId: pkg.id, actorId, afterJson: JSON.stringify(pkg) } });
    return pkg;
  });
}

export async function updateManagedPackage(actorId: string, id: string, input: unknown) {
  const data = validatePackageConfiguration(input);
  const version = integer((input as Record<string, unknown>).version, '套餐版本');
  await pragmasReady;
  return db.$transaction(async tx => {
    const before = await tx.coinPackage.findUnique({ where: { id } });
    if (!before) throw new PackageManagementError('套餐不存在。', 404);
    const updated = await tx.coinPackage.updateMany({ where: { id, version }, data: { ...data, version: { increment: 1 } } });
    if (!updated.count) throw new PackageManagementError('套餐已被其他操作修改，请刷新后重新编辑。', 409);
    const after = await tx.coinPackage.findUniqueOrThrow({ where: { id } });
    await tx.coinPackageChange.create({ data: { packageId: id, actorId, beforeJson: JSON.stringify(before), afterJson: JSON.stringify(after) } });
    return after;
  });
}

/** Delete only an inactive package with no payment-order snapshot references. */
export async function deleteManagedPackage(actorId: string,id: string,input: unknown) {
  if(!input||typeof input!=='object'||Array.isArray(input)) throw new PackageManagementError('删除请求格式错误。');
  const body=input as Record<string,unknown>;
  if(typeof body.reason!=='string'||!body.reason.trim()||body.reason.trim().length>500) throw new PackageManagementError('请填写 1–500 字操作理由。');
  const reason=body.reason.trim();
  const version=integer(body.version,'套餐版本');
  if(!/^[A-Za-z0-9_-]{1,100}$/.test(id)) throw new PackageManagementError('套餐编号无效。');
  await pragmasReady;
  return db.$transaction(async tx=>{
    await claimWriter(tx,actorId);
    if(!await hasAdminPermission(actorId,'finance.packages.write',tx)) throw new PackageManagementError('当前账号没有套餐管理权限。',403);
    const before=await tx.coinPackage.findUnique({where:{id}});
    if(!before) throw new PackageManagementError('套餐不存在。',404);
    if(before.version!==version) throw new PackageManagementError('套餐已被其他操作修改，请刷新后重试。',409);
    if(before.isActive) throw new PackageManagementError('请先下架套餐，再执行删除。',409);
    const references=await tx.paymentOrder.count({where:{packageId:id}});
    if(references>0) throw new PackageManagementError(`套餐已有 ${references} 条订单快照引用，不能删除；请保留下架状态。`,409);
    await tx.coinPackage.delete({where:{id}});
    await recordAdminAudit(tx,actorId,'DELETE_COIN_PACKAGE',id,reason,{before:{label:before.label,version:before.version,isActive:before.isActive}});
    return {id,deleted:true};
  });
}
