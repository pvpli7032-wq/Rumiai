import type {Prisma} from '@prisma/client';
import {mayAttachAccountUpload} from '@/lib/uploads/read-service';
import {validateCharacter} from './validation';

export class CharacterAssetError extends Error {}
function rows(value: unknown, limit: number) {
  if (!Array.isArray(value) || value.length > limit || value.some(row => !row || typeof row !== 'object' || Array.isArray(row))) throw new CharacterAssetError(`素材列表格式错误，最多${limit}项。`);
  return value as Record<string, unknown>[];
}
function text(value: unknown, label: string, max: number, required = true) {
  if (typeof value !== 'string' || value.length > max || required && !value.trim()) throw new CharacterAssetError(`${label}格式错误或超过${max}字。`);
  return value.trim();
}
function checkedId(value: unknown, existing: Set<string>, used: Set<string>) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !existing.has(value) || used.has(value)) throw new CharacterAssetError('素材编号不属于此角色或重复。');
  used.add(value); return value;
}
async function checkedUrl(value: unknown, ownerId: string | null, previous: string | null, optional = false, allowSiteOwned = false) {
  const url = text(value ?? '', '素材地址', 2048, !optional);
  if (!url) return '';
  const valid = validateCharacter({avatarUrl: url}, false);
  if (valid.error) throw new CharacterAssetError(valid.error);
  if (url.startsWith('/uploads/') && url !== previous && (!ownerId || !await mayAttachAccountUpload(ownerId, url, {allowSiteOwned}))) throw new CharacterAssetError('上传素材须属于角色作者或已归属站点。');
  return url;
}
/** The character writer owns the transaction. Child IDs are retained and foreign IDs are rejected. */
export async function saveCharacterAssets(tx: Prisma.TransactionClient, characterId: string, ownerId: string | null, input: Record<string, unknown>, actorId: string) {
  if (input.images !== undefined) {
    const before = await tx.characterImage.findMany({where: {characterId}}), existing = new Set(before.map(row => row.id)), used = new Set<string>();
    const checked = [];
    for (const row of rows(input.images, 12)) {
      const id = checkedId(row.id, existing, used), kind = row.kind ?? 'IMAGE';
      if (kind !== 'IMAGE' && kind !== 'VIDEO') throw new CharacterAssetError('画廊类型无效。');
      const url = await checkedUrl(row.url, ownerId ?? actorId, before.find(item => item.id === id)?.url ?? null, false, ownerId === null);
      if (kind === 'VIDEO' && url.startsWith('/uploads/')) throw new CharacterAssetError('当前上传接口只支持图片，视频请使用已授权的外部视频地址。');
      checked.push({id, kind, url});
    }
    await tx.characterImage.deleteMany({where: {characterId, id: {notIn: [...used]}}});
    for (let sortOrder = 0; sortOrder < checked.length; sortOrder++) {const {id, kind, url} = checked[sortOrder]; if (id) await tx.characterImage.update({where: {id}, data: {url, kind, sortOrder}}); else await tx.characterImage.create({data: {characterId, url, kind, sortOrder}});}
  }
  if (input.emojis !== undefined) {
    const before = await tx.characterEmoji.findMany({where: {characterId}}), existing = new Set(before.map(row => row.id)), used = new Set<string>(), emotions = new Set<string>();
    const checked = [];
    for (const row of rows(input.emojis, 20)) {
      const id = checkedId(row.id, existing, used), emotion = text(row.emotion, '表情名称', 40);
      if (emotions.has(emotion)) throw new CharacterAssetError('同一角色的表情名称不能重复。'); emotions.add(emotion);
      checked.push({id, emotion, url: await checkedUrl(row.url, ownerId ?? actorId, before.find(item => item.id === id)?.url ?? null, false, ownerId === null)});
    }
    await tx.characterEmoji.deleteMany({where: {characterId, id: {notIn: [...used]}}});
    for (const id of used) await tx.characterEmoji.update({where: {id}, data: {emotion: `__character_management_pending_swap_${id}`}});
    for (let sortOrder = 0; sortOrder < checked.length; sortOrder++) {const {id, emotion, url} = checked[sortOrder]; if (id) await tx.characterEmoji.update({where: {id}, data: {emotion, url, sortOrder}}); else await tx.characterEmoji.create({data: {characterId, emotion, url, sortOrder}});}
  }
  if (input.supportCast !== undefined) {
    const before = await tx.supportCharacter.findMany({where: {characterId}}), existing = new Set(before.map(row => row.id)), used = new Set<string>();
    const checked = [];
    for (const row of rows(input.supportCast, 10)) {const id = checkedId(row.id, existing, used); checked.push({id, name: text(row.name, '配角名称', 40), description: text(row.description ?? '', '配角说明', 2000, false), avatarUrl: await checkedUrl(row.avatarUrl, ownerId ?? actorId, before.find(item => item.id === id)?.avatarUrl ?? null, true, ownerId === null)});}
    await tx.supportCharacter.deleteMany({where: {characterId, id: {notIn: [...used]}}});
    for (let sortOrder = 0; sortOrder < checked.length; sortOrder++) {const {id, name, description, avatarUrl} = checked[sortOrder]; if (id) await tx.supportCharacter.update({where: {id}, data: {name, description, avatarUrl: avatarUrl || null, sortOrder}}); else await tx.supportCharacter.create({data: {characterId, name, description, avatarUrl: avatarUrl || null, sortOrder}});}
  }
}
