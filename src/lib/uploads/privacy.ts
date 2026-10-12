import { rm } from 'node:fs/promises';
import path from 'node:path';
import { db } from '@/lib/db';
import { uploadDirectory, listOwnedUploadFiles, uploadOwnerPrefix } from './storage-service';

/** Legacy files had no ownership. Remove only when their surviving references are gone. */
async function hasSurvivingReference(url: string) {
  const counts = await Promise.all([
    db.user.count({ where: { avatarUrl: url } }), db.character.count({ where: { avatarUrl: url } }),
    db.characterImage.count({ where: { url } }), db.characterEmoji.count({ where: { url } }),
    db.supportCharacter.count({ where: { avatarUrl: url } }), db.postMedia.count({ where: { url } }),
    db.postComment.count({ where: { imageUrl: url } }), db.message.count({ where: { imageUrl: url } }),
    db.uploadAsset.count({ where: { url } }),
  ]);
  return counts.some(count => count > 0);
}

export async function finishClosureFileCleanup(id: string): Promise<'COMPLETED' | 'PENDING_FILES'> {
  const closure = await db.accountClosure.findUnique({ where: { id } }).catch(() => null);
  if (!closure) return 'PENDING_FILES';
  if (closure.status === 'COMPLETED') return 'COMPLETED';
  const remaining: string[] = [];
  try {
    const urls: string[] = [...new Set([...JSON.parse(closure.fileUrlsJson), ...await listOwnedUploadFiles(closure.userId)])];
    for (const url of urls) {
      if (!/^\/uploads\/[A-Za-z0-9_-]+\.(?:jpg|png|webp)$/.test(url)) { remaining.push(url); continue; }
      const name = url.slice('/uploads/'.length), target = path.resolve(uploadDirectory(), name);
      if (path.dirname(target) !== uploadDirectory()) { remaining.push(url); continue; }
      const ownership = await db.uploadAsset.findUnique({ where: { url }, select: { ownerId: true } });
      if (ownership && ownership.ownerId !== closure.userId) continue;
      const owned = ownership?.ownerId === closure.userId || name.startsWith(uploadOwnerPrefix(closure.userId));
      if (!owned && await hasSurvivingReference(url)) { remaining.push(url); continue; }
      try {
        await rm(target, { force: true });
        await db.uploadAsset.deleteMany({ where: { ownerId: closure.userId, url } });
      } catch { remaining.push(url); }
    }
    await db.accountClosure.update({ where: { id }, data: { fileUrlsJson: JSON.stringify(remaining), status: remaining.length ? 'PENDING_FILES' : 'COMPLETED', completedAt: remaining.length ? null : new Date() } });
    return remaining.length ? 'PENDING_FILES' : 'COMPLETED';
  } catch { return 'PENDING_FILES'; }
}

export async function retryPendingClosureFiles() {
  const pending = await db.accountClosure.findMany({ where: { status: 'PENDING_FILES' }, select: { id: true }, take: 50 });
  let completed = 0;
  for (const item of pending) if (await finishClosureFileCleanup(item.id) === 'COMPLETED') completed++;
  return { attempted: pending.length, completed, remaining: await db.accountClosure.count({ where: { status: 'PENDING_FILES' } }) };
}
