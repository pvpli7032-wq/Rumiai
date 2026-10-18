import type {Prisma} from '@prisma/client';
import {db} from '@/lib/db';

export async function readCommunityRestriction(userId: string, reader: Pick<Prisma.TransactionClient, 'user'> = db) {
  return reader.user.findUnique({where: {id: userId}, select: {communityBannedAt: true, communityBanReason: true}});
}

export async function readCommunityWriteRestriction(userId:string){
  const restriction=await readCommunityRestriction(userId);
  return restriction?.communityBannedAt?{reason:restriction.communityBanReason}:null;
}

/** Used inside the caller's writer transaction; community restrictions leave login and appeals available. */
export async function setCommunityRestriction(tx: Prisma.TransactionClient, userId: string, banned: boolean, reason: string, requireBanned = false) {
  const result = await tx.user.updateMany({where: {id: userId, deletedAt: null, ...(requireBanned ? {communityBannedAt: {not: null}} : {})}, data: {communityBannedAt: banned ? new Date() : null, communityBanReason: banned ? reason : null, accountVersion: {increment: 1}}});
  if (!result.count) throw Error(requireBanned ? 'USER_NOT_BANNED' : 'USER_TARGET_MISSING');
}
