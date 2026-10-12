import type { Prisma } from '@prisma/client';

/** Clear the departing author's content without cascading away another user's replies. */
export async function eraseAccountCommunityContent(tx: Prisma.TransactionClient, userId: string) {
  const media = await tx.postMedia.findMany({ where: { post: { authorId: userId } }, select: { url: true } });
  const comments = await tx.postComment.findMany({ where: { authorId: userId, imageUrl: { not: null } }, select: { imageUrl: true } });
  await tx.postMedia.deleteMany({ where: { post: { authorId: userId } } });
  await tx.post.updateMany({ where: { authorId: userId }, data: { content: '', status: 'DELETED' } });
  await tx.postComment.updateMany({ where: { authorId: userId }, data: { content: '', imageUrl: null, status: 'DELETED' } });
  await tx.comment.updateMany({ where: { authorId: userId }, data: { body: '', hiddenAt: new Date() } });
  // Keep the circle usable for its other members; remove its creator's description.
  await tx.circle.updateMany({ where: { ownerId: userId }, data: { name: '已注销用户创建的圈子', description: '', tags: null } });
  const followed = await tx.follow.findMany({ where: { followerId: userId }, select: { followingId: true } });
  await tx.follow.deleteMany({ where: { OR: [{ followerId: userId }, { followingId: userId }] } });
  for (const row of followed) await tx.user.update({ where: { id: row.followingId }, data: { followerCount: await tx.follow.count({ where: { followingId: row.followingId } }) } });
  const likedCharacters = await tx.characterLike.findMany({ where: { userId }, select: { characterId: true } });
  await tx.characterLike.deleteMany({ where: { userId } });
  for (const row of likedCharacters) await tx.character.update({ where: { id: row.characterId }, data: { likeCount: await tx.characterLike.count({ where: { characterId: row.characterId } }) } });
  const likedComments = await tx.commentLike.findMany({ where: { userId }, select: { commentId: true } });
  await tx.commentLike.deleteMany({ where: { userId } });
  for (const row of likedComments) await tx.comment.update({ where: { id: row.commentId }, data: { likeCount: await tx.commentLike.count({ where: { commentId: row.commentId } }) } });
  await tx.characterBookmark.deleteMany({ where: { userId } });
  await tx.circleMember.deleteMany({ where: { userId } });
  await tx.postLike.deleteMany({ where: { userId } });
  return [...media.map(row => row.url), ...comments.map(row => row.imageUrl)];
}
