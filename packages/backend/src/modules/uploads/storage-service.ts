import { createHash } from 'node:crypto';
import { mkdir, writeFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { db, pragmasReady } from '@rumiai/backend/infrastructure/database/client';
import type {Prisma} from '@prisma/client';

import { readUploadMaxBytes } from '@rumiai/backend/modules/settings/index';

import { uploadDirectory } from './storage-location.mjs';
export { uploadDirectory } from './storage-location.mjs';
export const uploadOwnerPrefix = (userId: string) => createHash('sha256').update(userId).digest('hex') + '-';
export class UploadError extends Error { constructor(message: string, public status: number) { super(message); } }

export async function listOwnedUploadFiles(userId: string) {
  const prefix = uploadOwnerPrefix(userId);
  try { return (await readdir(uploadDirectory())).filter(name => name.startsWith(prefix) && /^[a-f0-9]+-[a-f0-9]+\.(jpg|png|webp)$/.test(name)).map(name => `/uploads/${name}`); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
}

/** Promote only validated uploads attached to a system-owned character. */
export async function retainCharacterUploadsForSite(tx: Prisma.TransactionClient, ownerId: string, urls: string[]) {
  const ownedUrls = [...new Set(urls.filter(url => /^\/uploads\/[A-Za-z0-9_-]{1,160}\.(?:jpg|png|webp)$/.test(url)))];
  if (!ownedUrls.length) return 0;
  const result = await tx.uploadAsset.updateMany({where: {ownerId, url: {in: ownedUrls}, siteOwned: false}, data: {siteOwned: true}});
  return result.count;
}

export async function saveAccountUpload(userId: string, file: File) {
  const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[file.type];
  if (!extension) throw new UploadError('仅支持 JPG、PNG 和 WebP 图片。', 415);
  const maxBytes = await readUploadMaxBytes();
  if (!file.size || file.size > maxBytes) throw new UploadError(`图片不能为空，且不能超过 ${Math.floor(maxBytes / (1024 * 1024))} MB。`, 413);
  const buffer = Buffer.from(await file.arrayBuffer());
  const signature = buffer.length >= 12 && (file.type === 'image/jpeg' ? buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff : file.type === 'image/png' ? buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) : buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP');
  if (!signature) throw new UploadError('图片内容与格式不符。', 415);
  const name = `${uploadOwnerPrefix(userId)}${createHash('sha256').update(buffer).digest('hex').slice(0, 32)}.${extension}`;
  const target = path.join(uploadDirectory(), name), url = `/uploads/${name}`;
  await pragmasReady;
  try {
    await db.$transaction(async tx => {
      if (!await tx.user.findFirst({ where: { id: userId, deletedAt: null }, select: { id: true } })) throw new UploadError('账号已注销，请重新登录。', 401);
      // Claim the writer transaction before touching disk; closure sees every committed asset.
      await tx.uploadAsset.upsert({ where: { url }, create: { ownerId: userId, url }, update: { url } });
      await mkdir(uploadDirectory(), { recursive: true });
      await writeFile(target, buffer);
    });
  } catch (error) {
    // A timed-out transaction can leave a file. Its owner prefix is also collected at closure.
    const owner = await db.user.findUnique({ where: { id: userId }, select: { deletedAt: true } }).catch(() => null);
    if (owner?.deletedAt) await rm(target, { force: true }).catch(() => {});
    throw error;
  }
  return { url, size: file.size };
}
