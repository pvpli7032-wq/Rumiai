import {db} from '@rumiai/backend/infrastructure/database/client';

/**
 * 角色可读性：公开且已审核通过，或本人就是作者。
 *
 * 评论线与任务线此前各写一份逐字相同的检查，唯一的差别是抛哪个错误类
 * （CharacterCommentError / CharacterQuestError），所以这里把错误构造交给调用方。
 * 可见性规则（哪些角色能被谁读到）只有这一处实现，改口径不会漏改一半。
 */
export async function requireReadableCharacter(
  characterId: string,
  userId: string | undefined,
  errorOf: (message: string, status: number) => Error,
): Promise<void> {
  const character = await db.character.findUnique({
    where: {id: characterId},
    select: {id: true, isPublic: true, reviewStatus: true, creatorId: true},
  });
  if (!character) throw errorOf('Character not found', 404);
  if ((!character.isPublic || character.reviewStatus !== 'APPROVED') && character.creatorId !== userId) {
    throw errorOf('Private character access forbidden', 403);
  }
}
