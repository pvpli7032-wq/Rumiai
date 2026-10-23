import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {hasAdminPermission} from '@rumiai/backend/modules/admin/authorization';
import { db } from '@rumiai/backend/infrastructure/database/client';
import {isPublicSiteContentImageReference} from '@rumiai/backend/modules/site-content/public-service';
import type {Prisma} from '@prisma/client';
import { uploadDirectory, UploadError } from './storage-service';

export type UploadReader = Pick<Prisma.TransactionClient, 'user' | 'character' | 'post' | 'postComment' | 'postMedia' | 'message' | 'uploadAsset' | 'banner' | 'siteContentDraft'>;

async function publicReference(url: string, ownerId?: string, reader: UploadReader = db, includeUserAvatar = true) {
  const counts = await Promise.all([
    includeUserAvatar ? reader.user.count({ where: { avatarUrl: url, deletedAt: null, ...(ownerId ? { id: ownerId } : {}) } }) : Promise.resolve(0),
    reader.character.count({ where: { isPublic: true, reviewStatus: 'APPROVED', ...(ownerId ? {AND: [{OR: [{creatorId: ownerId}, {creatorId: null}]}]} : {}), OR: [{ avatarUrl: url }, { images: { some: { url } } }, { emojis: { some: { url } } }, { supportCast: { some: { avatarUrl: url } } }] } }),
    reader.post.count({ where: { status: 'VISIBLE', circle: { status: 'ACTIVE' }, ...(ownerId ? { authorId: ownerId } : {}), media: { some: { url } } } }),
    reader.postComment.count({ where: { imageUrl: url, status: 'VISIBLE', ...(ownerId ? { authorId: ownerId } : {}), post: { status: 'VISIBLE', circle: { status: 'ACTIVE' } } } }),
    reader.banner.count({where: {imageUrl: url, isActive: true}}),
  ]);
  if (counts.some(count => count > 0) || await isPublicSiteContentImageReference(url)) return true;
  const scheduled = await reader.siteContentDraft.findMany({where: {contentType: 'BANNER', scheduledAt: {lte: new Date()}, draftJson: {contains: url}}, select: {draftJson: true}, take: 200});
  return scheduled.some(row => {try {const data = JSON.parse(row.draftJson); return data?.isActive === true && data?.imageUrl === url;} catch {return false;}});
}
async function privateLegacyReference(url: string, userId: string, reader: UploadReader = db) {
  const counts = await Promise.all([
    reader.user.count({ where: { id: userId, avatarUrl: url, deletedAt: null } }),
    reader.character.count({ where: { creatorId: userId, OR: [{ avatarUrl: url }, { images: { some: { url } } }, { emojis: { some: { url } } }, { supportCast: { some: { avatarUrl: url } } }] } }),
    reader.postMedia.count({ where: { url, post: { authorId: userId } } }),
    reader.postComment.count({ where: { imageUrl: url, authorId: userId } }),
    reader.message.count({ where: { imageUrl: url, conversation: { userId } } }),
  ]);
  return counts.some(count => count > 0);
}

/** A new attachment must belong to its author; existing legacy references remain editable. */
export async function mayAttachAccountUpload(userId: string, url: string, options: {allowSiteOwned?: boolean; reader?: UploadReader} = {}) {
  if (!/^\/uploads\/[A-Za-z0-9_-]{1,160}\.(?:jpg|png|webp)$/.test(url)) return false;
  const reader = options.reader ?? db;
  const asset = await reader.uploadAsset.findUnique({ where: { url }, select: { ownerId: true, siteOwned: true, owner: { select: { deletedAt: true } } } });
  return asset ? asset.siteOwned ? options.allowSiteOwned === true : asset.ownerId === userId && !asset.owner.deletedAt : options.allowSiteOwned ? false : privateLegacyReference(url, userId, reader);
}

/** Site content may publish only uploads explicitly marked as site-owned. */
export async function mayAttachSiteOwnedUpload(url:string,reader:UploadReader=db) {
  if(!/^\/uploads\/[A-Za-z0-9_-]{1,160}\.(?:jpg|png|webp)$/.test(url))return false;
  const asset=await reader.uploadAsset.findUnique({where:{url},select:{siteOwned:true}});
  return asset?.siteOwned===true;
}

/** Reads a site-owned image for a permissioned CMS draft preview. */
export async function readSiteOwnedUpload(name:string) {
  if(!/^[A-Za-z0-9_-]{1,160}\.(?:jpg|png|webp)$/.test(name))throw new UploadError('图片不存在。',404);
  const url=`/uploads/${name}`;
  const asset=await db.uploadAsset.findUnique({where:{url},select:{siteOwned:true}});
  if(!asset?.siteOwned)throw new UploadError('图片不存在。',404);
  try{
    const bytes=await readFile(path.join(uploadDirectory(),name));
    return {bytes,contentType:name.endsWith('.jpg')?'image/jpeg':name.endsWith('.png')?'image/png':'image/webp'};
  }catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')throw new UploadError('图片不存在。',404);throw error;}
}

export async function readVisibleUpload(name: string, userId: string | null) {
  if (!/^[A-Za-z0-9_-]{1,160}\.(?:jpg|png|webp)$/.test(name)) throw new UploadError('图片不存在。', 404);
  const url = `/uploads/${name}`;
  const asset = await db.uploadAsset.findUnique({ where: { url }, select: { ownerId: true, siteOwned: true, owner: { select: { deletedAt: true } } } });
  if (asset?.owner.deletedAt && !asset.siteOwned) throw new UploadError('图片不存在。', 404);
  const characterReference = {OR: [{avatarUrl: url}, {images: {some: {url}}}, {emojis: {some: {url}}}, {supportCast: {some: {avatarUrl: url}}}]};
  const administrativePreview = asset && userId !== null && await hasAdminPermission(userId, 'characters.read') && await db.character.count({where: {...(asset.siteOwned ? {creatorId: null} : {AND: [{OR: [{creatorId: asset.ownerId}, {creatorId: null}]}]}), reviewStatus: {not: 'DELETED'}, ...characterReference}}) > 0;
  const communityPreview = userId !== null && await hasAdminPermission(userId, 'community.read') && (await db.postMedia.count({where: {url, post: {status: {not: 'DELETED'}}}}) > 0 || await db.postComment.count({where: {imageUrl: url, status: {not: 'DELETED'}, post: {status: {not: 'DELETED'}}}}) > 0);
  const publicSiteCharacter = asset?.siteOwned ? await db.character.count({where: {creatorId: null, isPublic: true, reviewStatus: 'APPROVED', ...characterReference}}) > 0 : false;
  const allowed = administrativePreview || communityPreview || publicSiteCharacter || (asset ? asset.siteOwned ? await publicReference(url, undefined, db, false) : asset.ownerId === userId || await publicReference(url, asset.ownerId) : await publicReference(url) || (userId !== null && await privateLegacyReference(url, userId)));
  if (!allowed) throw new UploadError('图片不存在。', 404);
  try {
    const bytes = await readFile(path.join(uploadDirectory(), name));
    return { bytes, contentType: name.endsWith('.jpg') ? 'image/jpeg' : name.endsWith('.png') ? 'image/png' : 'image/webp' };
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new UploadError('图片不存在。', 404); throw error; }
}
