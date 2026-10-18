import { db } from '@/lib/db';

const thaiMonths = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];

function weekLabel(now: Date) {
  const from = new Date(now.getTime() - 7 * 86_400_000);
  const buddhistYear = now.getFullYear() + 543;
  return from.getMonth() === now.getMonth()
    ? `${from.getDate()}-${now.getDate()} ${thaiMonths[now.getMonth()]} ${buddhistYear}`
    : `${from.getDate()} ${thaiMonths[from.getMonth()]} - ${now.getDate()} ${thaiMonths[now.getMonth()]} ${buddhistYear}`;
}

export async function readWeeklyRankings(now = new Date()) {
  const [characters, creatorGroups, giftGroups, newCreators] = await Promise.all([
    db.character.findMany({where: {isPublic: true, reviewStatus: 'APPROVED'}, orderBy: {chatCount: 'desc'}, take: 10, select: {id: true, name: true, avatarUrl: true, chatCount: true, createdAt: true}}),
    db.character.groupBy({by: ['creatorId'], where: {isPublic: true, reviewStatus: 'APPROVED', creatorId: {not: null}}, _sum: {chatCount: true}, _count: {id: true}, orderBy: {_sum: {chatCount: 'desc'}}, take: 10}),
    db.gift.groupBy({by: ['characterId'], _sum: {amount: true}, _count: {id: true}, orderBy: {_sum: {amount: 'desc'}}, take: 3}),
    db.user.findMany({where: {characters: {some: {}}}, orderBy: {createdAt: 'desc'}, take: 8, select: {id: true, username: true, avatarUrl: true}}),
  ]);

  const creatorIds = creatorGroups.map(group => group.creatorId!).filter(Boolean);
  const giftIds = giftGroups.map(group => group.characterId);
  const [creatorUsers, giftCharacters] = await Promise.all([
    db.user.findMany({where: {id: {in: creatorIds}}, select: {id: true, username: true, avatarUrl: true, tier: true}}),
    db.character.findMany({where: {id: {in: giftIds}}, select: {id: true, name: true, avatarUrl: true}}),
  ]);
  const weekAgo = now.getTime() - 7 * 86_400_000;

  return {
    weekLabel: weekLabel(now),
    characters: characters.map((character, index) => ({rank: index + 1, id: character.id, name: character.name, avatarUrl: character.avatarUrl, chatCount: character.chatCount, isNew: character.createdAt.getTime() >= weekAgo})),
    creators: creatorGroups.map((group, index) => {
      const user = creatorUsers.find(candidate => candidate.id === group.creatorId);
      return {rank: index + 1, id: group.creatorId, username: user?.username ?? 'unknown', avatarUrl: user?.avatarUrl ?? null, tier: user?.tier ?? 'ROOKIE', characterCount: group._count.id, totalChats: group._sum.chatCount ?? 0};
    }),
    topGifted: giftGroups.map((group, index) => {
      const character = giftCharacters.find(candidate => candidate.id === group.characterId);
      return {rank: index + 1, id: group.characterId, name: character?.name ?? 'Unknown', avatarUrl: character?.avatarUrl ?? null, giftCount: group._count.id, giftAmount: group._sum.amount ?? 0};
    }),
    newCreators,
  };
}
