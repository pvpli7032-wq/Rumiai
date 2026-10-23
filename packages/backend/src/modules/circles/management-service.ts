import type {Prisma} from '@prisma/client';
import {db, pragmasReady} from '@rumiai/backend/infrastructure/database/client';
import {recordAdminAudit} from '@rumiai/backend/modules/admin/management-service';
import {CircleError} from './errors';
import {claimCircleManager, readManagementCommand, requireCircleManagement} from './management-access';
import {validateCircleContent, validateCircleUniverse} from './content';

const projection = {id: true, name: true, description: true, tags: true, ownerId: true, universeId: true, status: true, isFeatured: true, createdAt: true, updatedAt: true, owner: {select: {id: true, username: true, displayName: true, deletedAt: true}}, _count: {select: {members: true, posts: true, restrictions: true}}} as const;
export async function listManagedCircles(actor: string, query: {q?: string; status?: string; ownership?: string; featured?: string; page?: number}) {
  const {q = '', status = 'ALL', ownership = 'ALL', featured = 'ALL', page = 1} = query;
  if (q.length > 100 || !['ALL', 'ACTIVE', 'HIDDEN'].includes(status) || !['ALL', 'SITE', 'USER'].includes(ownership) || !['ALL', 'YES', 'NO'].includes(featured) || !Number.isSafeInteger(page) || page < 1 || page > 10000) throw new CircleError('圈子查询条件无效。');
  const where: Prisma.CircleWhereInput = {...(status !== 'ALL' ? {status} : {}), ...(ownership === 'SITE' ? {ownerId: null} : ownership === 'USER' ? {ownerId: {not: null}} : {}), ...(featured !== 'ALL' ? {isFeatured: featured === 'YES'} : {}), ...(q.trim() ? {OR: [{id: q.trim()}, {name: {contains: q.trim()}}, {description: {contains: q.trim()}}, {tags: {contains: q.trim()}}]} : {})};
  return db.$transaction(async tx => {
    await requireCircleManagement(actor, 'community.read', tx);
    const [items, total] = await Promise.all([tx.circle.findMany({where, select: projection, orderBy: [{updatedAt: 'desc'}, {id: 'asc'}], take: 25, skip: (page - 1) * 25}), tx.circle.count({where})]);
    return {items, total, page, pageSize: 25};
  });
}
export async function readManagedCircle(actor: string, id: string) {
  return db.$transaction(async tx => {
    await requireCircleManagement(actor, 'community.read', tx);
    const circle = await tx.circle.findUnique({where: {id}, select: projection});
    if (!circle) throw new CircleError('圈子不存在。', 404);
    return circle;
  });
}
export async function saveManagedCircle(actor: string, id: string | null, input: unknown) {
  const {body, reason, expected} = readManagementCommand(input, id !== null);
  const action = body.action ?? 'SAVE';
  if (!['SAVE', 'HIDE', 'RESTORE', 'FEATURE', 'UNFEATURE'].includes(action as string) || !id && action !== 'SAVE') throw new CircleError('圈子管理动作无效。');
  let content: ReturnType<typeof validateCircleContent> | null = null;
  if (action === 'SAVE') {
    if (!body.content || typeof body.content !== 'object' || Array.isArray(body.content) || Object.keys(body.content).some(key => !['name', 'description', 'tags', 'universeId'].includes(key))) throw new CircleError('圈子内容包含不支持的字段。');
    content = validateCircleContent(body.content);
  }
  await pragmasReady;
  return db.$transaction(async tx => {
    await claimCircleManager(tx, actor, 'community.write');
    const before = id ? await tx.circle.findUnique({where: {id}, select: projection}) : null;
    if (id && !before) throw new CircleError('圈子不存在。', 404);
    if (before && before.updatedAt.getTime() !== expected) throw new CircleError('圈子已被修改，请刷新后重试。', 409);
    if (content && before?.owner?.deletedAt) throw new CircleError('已注销作者的圈子内容不能恢复或编辑。', 409);
    if (content && (!before || content.universeId !== before.universeId)) await validateCircleUniverse(tx, content.universeId);
    if (action === 'FEATURE' && before?.status !== 'ACTIVE') throw new CircleError('仅可推荐已公开的圈子。', 409);
    const updatedAt = new Date(Math.max(Date.now(), (before?.updatedAt.getTime() ?? 0) + 1));
    const data = {...(content ?? {}), ...(action === 'HIDE' ? {status: 'HIDDEN', isFeatured: false} : action === 'RESTORE' ? {status: 'ACTIVE'} : action === 'FEATURE' ? {isFeatured: true} : action === 'UNFEATURE' ? {isFeatured: false} : {}), updatedAt};
    const saved = id && before ? await tx.circle.update({where: {id}, data, select: projection}) : await tx.circle.create({data: {...content!, ownerId: null, status: 'HIDDEN', updatedAt}, select: projection});
    await recordAdminAudit(tx, actor, id ? `CIRCLE_${action}` : 'CIRCLE_CREATED', saved.id, reason, {fields: content ? Object.keys(content) : [], before: before ? {status: before.status, isFeatured: before.isFeatured, updatedAt: before.updatedAt} : null, after: {status: saved.status, isFeatured: saved.isFeatured, updatedAt: saved.updatedAt}, ownership: saved.ownerId ? 'USER' : 'SITE'});
    return saved;
  });
}
