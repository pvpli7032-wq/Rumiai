import type {Prisma} from '@prisma/client';
import {db, pragmasReady} from '@rumiai/backend/infrastructure/database/client';
import {hasAdminPermission} from '@rumiai/backend/modules/admin/authorization';
import type {AdminPermission} from '@rumiai/contracts/admin/permissions';
import {recordAdminAudit} from '@rumiai/backend/modules/admin/management-service';
import {mayAttachAccountUpload} from '@rumiai/backend/modules/uploads/read-service';
import {retainCharacterUploadsForSite} from '@rumiai/backend/modules/uploads/storage-service';
import {saveCharacterAssets, CharacterAssetError} from '@rumiai/backend/modules/characters/managed-assets';
import {validateCharacter} from '@rumiai/backend/modules/characters/validation';
import {CHARACTER_FIELDS} from '@rumiai/contracts/characters/limits';

export class CharacterManagementError extends Error {
  constructor(message: string, public status = 400) {super(message);}
}
const summary = {id: true, name: true, tagline: true, avatarUrl: true, creatorId: true, reviewStatus: true, isPublic: true, publicationRequested: true, tags: true, isAdult: true, updatedAt: true, creator: {select: {username: true}}} as const;
async function requirePermission(actor: string, key: AdminPermission, tx: Prisma.TransactionClient = db) {
  if (!await hasAdminPermission(actor, key, tx) || key !== 'characters.read' && !await hasAdminPermission(actor, 'characters.read', tx)) throw new CharacterManagementError('当前账号没有此角色管理权限。', 403);
}
export async function listManagedCharacters(actor: string, query: {q?: string; status?: string; creatorId?: string; tag?: string; page?: number}) {
  await requirePermission(actor, 'characters.read');
  const {q = '', status = 'ALL', creatorId = '', tag = '', page = 1} = query;
  if (q.length > 100 || tag.length > 50 || creatorId && !/^[A-Za-z0-9_-]{1,100}$/.test(creatorId) || !['ALL', 'DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'DELETED'].includes(status) || !Number.isSafeInteger(page) || page < 1 || page > 10000) throw new CharacterManagementError('角色查询条件无效。');
  const where: Prisma.CharacterWhereInput = {...(status !== 'ALL' ? {reviewStatus: status} : {}), ...(creatorId ? {creatorId} : {}), ...(q.trim() ? {OR: [{name: {contains: q.trim()}}, {tagline: {contains: q.trim()}}, {id: q.trim()}]} : {}), ...(tag.trim() ? {AND: [{OR: [{tags: tag.trim()}, {tags: {startsWith: tag.trim() + ','}}, {tags: {endsWith: ',' + tag.trim()}}, {tags: {contains: ',' + tag.trim() + ','}}]}]} : {})};
  return db.$transaction(async tx => {
    await requirePermission(actor, 'characters.read', tx);
    const [items, total] = await Promise.all([tx.character.findMany({where, select: summary, orderBy: [{updatedAt: 'desc'}, {id: 'asc'}], take: 25, skip: (page - 1) * 25}), tx.character.count({where})]);
    return {items, total, page, pageSize: 25};
  });
}
export async function readManagedCharacter(actor: string, id: string) {
  await requirePermission(actor, 'characters.read');
  return db.$transaction(async tx => {
    await requirePermission(actor, 'characters.read', tx);
    const character = await tx.character.findUnique({where: {id}, include: {creator: {select: {id: true, username: true, deletedAt: true}}, images: {orderBy: {sortOrder: 'asc'}}, emojis: {orderBy: {sortOrder: 'asc'}}, supportCast: {orderBy: {sortOrder: 'asc'}}}});
    if (!character) throw new CharacterManagementError('角色不存在。', 404);
    return {...character, deletion: await characterDeletionState(tx, character)};
  });
}

type CharacterDeletionTarget = {id: string; creatorId: string | null; reviewStatus: string; isPublic: boolean; publicationRequested: boolean};
async function characterReferences(tx: Prisma.TransactionClient, id: string) {
  const [conversations, gifts, likes, bookmarks, comments, posts, questProgress, reports, mirrorResults, disputes] = await Promise.all([
    tx.conversation.count({where: {characterId: id}}),
    tx.gift.count({where: {characterId: id}}),
    tx.characterLike.count({where: {characterId: id}}),
    tx.characterBookmark.count({where: {characterId: id}}),
    tx.comment.count({where: {characterId: id}}),
    tx.post.count({where: {characterId: id}}),
    tx.userCharacterQuest.count({where: {quest: {characterId: id}}}),
    tx.report.count({where: {targetType: 'CHARACTER', targetId: id}}),
    tx.mirrorResult.count({where: {characterId: id}}),
    tx.disputeCase.count({where: {characterId: id}}),
  ]);
  return {conversations, gifts, likes, bookmarks, comments, posts, questProgress, reports, mirrorResults, disputes};
}
async function characterDeletionState(tx: Prisma.TransactionClient, character: CharacterDeletionTarget) {
  const references = await characterReferences(tx, character.id);
  const referenceCount = Object.values(references).reduce((total, count) => total + count, 0);
  const blockers = [
    ...(character.creatorId !== null ? ['CREATOR_OWNED'] as const : []),
    ...(character.reviewStatus !== 'DRAFT' || character.isPublic || character.publicationRequested ? ['NOT_UNUSED_DRAFT'] as const : []),
    ...(referenceCount ? ['REFERENCES'] as const : []),
  ];
  return {references, referenceCount, blockers, canDelete: blockers.length === 0};
}
async function payload(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new CharacterManagementError('角色数据格式错误。');
  const body = input as Record<string, unknown>;
  if (typeof body.reason !== 'string' || !body.reason.trim() || body.reason.trim().length > 500) throw new CharacterManagementError('请填写1–500字操作理由。');
  if (!body.content || typeof body.content !== 'object' || Array.isArray(body.content)) throw new CharacterManagementError('角色内容格式错误。');
  if (Object.hasOwn(body.content, 'isPublic') || Object.hasOwn(body.content, 'is_public')) throw new CharacterManagementError('内容编辑不能直接公开角色，请使用发布操作。');
  const validated = await validateCharacter(body.content, false);
  if (validated.error) throw new CharacterManagementError(validated.error);

  const raw = body.content as Record<string, unknown>;
  const allowed = new Set([...CHARACTER_FIELDS, 'isAdult', 'isExclusive', 'relationshipStatus', 'initialRomance', 'initialIntimacy', 'images', 'emojis', 'supportCast']);
  if (Object.keys(raw).some(key => !allowed.has(key))) throw new CharacterManagementError('包含不支持的角色内容字段。');
  const relationship = raw.relationshipStatus;
  if (relationship !== undefined) {
    if (relationship !== null && (typeof relationship !== 'string' || relationship.length > 100)) throw new CharacterManagementError('初始关系须为100字以内文本。');
    validated.data.relationshipStatus = typeof relationship === 'string' ? relationship.trim() : null;
  }
  for (const key of ['initialRomance', 'initialIntimacy']) if (raw[key] !== undefined) {if (!Number.isSafeInteger(raw[key]) || (raw[key] as number) < 0 || (raw[key] as number) > 1000000) throw new CharacterManagementError('关系数值须为0–1000000整数。'); validated.data[key] = raw[key];}
  if (typeof validated.data.tags === 'string') validated.data.tags = [...new Set(validated.data.tags.split(',').map((tag: string) => tag.trim()).filter(Boolean))].join(',');
  if (!Object.keys(validated.data).length && !['images', 'emojis', 'supportCast'].some(key => raw[key] !== undefined)) throw new CharacterManagementError('没有可保存的角色内容。');
  return {body, content: validated.data, assets: raw, reason: body.reason.trim()};
}
export async function saveManagedCharacter(actor: string, id: string | null, input: unknown) {
  const {body, content, assets, reason} = await payload(input);
  if (id && (typeof body.updatedAt !== 'string' || !Number.isFinite(Date.parse(body.updatedAt)))) throw new CharacterManagementError('缺少有效角色版本。');
  if (!id) {const validated = await validateCharacter(content, true); if (validated.error) throw new CharacterManagementError(validated.error);}
  await pragmasReady;
  return db.$transaction(async tx => {
    await tx.$executeRaw`UPDATE users SET account_version = account_version WHERE id = ${actor}`;
    await requirePermission(actor, 'characters.write', tx);
    const before = id ? await tx.character.findUnique({where: {id}, select: {creatorId: true, avatarUrl: true, updatedAt: true, reviewStatus: true, isPublic: true, publicationRequested: true}}) : null;
    if (id && !before) throw new CharacterManagementError('角色不存在。', 404);
    if (before?.reviewStatus === 'DELETED') throw new CharacterManagementError('已注销作者的角色不能恢复或编辑。', 409);
    if (before && before.updatedAt.getTime() !== Date.parse(body.updatedAt as string)) throw new CharacterManagementError('角色已被修改，请刷新后重试。', 409);
    if (typeof content.avatarUrl === 'string' && content.avatarUrl.startsWith('/uploads/') && content.avatarUrl !== before?.avatarUrl && !await mayAttachAccountUpload(before?.creatorId ?? actor, content.avatarUrl, {allowSiteOwned: !before || before.creatorId === null})) throw new CharacterManagementError('上传素材须属于角色作者或已归属站点。');
    const updatedAt = new Date(Math.max(Date.now(), (before?.updatedAt.getTime() ?? 0) + 1));
    const state = before?.publicationRequested ? {isPublic: false, reviewStatus: 'PENDING', reviewReason: null, reviewedAt: null, reviewedBy: null} : {isPublic: false, reviewStatus: 'DRAFT'};
    const saved = before && id ? await tx.character.update({where: {id}, data: {...content, ...state, updatedAt}}) : await tx.character.create({data: {name: content.name, personality: content.personality, background: content.background ?? '', ...content, creatorId: null, isPublic: false, reviewStatus: 'DRAFT', publicationRequested: false, updatedAt}});
    let siteAssetsRetained = 0;
    try {
      await saveCharacterAssets(tx, saved.id, saved.creatorId, assets, actor);
      if (saved.creatorId === null) {
        const linked = await tx.character.findUniqueOrThrow({where: {id: saved.id}, select: {avatarUrl: true, images: {select: {url: true}}, emojis: {select: {url: true}}, supportCast: {select: {avatarUrl: true}}}});
        siteAssetsRetained = await retainCharacterUploadsForSite(tx, actor, [linked.avatarUrl ?? '', ...linked.images.map(row => row.url), ...linked.emojis.map(row => row.url), ...linked.supportCast.map(row => row.avatarUrl ?? '')]);
      }
    } catch (error) {if (error instanceof CharacterAssetError) throw new CharacterManagementError(error.message); throw error;}
    await recordAdminAudit(tx, actor, before ? 'CHARACTER_EDITED' : 'CHARACTER_CREATED', saved.id, reason, {fields: [...Object.keys(content), ...['images', 'emojis', 'supportCast'].filter(key => assets[key] !== undefined)], before: before ? {status: before.reviewStatus, isPublic: before.isPublic, updatedAt: before.updatedAt} : null, after: {status: saved.reviewStatus, isPublic: saved.isPublic, updatedAt, siteAssetsRetained}});
    return saved;
  });
}

export async function deleteManagedCharacterDraft(actor: string, id: string, input: unknown) {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) throw new CharacterManagementError('角色编号无效。');
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new CharacterManagementError('删除请求格式错误。');
  const body = input as Record<string, unknown>;
  if (typeof body.updatedAt !== 'string' || !Number.isFinite(Date.parse(body.updatedAt))) throw new CharacterManagementError('缺少有效角色版本。');
  if (typeof body.reason !== 'string' || !body.reason.trim() || body.reason.trim().length > 500) throw new CharacterManagementError('请填写1–500字删除理由。');
  const expectedUpdatedAt = body.updatedAt, explanation = body.reason.trim();
  await pragmasReady;
  return db.$transaction(async tx => {
    await tx.$executeRaw`UPDATE users SET account_version = account_version WHERE id = ${actor}`;
    await requirePermission(actor, 'characters.write', tx);
    const before = await tx.character.findUnique({where: {id}, select: {id: true, name: true, creatorId: true, reviewStatus: true, isPublic: true, publicationRequested: true, updatedAt: true}});
    if (!before) throw new CharacterManagementError('角色不存在。', 404);
    if (before.updatedAt.getTime() !== Date.parse(expectedUpdatedAt)) throw new CharacterManagementError('角色已被修改，请刷新后重试。', 409);
    const deletion = await characterDeletionState(tx, before);
    if (before.creatorId !== null) throw new CharacterManagementError('个人作者草稿应由作者自行管理，后台不能物理删除用户角色。', 409);
    if (before.reviewStatus !== 'DRAFT' || before.isPublic || before.publicationRequested) throw new CharacterManagementError('只允许删除从未发布、从未提交审核的站点草稿；已发布或有审核历史的角色请保持下架。', 409);
    if (deletion.referenceCount) throw new CharacterManagementError(`角色仍有业务引用（对话 ${deletion.references.conversations}、赠礼 ${deletion.references.gifts}、点赞 ${deletion.references.likes}、收藏 ${deletion.references.bookmarks}、评论 ${deletion.references.comments}、帖子 ${deletion.references.posts}、任务进度 ${deletion.references.questProgress}、举报 ${deletion.references.reports}、玩法结果 ${deletion.references.mirrorResults}、评理案例 ${deletion.references.disputes}），历史必须保留。`, 409);
    await tx.character.delete({where: {id}});
    await recordAdminAudit(tx, actor, 'DELETE_UNUSED_CHARACTER_DRAFT', id, explanation, {before, references: deletion.references});
    return {id, deleted: true};
  });
}
type PublicationTarget = {id: string; updatedAt: string};
async function applyPublication(tx: Prisma.TransactionClient, actor: string, target: PublicationTarget, publishing: boolean, reason: string) {
  const before = await tx.character.findUnique({where: {id: target.id}, include: {creator: {select: {deletedAt: true}}}});
  if (!before) throw new CharacterManagementError('角色不存在。', 404);
  if (before.reviewStatus === 'DELETED' || before.creator?.deletedAt) throw new CharacterManagementError('已删除的角色不能重新发布。', 409);
  if (before.updatedAt.getTime() !== Date.parse(target.updatedAt)) throw new CharacterManagementError('角色已被修改，请刷新后重试。', 409);
  if (publishing && (!before.copyrightStatement?.trim() || !before.name.trim() || !before.personality.trim())) throw new CharacterManagementError('公开前请补齐角色名称、人设及版权声明。');
  const updatedAt = new Date(Math.max(Date.now(), before.updatedAt.getTime() + 1));
  const saved = await tx.character.update({where: {id: target.id}, data: {isPublic: publishing, publicationRequested: true, reviewStatus: publishing ? 'APPROVED' : 'REJECTED', reviewedBy: actor, reviewedAt: new Date(), reviewReason: reason, updatedAt}});
  await recordAdminAudit(tx, actor, publishing ? 'CHARACTER_APPROVED' : 'CHARACTER_REJECTED', target.id, reason, {before: {status: before.reviewStatus, isPublic: before.isPublic}, after: {status: saved.reviewStatus, isPublic: saved.isPublic, updatedAt}});
  return saved;
}
export async function publishManagedCharacters(actor: string, input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new CharacterManagementError('发布数据格式错误。');
  const body = input as Record<string, unknown>;
  if (!['PUBLISH', 'UNPUBLISH'].includes(body.action as string) || typeof body.reason !== 'string' || !body.reason.trim() || body.reason.trim().length > 500 || !Array.isArray(body.items) || !body.items.length || body.items.length > 25) throw new CharacterManagementError('请选择发布动作并填写理由，单次最多25个角色。');
  const reason = body.reason.trim(), publishing = body.action === 'PUBLISH';
  const items = body.items.map(raw => {
    if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(raw.id) || typeof raw.updatedAt !== 'string' || !Number.isFinite(Date.parse(raw.updatedAt))) throw new CharacterManagementError('角色编号或版本无效。');
    return {id: raw.id as string, updatedAt: raw.updatedAt as string};
  });
  if (new Set(items.map(item => item.id)).size !== items.length) throw new CharacterManagementError('角色选择不能重复。');
  await pragmasReady;
  return db.$transaction(async tx => {
    await tx.$executeRaw`UPDATE users SET account_version = account_version WHERE id = ${actor}`;
    await requirePermission(actor, 'characters.publish', tx);
    const results = [];
    for (const target of items) results.push(await applyPublication(tx, actor, target, publishing, reason));
    return results;
  });
}
export async function publishManagedCharacter(actor: string, id: string, input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new CharacterManagementError('发布数据格式错误。');
  const body = input as Record<string, unknown>;
  const results = await publishManagedCharacters(actor, {action: body.action, reason: body.reason, items: [{id, updatedAt: body.updatedAt}]});
  return results[0];
}
