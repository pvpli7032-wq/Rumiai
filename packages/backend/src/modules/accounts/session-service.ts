import { db } from '@rumiai/backend/infrastructure/database/client';

/** Invalidate every Bearer and media-session token issued for this account. */
export async function revokeAllSessions(userId: string) {
  const user = await db.user.update({
    where: {id: userId},
    data: {tokenVersion: {increment: 1}},
    select: {tokenVersion: true},
  });
  return user.tokenVersion;
}
