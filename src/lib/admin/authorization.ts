import type {Prisma} from '@prisma/client';
import {db} from '@/lib/db';
import {PERMISSIONS, type AdminPermission} from './permissions';

type Reader = Pick<Prisma.TransactionClient, 'user' | 'adminOperator'>;
const listed = (value: string | undefined, id: string) => (value ?? '').split(',').map(item => item.trim()).filter(Boolean).includes(id);

export async function readAdminAuthorization(userId: string, reader: Reader = db) {
  const user = await reader.user.findUnique({where: {id: userId}, select: {deletedAt: true, suspendedAt: true}});
  if (!user || user.deletedAt || user.suspendedAt) return {managed: false, enabled: false, owner: false, roles: [] as string[], permissions: [] as AdminPermission[]};
  const operator = await reader.adminOperator.findUnique({where: {userId}, include: {assignments: {include: {role: {include: {permissions: true}}}}}});
  if (operator) {
    const roles = operator.enabled ? operator.assignments.map(item => item.role) : [];
    const permissions = [...new Set(roles.flatMap(role => role.permissions.map(item => item.permission)).filter((key): key is AdminPermission => Object.hasOwn(PERMISSIONS, key)))];
    return {managed: true, enabled: operator.enabled, owner: roles.some(role => role.system && role.code === 'OWNER'), roles: roles.map(role => role.code), permissions};
  }
  // Legacy lists remain valid until this account is explicitly managed in the database.
  const permissions: AdminPermission[] = [];
  const roles: string[] = [];
  if (listed(process.env.MODERATOR_USER_IDS, userId)) {roles.push('LEGACY_MODERATOR'); permissions.push('moderation.read', 'moderation.write');}
  if (listed(process.env.PAYMENT_ADMIN_USER_IDS, userId)) {roles.push('LEGACY_FINANCE'); permissions.push('finance.read', 'finance.packages.write', 'finance.refunds.request', 'finance.refunds.execute', 'finance.reconciliation.import');}
  return {managed: false, enabled: permissions.length > 0, owner: false, roles, permissions};
}

export async function hasAdminPermission(userId: string, permission: AdminPermission, reader: Reader = db) {
  return (await readAdminAuthorization(userId, reader)).permissions.includes(permission);
}
