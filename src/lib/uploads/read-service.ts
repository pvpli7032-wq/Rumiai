import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { db } from '@/lib/db';
import { uploadDirectory, UploadError } from './storage-service';

async function publicReference(url: string, ownerId?: string) {
  const counts = await Promise.all([
    db.user.count({ where: { avatarUrl: url, deletedAt: null, ...(ownerId ? { id: ownerId } : {}) } }),
    db.character.count({ where: { isPublic: true, reviewStatus: 'APPROVED', ...(ownerId ? { creatorId: ownerId } : {}), OR: [{ avatarUrl: url }, { images: { some: { url } } }, { emojis: { some: { url } } }, { supportCast: { some: { avatarUrl: url } } }] } }),
    db.post.count({ where: { status: 'VISIBLE', circle: { status: 'ACTIVE' }, ...(ownerId ? { authorId: ownerId } : {}), media: { some: { url } } } }),
    db.postComment.count({ where: { imageUrl: url, status: 'VISIBLE', ...(ownerId ? { authorId: ownerId } : {}), post: { status: 'VISIBLE', circle: { status: 'ACTIVE' } } } }),
  ]);
  return counts.some(count => count > 0);
}
async function privateLegacyReference(url: string, userId: string) {
  const counts = await Promise.all([
    db.user.count({ where: { id: userId, avatarUrl: url, deletedAt: null } }),
    db.character.count({ where: { creatorId: userId, OR: [{ avatarUrl: url }, { images: { some: { url } } }, { emojis: { some: { url } } }, { supportCast: { some: { avatarUrl: url } } }] } }),
    db.postMedia.count({ where: { url, post: { authorId: userId } } }),
    db.postComment.count({ where: { imageUrl: url, authorId: userId } }),
    db.message.count({ where: { imageUrl: url, conversation: { userId } } }),
  ]);
  return counts.some(count => count > 0);
}

/** A new attachment must belong to its author; existing legacy references remain editable. */
export async function mayAttachAccountUpload(userId: string, url: string) {
  if (!/^\/uploads\/[A-Za-z0-9_-]{1,160}\.(?:jpg|png|webp)$/.test(url)) return false;
  const asset = await db.uploadAsset.findUnique({ where: { url }, select: { ownerId: true, owner: { select: { deletedAt: true } } } });
  return asset ? asset.ownerId === userId && !asset.owner.deletedAt : privateLegacyReference(url, userId);
}

export async function readVisibleUpload(name: string, userId: string | null) {
  if (!/^[A-Za-z0-9_-]{1,160}\.(?:jpg|png|webp)$/.test(name)) throw new UploadError('图片不存在。', 404);
  const url = `/uploads/${name}`;
  const asset = await db.uploadAsset.findUnique({ where: { url }, select: { ownerId: true, owner: { select: { deletedAt: true } } } });
  if (asset?.owner.deletedAt) throw new UploadError('图片不存在。', 404);
  const allowed = asset ? asset.ownerId === userId || await publicReference(url, asset.ownerId) : await publicReference(url) || (userId !== null && await privateLegacyReference(url, userId));
  if (!allowed) throw new UploadError('图片不存在。', 404);
  try {
    const bytes = await readFile(path.join(uploadDirectory(), name));
    return { bytes, contentType: name.endsWith('.jpg') ? 'image/jpeg' : name.endsWith('.png') ? 'image/png' : 'image/webp' };
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new UploadError('图片不存在。', 404); throw error; }
}
