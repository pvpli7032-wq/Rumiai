import { db } from '@/lib/db';

export class DiscoveryReadError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = 'DiscoveryReadError';
  }
}

export async function readHoroscope(sign: string) {
  const normalized = sign.toLowerCase();
  const horoscope = await db.horoscope.findUnique({
    where: {sign: normalized},
    select: {sign: true, thaiName: true, title: true, description: true, luckyNumber: true, luckyColor: true, compatibility: true, advice: true},
  });
  if (horoscope) return horoscope;
  const validSigns = await db.horoscope.findMany({select: {sign: true}, orderBy: {sign: 'asc'}});
  throw new DiscoveryReadError(`Invalid zodiac sign: ${normalized}. Valid signs: ${validSigns.map(row => row.sign).join(', ')}`);
}

export async function listPublicUniverses() {
  return db.universe.findMany({
    where: {isPublic: true}, orderBy: {chatCount: 'desc'}, take: 50,
    select: {id: true, name: true, tagline: true, description: true, imageUrl: true, characterCount: true, chatCount: true, tags: true, createdAt: true},
  });
}

export async function readExploreCatalog(take = 60) {
  const [characters, total, tags, conversationCounts] = await Promise.all([
    db.character.findMany({
      where: {isPublic: true, reviewStatus: 'APPROVED'}, orderBy: {chatCount: 'desc'}, take,
      select: {id: true, name: true, tagline: true, avatarUrl: true, chatCount: true, tags: true},
    }),
    db.character.count({where: {isPublic: true, reviewStatus: 'APPROVED'}}),
    db.tag.findMany({select: {key: true, label: true}}),
    db.conversation.groupBy({by: ['characterId'], _count: {id: true}}),
  ]);
  const labelByKey = Object.fromEntries(tags.map(tag => [tag.key, tag.label]));
  const conversationsById = new Map(conversationCounts.map(row => [row.characterId, row._count.id]));
  return {
    total,
    labelByKey,
    characters: characters.map(character => ({...character, conversationCount: conversationsById.get(character.id) ?? 0})),
  };
}
