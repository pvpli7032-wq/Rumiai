import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

async function check() {
  const chars = await db.character.findMany({ select: { id: true, name: true, avatarUrl: true } });
  const users = await db.user.findMany({ select: { id: true, username: true, avatarUrl: true } });
  const universes = await db.universe.findMany({ select: { id: true, name: true, imageUrl: true } });
  const banners = await db.banner.findMany({ select: { id: true, title: true, imageUrl: true } });

  console.log('Characters:', chars.length, '| Remote:', chars.filter(c => c.avatarUrl?.startsWith('http')).length, '| Local:', chars.filter(c => c.avatarUrl?.startsWith('/')).length);
  console.log('Users:', users.length, '| Remote:', users.filter(u => u.avatarUrl?.startsWith('http')).length, '| Local:', users.filter(u => u.avatarUrl?.startsWith('/')).length);
  console.log('Universes:', universes.length, '| Remote:', universes.filter(u => u.imageUrl?.startsWith('http')).length, '| Local:', universes.filter(u => u.imageUrl?.startsWith('/')).length);
  console.log('Banners:', banners.length, '| Remote:', banners.filter(b => b.imageUrl?.startsWith('http')).length, '| Local:', banners.filter(b => b.imageUrl?.startsWith('/')).length);
}

check()
  .catch(console.error)
  .finally(() => db.$disconnect());
