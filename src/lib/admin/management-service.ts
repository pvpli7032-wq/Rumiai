import {randomUUID} from 'node:crypto';
import type {Prisma} from '@prisma/client';
import {db, pragmasReady} from '@/lib/db';
import {hasAdminPermission, readAdminAuthorization} from './authorization';
import {OWNER_ONLY, PERMISSIONS, SYSTEM_ROLES, type AdminPermission} from './permissions';

export class AdminManagementError extends Error {
  constructor(message: string, public status = 400) {super(message);}
}
const roleInclude = {permissions: {select: {permission: true}}, _count: {select: {assignments: true}}} as const;
const operatorInclude = {user: {select: {id: true, username: true, email: true, deletedAt: true}}, assignments: {include: {role: {select: {id: true, code: true, name: true}}}}} as const;

async function requirePermission(actorId: string, permission: AdminPermission, reader: Prisma.TransactionClient = db) {
  if (!await hasAdminPermission(actorId, permission, reader)) throw new AdminManagementError('当前账号没有此管理权限。', 403);
}
function object(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AdminManagementError('管理数据格式错误。');
  return input as Record<string, unknown>;
}
function reason(value: unknown) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 300) throw new AdminManagementError('请填写 1–300 字操作理由。');
  return value.trim();
}
function version(value: unknown) {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new AdminManagementError('版本信息无效。');
  return value as number;
}
function ids(value: unknown) {
  if (!Array.isArray(value) || value.length > 20 || value.some(id => typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(id)) || new Set(value).size !== value.length) throw new AdminManagementError('角色列表无效。');
  return value as string[];
}
async function claimWriter(tx: Prisma.TransactionClient, actorId: string) {
  await tx.$executeRaw`UPDATE admin_operators SET version = version WHERE user_id = ${actorId}`;
}
export async function recordAdminAudit(tx: Prisma.TransactionClient, actorId: string, action: string, targetId: string, explanation: string, changes: object) {
  await tx.adminAuditLog.create({data: {actorId, action, targetId, reason: explanation, changes: JSON.stringify(changes)}});
}
async function ownerCount(tx: Prisma.TransactionClient, except?: string) {
  return tx.adminOperator.count({where: {enabled: true, ...(except ? {userId: {not: except}} : {}), user: {deletedAt: null, suspendedAt: null}, assignments: {some: {role: {system: true, code: 'OWNER'}}}}});
}

/** Server-local bootstrap command only; never expose this function as an HTTP action. */
export async function bootstrapOwner(email: string) {
  await pragmasReady;
  return db.$transaction(async tx => {
    await claimWriter(tx, 'bootstrap');
    const user = await tx.user.findUnique({where: {email: email.trim().toLowerCase()}, select: {id: true, deletedAt: true, suspendedAt: true}});
    if (!user || user.deletedAt || user.suspendedAt) throw new AdminManagementError('请先注册指定的有效用户；停用账号不能初始化为所有者。', 404);
    const current = await readAdminAuthorization(user.id, tx);
    if (current.owner) return {userId: user.id, created: false};
    if (await ownerCount(tx)) throw new AdminManagementError('已有所有者，请通过后台分配其他管理账号。', 409);
    let ownerId = '';
    for (const role of SYSTEM_ROLES) {
      const saved = await tx.adminRole.upsert({where: {code: role.code}, update: {}, create: {code: role.code, name: role.name, system: true, permissions: {create: role.permissions.map(permission => ({permission}))}}});
      if (role.code === 'OWNER') ownerId = saved.id;
    }
    await tx.adminOperator.upsert({where: {userId: user.id}, update: {enabled: true, version: {increment: 1}}, create: {userId: user.id, enabled: true, version: 1}});
    await tx.adminRoleAssignment.upsert({where: {userId_roleId: {userId: user.id, roleId: ownerId}}, update: {}, create: {userId: user.id, roleId: ownerId}});
    await recordAdminAudit(tx, user.id, 'BOOTSTRAP_OWNER', user.id, '服务器显式初始化所有者', {role: 'OWNER'});
    return {userId: user.id, created: true};
  });
}

export async function readOperatorManagement(actorId: string, query = '', page = 1) {
  await requirePermission(actorId, 'admin.staff.read');
  if (query.length > 80 || !Number.isSafeInteger(page) || page < 1 || page > 10000) throw new AdminManagementError('查询条件无效。');
  const where: Prisma.AdminOperatorWhereInput = query.trim() ? {user: {OR: [{username: {contains: query.trim()}}, {email: {contains: query.trim()}}]}} : {};
  return db.$transaction(async tx => {
    await requirePermission(actorId, 'admin.staff.read', tx);
    const [operators, total, roles, authorization] = await Promise.all([
      tx.adminOperator.findMany({where, include: operatorInclude, orderBy: {userId: 'asc'}, take: 25, skip: (page - 1) * 25}),
      tx.adminOperator.count({where}), tx.adminRole.findMany({include: roleInclude, orderBy: [{system: 'desc'}, {name: 'asc'}]}), readAdminAuthorization(actorId, tx),
    ]);
    return {operators, total, page, pageSize: 25, roles, canManageStaff: authorization.permissions.includes('admin.staff.manage'), canManageRoles: authorization.permissions.includes('admin.roles.manage'), definitions: PERMISSIONS, ownerOnly: OWNER_ONLY};
  });
}

export async function findManagementUser(actorId: string, query: string) {
  await requirePermission(actorId, 'admin.staff.manage');
  if (!query.trim() || query.length > 150) throw new AdminManagementError('请填写用户名或邮箱。');
  const user = await db.user.findFirst({where: {deletedAt: null, OR: [{username: query.trim()}, {email: query.trim().toLowerCase()}]}, select: {id: true, username: true, email: true, adminOperator: {select: {enabled: true, version: true, assignments: {select: {roleId: true}}}}}});
  if (!user) throw new AdminManagementError('未找到有效账号。', 404);
  return user;
}

export async function saveOperator(actorId: string, input: unknown) {
  const body = object(input), roleIds = ids(body.roleIds), expected = version(body.version), explanation = reason(body.reason);
  if (typeof body.userId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(body.userId) || typeof body.enabled !== 'boolean' || body.enabled && !roleIds.length) throw new AdminManagementError('管理账号或状态无效。');
  const userId = body.userId, enabled = body.enabled;
  await pragmasReady;
  return db.$transaction(async tx => {
    await claimWriter(tx, actorId);
    await requirePermission(actorId, 'admin.staff.manage', tx);
    const user = await tx.user.findUnique({where: {id: userId}, select: {deletedAt: true}});
    if (!user || user.deletedAt) throw new AdminManagementError('账号不存在或已注销。', 404);
    const before = await tx.adminOperator.findUnique({where: {userId}, include: {assignments: {select: {roleId: true}}}});
    if ((before?.version ?? 0) !== expected) throw new AdminManagementError('管理账号已被其他人修改，请刷新。', 409);
    const roles = await tx.adminRole.findMany({where: {id: {in: roleIds}}, select: {id: true, code: true, system: true}});
    if (roles.length !== roleIds.length) throw new AdminManagementError('角色不存在。');
    const wasOwner = await readAdminAuthorization(userId, tx);
    const remainsOwner = enabled && roles.some(role => role.system && role.code === 'OWNER');
    if (wasOwner.owner && !remainsOwner && !await ownerCount(tx, userId)) throw new AdminManagementError('不能停用或降权最后一个所有者。', 409);
    const saved = await tx.adminOperator.upsert({where: {userId}, update: {enabled, version: {increment: 1}}, create: {userId, enabled, version: 1}});
    await tx.adminRoleAssignment.deleteMany({where: {userId}});
    if (roleIds.length) await tx.adminRoleAssignment.createMany({data: roleIds.map(roleId => ({userId, roleId}))});
    if (before?.enabled && !enabled) await tx.user.update({where: {id: userId}, data: {tokenVersion: {increment: 1}}});
    await recordAdminAudit(tx, actorId, 'SAVE_OPERATOR', userId, explanation, {before: before ? {enabled: before.enabled, roleIds: before.assignments.map(item => item.roleId), version: before.version} : null, after: {enabled, roleIds, version: saved.version}});
    return {userId, enabled, version: saved.version};
  });
}

export async function saveRole(actorId: string, input: unknown) {
  const body = object(input), explanation = reason(body.reason);
  if (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 60 || !Array.isArray(body.permissions) || body.permissions.length > Object.keys(PERMISSIONS).length || body.permissions.some(key => typeof key !== 'string' || !Object.hasOwn(PERMISSIONS, key) || OWNER_ONLY.includes(key as AdminPermission)) || new Set(body.permissions).size !== body.permissions.length) throw new AdminManagementError('角色名称或权限无效；所有者专属权限不可添加到自定义角色。');
  const name = body.name.trim(), permissions = body.permissions as AdminPermission[];
  if (permissions.some(key => key.startsWith('characters.') && key !== 'characters.read') && !permissions.includes('characters.read')) throw new AdminManagementError('角色操作权限必须同时包含角色查看权限。');
  if (permissions.some(key => key.startsWith('community.') && key !== 'community.read') && !permissions.includes('community.read')) throw new AdminManagementError('社区操作权限必须同时包含社区查看权限。');
  if (permissions.some(key => key.startsWith('accounts.') && key !== 'accounts.read') && !permissions.includes('accounts.read')) throw new AdminManagementError('用户操作权限必须同时包含用户查看权限。');
  if (permissions.includes('moderation.write') && !permissions.includes('moderation.read') || (permissions.includes('finance.packages.write') || permissions.includes('finance.refunds.execute')) && !permissions.includes('finance.read')) throw new AdminManagementError('操作权限必须同时包含对应的查看权限。');
  const id = body.id === undefined ? undefined : body.id;
  if (id !== undefined && (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(id))) throw new AdminManagementError('角色编号无效。');
  const expected = id ? version(body.version) : 0;
  await pragmasReady;
  return db.$transaction(async tx => {
    await claimWriter(tx, actorId); await requirePermission(actorId, 'admin.roles.manage', tx);
    const before = id ? await tx.adminRole.findUnique({where: {id}, include: {permissions: true}}) : null;
    if (id && !before) throw new AdminManagementError('角色不存在。', 404);
    if (before?.system) throw new AdminManagementError('系统角色不可修改。', 409);
    if (before && before.version !== expected) throw new AdminManagementError('角色已被其他人修改，请刷新。', 409);
    const saved = before ? await tx.adminRole.update({where: {id: before.id}, data: {name, version: {increment: 1}}}) : await tx.adminRole.create({data: {code: `CUSTOM_${randomUUID().replaceAll('-', '')}`, name, version: 1}});
    await tx.adminRolePermission.deleteMany({where: {roleId: saved.id}});
    if (permissions.length) await tx.adminRolePermission.createMany({data: permissions.map(permission => ({roleId: saved.id, permission}))});
    await recordAdminAudit(tx, actorId, before ? 'UPDATE_ROLE' : 'CREATE_ROLE', saved.id, explanation, {before: before ? {name: before.name, permissions: before.permissions.map(item => item.permission), version: before.version} : null, after: {name, permissions, version: saved.version}});
    return {id: saved.id, version: saved.version};
  });
}

export async function readAdminAudit(actorId: string, page = 1) {
  await requirePermission(actorId, 'admin.audit.read');
  if (!Number.isSafeInteger(page) || page < 1 || page > 10000) throw new AdminManagementError('页码无效。');
  return db.$transaction(async tx => {
    await requirePermission(actorId, 'admin.audit.read', tx);
    const [items, total] = await Promise.all([tx.adminAuditLog.findMany({orderBy: [{createdAt: 'desc'}, {id: 'desc'}], take: 25, skip: (page - 1) * 25}), tx.adminAuditLog.count()]);
    return {items, total, page, pageSize: 25};
  });
}

/** Called inside the account domain's existing writer transaction. */
export async function closeAdminIdentity(tx: Prisma.TransactionClient, userId: string) {
  const authorization = await readAdminAuthorization(userId, tx);
  if (authorization.owner && !await ownerCount(tx, userId)) throw new AdminManagementError('请先添加另一位所有者，再注销当前账号。', 409);
  if (authorization.managed) {
    await tx.adminOperator.update({where: {userId}, data: {enabled: false, version: {increment: 1}}});
    await recordAdminAudit(tx, userId, 'ACCOUNT_CLOSED', userId, '账号注销停用管理身份', {enabled: false});
  }
}

export async function readOwnAdminIdentity(tx: Prisma.TransactionClient, userId: string) {
  return tx.adminOperator.findUnique({where: {userId}, select: {enabled: true, version: true, createdAt: true, updatedAt: true, assignments: {select: {role: {select: {code: true, name: true, permissions: {select: {permission: true}}}}}}}});
}

/** The account domain calls this guard before suspending an administrative identity. */
export async function assertAccountSuspensionAllowed(tx: Prisma.TransactionClient, actorId: string, userId: string) {
  await assertAdministrativeAccountManagementAllowed(tx, actorId, userId);
  const target = await readAdminAuthorization(userId, tx);
  if (target.owner && !await ownerCount(tx, userId)) throw new AdminManagementError('不能停用最后一个有效所有者。', 409);
}

export async function assertAdministrativeAccountManagementAllowed(tx: Prisma.TransactionClient, actorId: string, userId: string) {
  const operator = await tx.adminOperator.findUnique({where: {userId}, include: {assignments: {include: {role: {include: {permissions: true}}}}}});
  const administrative = operator ? operator.enabled && operator.assignments.some(item => item.role.permissions.some(entry => Object.hasOwn(PERMISSIONS, entry.permission))) : [process.env.MODERATOR_USER_IDS, process.env.PAYMENT_ADMIN_USER_IDS].some(list => (list ?? '').split(',').map(value => value.trim()).includes(userId));
  if (administrative && !(await readAdminAuthorization(actorId, tx)).owner) throw new AdminManagementError('管理账号的状态及会话只能由所有者调整。', 403);
}
