import {db} from '@/lib/db';
import {canDeleteMirrorResult, canReadMirrorAnswers, isMirrorReadable, toOwnerResult, toPublicResult, verifyMirrorAttribution, type MirrorRow, type MirrorViewer} from './share';
import {MirrorError} from './errors';
import type {MirrorOwnerResult, MirrorPublicResult} from './types';

/**
 * 结果读写。删除一律写在 status 上（HIDDEN / EXPIRED），所以删除、过期、隐藏之后
 * 所有读路径都是 404，分享链接不会残留内容。
 */

export type MirrorOwnerView = {shareId: string; title: string; characterName: string; characterAvatarUrl: string | null; createdAt: string};

export type MirrorReadResult =
  | {kind: 'public'; result: MirrorPublicResult}
  | {kind: 'owner'; result: MirrorOwnerResult};

export async function readMyMirrorResults(userId: string | null, subject: string | null): Promise<MirrorOwnerView[]> {
  const scope = userId ? {userId} : subject ? {userId: null, anonymousSubject: subject} : null;
  if (!scope) return [];
  const rows = await db.mirrorResult.findMany({
    where: {...scope, status: 'READY', OR: [{expiresAt: null}, {expiresAt: {gt: new Date()}}]},
    orderBy: {createdAt: 'desc'},
    take: 10,
    select: {shareId: true, title: true, characterId: true, createdAt: true},
  });
  const characters = await db.character.findMany({where: {id: {in: rows.map(row => row.characterId)}}, select: {id: true, name: true, avatarUrl: true}});
  const byId = new Map(characters.map(item => [item.id, item]));
  return rows.map(row => ({
    shareId: row.shareId,
    title: row.title,
    characterName: byId.get(row.characterId)?.name ?? '角色',
    characterAvatarUrl: byId.get(row.characterId)?.avatarUrl ?? null,
    createdAt: row.createdAt.toISOString(),
  }));
}

function parseAnswers(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

/** 读一条结果：公开视图总会返回；只有本人或归属凭据持有人才带上原回答与删除权。 */
export async function readMirrorResult(shareId: string, viewer: MirrorViewer, attribution: string | null = null): Promise<MirrorReadResult> {
  const row = await db.mirrorResult.findUnique({where: {shareId}});
  if (!row || !isMirrorReadable(row)) throw new MirrorError('这条结果不存在或已删除。', 404, 'MIRROR_NOT_FOUND');
  const character = await db.character.findUnique({where: {id: row.characterId}, select: {id: true, name: true, avatarUrl: true}});
  const publicResult = toPublicResult(row as MirrorRow, character ?? {id: row.characterId, name: '角色', avatarUrl: null});
  if (!publicResult) throw new MirrorError('这条结果不存在或已删除。', 404, 'MIRROR_NOT_FOUND');
  const attributionValid = !viewer.userId && verifyMirrorAttribution({subject: viewer.subject, shareId, token: attribution});
  if (canReadMirrorAnswers({row, viewer, attributionValid})) return {kind: 'owner', result: toOwnerResult(publicResult, parseAnswers(row.answersJson), true)};
  return {kind: 'public', result: publicResult};
}

/** 删除：本人可删，匿名凭创建时归属凭据删；删除后一律 404。 */
export async function deleteMirrorResult(shareId: string, viewer: MirrorViewer, attribution: string | null): Promise<void> {
  const row = await db.mirrorResult.findUnique({where: {shareId}, select: {id: true, userId: true, anonymousSubject: true, status: true, expiresAt: true}});
  if (!row || !isMirrorReadable(row)) throw new MirrorError('这条结果不存在或已删除。', 404, 'MIRROR_NOT_FOUND');
  const attributionValid = !viewer.userId && verifyMirrorAttribution({subject: viewer.subject, shareId, token: attribution});
  if (!canDeleteMirrorResult({row, viewer, attributionValid})) throw new MirrorError('没有权限删除这条结果。', 403, 'MIRROR_FORBIDDEN');
  const changed = await db.mirrorResult.updateMany({where: {shareId, status: 'READY'}, data: {status: 'HIDDEN'}});
  if (!changed.count) throw new MirrorError('这条结果不存在或已删除。', 404, 'MIRROR_NOT_FOUND');
}

/** 对比：登录后可并排看最多 compareLimit 个角色的结果，别人的只给公开字段。 */
export async function compareMirrorResults(shareIds: unknown, userId: string, compareLimit: number): Promise<MirrorReadResult[]> {
  const ids = Array.isArray(shareIds) ? Array.from(new Set(shareIds.filter((id): id is string => typeof id === 'string' && id.length > 0))) : [];
  const capped = ids.slice(0, Math.max(1, Math.min(compareLimit, 6)));
  if (!capped.length) return [];
  const rows = await db.mirrorResult.findMany({where: {shareId: {in: capped}}});
  const byId = new Map(rows.map(row => [row.shareId, row]));
  const characters = await db.character.findMany({where: {id: {in: rows.map(row => row.characterId)}}, select: {id: true, name: true, avatarUrl: true}});
  const views = new Map(characters.map(item => [item.id, item]));
  const output: MirrorReadResult[] = [];
  for (const id of capped) {
    const row = byId.get(id);
    if (!row || !isMirrorReadable(row)) continue;
    const pub = toPublicResult(row as MirrorRow, views.get(row.characterId) ?? {id: row.characterId, name: '角色', avatarUrl: null});
    if (!pub) continue;
    output.push(row.userId === userId ? {kind: 'owner', result: toOwnerResult(pub, parseAnswers(row.answersJson), true)} : {kind: 'public', result: pub});
  }
  return output;
}

/** 保留期到期处理；批量清理由后台任务 mirror-expire 调用。 */
export async function expireMirrorResults(now = new Date()): Promise<number> {
  const changed = await db.mirrorResult.updateMany({where: {status: 'READY', expiresAt: {lte: now}}, data: {status: 'EXPIRED'}});
  return changed.count;
}
