import type {Prisma} from '@prisma/client';
import {CircleError} from './errors';

export function validateCircleContent(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new CircleError('圈子数据格式不正确。');
  const body = input as Record<string, unknown>;
  if (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 40) throw new CircleError('圈子名称须为 1–40 个字符。');
  if (typeof body.description !== 'string' || !body.description.trim() || body.description.trim().length > 1000) throw new CircleError('圈子介绍须为 1–1000 个字符。');
  if (body.tags !== undefined && (typeof body.tags !== 'string' || body.tags.length > 200)) throw new CircleError('标签须为不超过 200 字符的文字。');
  const tags = typeof body.tags === 'string' ? [...new Set(body.tags.split(/[,，]/).map(tag => tag.trim()).filter(Boolean))] : [];
  if (tags.length > 10 || tags.some(tag => tag.length > 20)) throw new CircleError('最多 10 个标签，每个不超过 20 字符。');
  if (body.universeId !== undefined && body.universeId !== null && (typeof body.universeId !== 'string' || body.universeId.length > 100)) throw new CircleError('世界观关联格式不正确。');
  return {name: body.name.trim(), description: body.description.trim(), tags: tags.join(',') || null, universeId: typeof body.universeId === 'string' && body.universeId ? body.universeId : null};
}
export async function validateCircleUniverse(tx: Prisma.TransactionClient, universeId: string | null) {
  if (universeId && !await tx.universe.findFirst({where: {id: universeId, isPublic: true}, select: {id: true}})) throw new CircleError('只能关联已公开的世界观。');
}
