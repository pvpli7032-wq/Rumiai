import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

/** Community bans stop new community actions while leaving login, reading and appeals available. */
export async function communityWriteBlock(userId: string): Promise<NextResponse | null> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { communityBannedAt: true, communityBanReason: true } });
  if (!user?.communityBannedAt) return null;
  return NextResponse.json({ error: '你的社区发言权限暂时受限。可在社区申诉入口提交复核。', reason: user.communityBanReason }, { status: 403 });
}
