import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logRouteError } from '@/lib/logger';

/**
 * Reads live data, so it must not be statically prerendered — Next otherwise
 * freezes the build-time response and serves it forever.
 */
export const dynamic = 'force-dynamic';

const TH_MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];

/** "20-27 กรกฎาคม 2569" for the last seven days, in the Buddhist era. */
function weekLabel() {
  const to = new Date();
  const from = new Date(to.getTime() - 7 * 86_400_000);
  const be = to.getFullYear() + 543;
  return from.getMonth() === to.getMonth()
    ? `${from.getDate()}-${to.getDate()} ${TH_MONTHS[to.getMonth()]} ${be}`
    : `${from.getDate()} ${TH_MONTHS[from.getMonth()]} - ${to.getDate()} ${TH_MONTHS[to.getMonth()]} ${be}`;
}

/** Weekly leaderboards for the explore page's "จัดอันดับ" tab. */
export async function GET() {
  try {
    const [characters, creatorGroups, giftGroups, newCreators] = await Promise.all([
      db.character.findMany({
        where: { isPublic: true, reviewStatus: 'APPROVED' },
        orderBy: { chatCount: 'desc' },
        take: 10,
        select: { id: true, name: true, avatarUrl: true, chatCount: true, createdAt: true },
      }),
      db.character.groupBy({
        by: ['creatorId'],
        where: { isPublic: true, reviewStatus: 'APPROVED', creatorId: { not: null } },
        _sum: { chatCount: true },
        _count: { id: true },
        orderBy: { _sum: { chatCount: 'desc' } },
        take: 10,
      }),
      db.gift.groupBy({
        by: ['characterId'],
        _sum: { amount: true },
        _count: { id: true },
        orderBy: { _sum: { amount: 'desc' } },
        take: 3,
      }),
      db.user.findMany({
        where: { characters: { some: {} } },
        orderBy: { createdAt: 'desc' },
        take: 8,
        select: { id: true, username: true, avatarUrl: true },
      }),
    ]);

    const creatorIds = creatorGroups.map((g) => g.creatorId!).filter(Boolean);
    const giftIds = giftGroups.map((g) => g.characterId);
    const [creatorUsers, giftCharacters] = await Promise.all([
      db.user.findMany({
        where: { id: { in: creatorIds } },
        select: { id: true, username: true, avatarUrl: true, tier: true },
      }),
      db.character.findMany({
        where: { id: { in: giftIds } },
        select: { id: true, name: true, avatarUrl: true },
      }),
    ]);

    // A week old or newer earns the "ใหม่" tag on the character rail.
    const weekAgo = Date.now() - 7 * 86_400_000;

    return NextResponse.json({
      weekLabel: weekLabel(),
      characters: characters.map((c, i) => ({
        rank: i + 1,
        id: c.id,
        name: c.name,
        avatarUrl: c.avatarUrl,
        chatCount: c.chatCount,
        isNew: +c.createdAt >= weekAgo,
      })),
      creators: creatorGroups.map((g, i) => {
        const u = creatorUsers.find((x) => x.id === g.creatorId);
        return {
          rank: i + 1,
          id: g.creatorId,
          username: u?.username ?? 'unknown',
          avatarUrl: u?.avatarUrl ?? null,
          tier: u?.tier ?? 'ROOKIE',
          characterCount: g._count.id,
          totalChats: g._sum.chatCount ?? 0,
        };
      }),
      topGifted: giftGroups.map((g, i) => {
        const c = giftCharacters.find((x) => x.id === g.characterId);
        return {
          rank: i + 1,
          id: g.characterId,
          name: c?.name ?? 'Unknown',
          avatarUrl: c?.avatarUrl ?? null,
          giftCount: g._count.id,
          giftAmount: g._sum.amount ?? 0,
        };
      }),
      newCreators,
    });
  } catch (error) {
    logRouteError('GET /api/rankings', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
