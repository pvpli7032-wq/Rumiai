import { db } from '@/lib/db';

export class CommunityAppealError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'CommunityAppealError';
  }
}

export async function listOwnCommunityAppeals(userId: string) {
  return db.communityAppeal.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: { id: true, reason: true, status: true, resolution: true, createdAt: true, updatedAt: true },
  });
}

export async function submitCommunityAppeal(userId: string, input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new CommunityAppealError('申诉数据格式不正确。', 400);
  const reason = typeof (input as Record<string, unknown>).reason === 'string' ? ((input as Record<string, string>).reason).trim() : '';
  if (reason.length < 10 || reason.length > 1000) throw new CommunityAppealError('请填写 10 至 1000 字的申诉说明。', 400);

  return db.$transaction(async tx => {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { communityBannedAt: true } });
    if (!user?.communityBannedAt) throw new CommunityAppealError('当前账号没有社区封禁，无需申诉。', 409);
    if (await tx.communityAppeal.findFirst({ where: { userId, status: 'OPEN' }, select: { id: true } })) {
      throw new CommunityAppealError('已有一条申诉正在审核。', 409);
    }

    const appeal = await tx.communityAppeal.create({ data: { userId, reason }, select: { id: true, reason: true, status: true, createdAt: true } });
    await tx.moderationAction.create({ data: { actorId: userId, targetType: 'USER', targetId: userId, action: 'APPEAL_SUBMITTED', reason } });
    return appeal;
  });
}
