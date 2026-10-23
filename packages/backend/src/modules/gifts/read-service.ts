import { db } from '@rumiai/backend/infrastructure/database/client';

export async function listGiftLeaderboard(take = 10) {
  const gifts = await db.gift.groupBy({
    by: ['characterId'], _sum: {amount: true}, _count: {id: true},
    orderBy: {_sum: {amount: 'desc'}}, take,
  });
  const characters = await db.character.findMany({
    where: {id: {in: gifts.map(gift => gift.characterId)}},
    select: {id: true, name: true, avatarUrl: true},
  });
  return gifts.map((gift, index) => {
    const character = characters.find(item => item.id === gift.characterId);
    return {
      rank: index + 1,
      characterId: gift.characterId,
      name: character?.name || 'Unknown',
      avatarUrl: character?.avatarUrl || null,
      giftAmount: gift._sum.amount || 0,
      giftCount: gift._count.id,
    };
  });
}
