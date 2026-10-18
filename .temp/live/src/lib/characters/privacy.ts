import type { Prisma } from '@prisma/client';

/** Keep identity rows for foreign histories, gifts and report references, erase authored text. */
export async function withdrawAccountCharacters(tx: Prisma.TransactionClient, userId: string) {
  const characters = await tx.character.findMany({ where: { creatorId: userId }, select: { avatarUrl: true, images: { select: { url: true } }, emojis: { select: { url: true } }, supportCast: { select: { avatarUrl: true } } } });
  const where = { character: { creatorId: userId } };
  await tx.characterImage.deleteMany({ where });
  await tx.characterEmoji.deleteMany({ where });
  await tx.supportCharacter.deleteMany({ where });
  await tx.characterQuest.updateMany({ where, data: { title: '已删除任务', description: null, isActive: false } });
  await tx.character.updateMany({ where: { creatorId: userId }, data: {
    name: '已删除角色', tagline: null, personality: '', background: '', greeting: null, avatarUrl: null,
    isPublic: false, publicationRequested: false, reviewStatus: 'DELETED', reviewReason: null,
    copyrightStatement: null, roleTemplate: null, scenario: null, tags: null, badges: null,
  } });
  return characters.flatMap(row => [row.avatarUrl, ...row.images.map(image => image.url), ...row.emojis.map(image => image.url), ...row.supportCast.map(member => member.avatarUrl)]);
}
