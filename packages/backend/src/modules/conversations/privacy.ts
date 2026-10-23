import type { Prisma } from '@prisma/client';

/** Own history is erased; other readers' conversations with this author's roles survive. */
export async function eraseAccountConversations(tx: Prisma.TransactionClient, userId: string) {
  const images = await tx.message.findMany({ where: { conversation: { userId }, imageUrl: { not: null } }, select: { imageUrl: true } });
  await tx.conversation.deleteMany({ where: { userId } });
  return images.map(row => row.imageUrl);
}
