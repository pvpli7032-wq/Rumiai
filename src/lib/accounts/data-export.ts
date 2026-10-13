import { db } from '@/lib/db';
import {readOwnAdminIdentity} from '@/lib/admin/management-service';

// Explicit projections keep credentials and other users' private character data out
// of the archive. All sections are read from one database transaction snapshot.
export async function exportAccountData(userId: string) {
  return db.$transaction(async tx => {
    const account = await tx.user.findFirst({ where: { id: userId, deletedAt: null }, select: {
      id: true, username: true, email: true, displayName: true, avatarUrl: true,
      createdAt: true, coins: true, bannedWords: true, readingMode: true, shortcuts: true,
      tier: true, updatedAt: true, streakCount: true, lastCheckin: true,
      suspendedAt: true, suspensionReason: true, lastLoginAt: true, lastActiveAt: true,
    } });
    if (!account) return null;
    const conversations = await tx.conversation.findMany({ where: { userId }, select: {
      id: true, characterId: true, title: true, notes: true, createdAt: true,
      updatedAt: true, archivedAt: true,
      messages: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: {
        id: true, role: true, content: true, imageUrl: true, createdAt: true,
      } },
    } });
    const characters = await tx.character.findMany({ where: { creatorId: userId }, include: {
      images: true, emojis: true, supportCast: true, quests: true,
    } });
    const posts = await tx.post.findMany({ where: { authorId: userId }, select: {
      id: true, circleId: true, characterId: true, content: true, status: true,
      createdAt: true, updatedAt: true, media: { select: { url: true, position: true } },
    } });
    const postComments = await tx.postComment.findMany({ where: { authorId: userId }, select: {
      id: true, postId: true, content: true, imageUrl: true, status: true, createdAt: true, updatedAt: true,
    } });
    const comments = await tx.comment.findMany({ where: { authorId: userId }, select: {
      id: true, characterId: true, body: true, createdAt: true,
    } });
    const transactions = await tx.coinTransaction.findMany({ where: { userId } });
    const orders = await tx.paymentOrder.findMany({ where: { userId }, select: {
      orderNo: true, status: true, amountCnyCents: true, coinAmount: true, createdAt: true, paidAt: true,
      refund: { select: { refundNo: true, status: true, amountCnyCents: true, coinAmount: true, createdAt: true, completedAt: true } },
    } });
    const uploads = await tx.uploadAsset.findMany({ where: { ownerId: userId }, select: { url: true, createdAt: true } });
    const [reports, appeals, following, followers, memberships, circles, bookmarks, characterLikes, postLikes, commentLikes, checkins, gifts, missions, questProgress, aiCalls, aiDailyUsage] = await Promise.all([
      // Evidence snapshots and other reporters' records are deliberately excluded.
      tx.report.findMany({ where: { reporterId: userId }, select: { id: true, targetType: true, targetId: true, category: true, imageReason: true, details: true, workTitle: true, relationship: true, sourceLink: true, contactType: true, contactValue: true, status: true, createdAt: true } }),
      tx.communityAppeal.findMany({ where: { userId }, select: { id: true, reason: true, status: true, resolution: true, reviewedAt: true, createdAt: true, updatedAt: true } }),
      tx.follow.findMany({ where: { followerId: userId }, select: { followingId: true, createdAt: true } }),
      tx.follow.findMany({ where: { followingId: userId }, select: { followerId: true, createdAt: true } }),
      tx.circleMember.findMany({ where: { userId }, select: { circleId: true, createdAt: true } }),
      tx.circle.findMany({ where: { ownerId: userId }, select: { id: true, name: true, description: true, tags: true, status: true, createdAt: true, updatedAt: true } }),
      tx.characterBookmark.findMany({ where: { userId }, select: { characterId: true, createdAt: true } }),
      tx.characterLike.findMany({ where: { userId }, select: { characterId: true, createdAt: true } }),
      tx.postLike.findMany({ where: { userId }, select: { postId: true, createdAt: true } }),
      tx.commentLike.findMany({ where: { userId }, select: { commentId: true, createdAt: true } }),
      tx.checkin.findMany({ where: { userId }, select: { checkedInAt: true, coinsEarned: true, streakDay: true } }),
      tx.gift.findMany({ where: { senderId: userId }, select: { characterId: true, amount: true, giftType: true, createdAt: true } }),
      tx.userMission.findMany({ where: { userId }, select: { missionId: true, isCompleted: true, completedAt: true, createdAt: true } }),
      tx.userCharacterQuest.findMany({ where: { userId }, select: { questId: true, completedAt: true } }),
      tx.aiCall.findMany({ where: { userId }, select: { id: true, conversationId: true, operation: true, status: true, model: true, attempts: true, inputTokens: true, outputTokens: true, estimatedCost: true, currency: true, startedAt: true, finishedAt: true } }),
      tx.aiDailyUsage.findMany({ where: { userId }, select: { day: true, count: true } }),
    ]);
    const adminIdentity = await readOwnAdminIdentity(tx, userId);
    return { version: 2, generatedAt: new Date().toISOString(), account, adminIdentity,
      conversations, characters, posts, postComments, comments, transactions, orders, uploads,
      reports, appeals, following, followers, memberships, circles, bookmarks, characterLikes, postLikes, commentLikes, checkins, gifts, missions, questProgress, aiCalls, aiDailyUsage };
  });
}
