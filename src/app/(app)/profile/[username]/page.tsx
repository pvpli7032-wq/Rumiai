import { zhText } from '@/lib/zh-text';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { compactNumber } from '@/lib/i18n';
import { CreatorCommunity } from '@/components/creator-community';

export const dynamic = 'force-dynamic';

/**
 * Handles are not all ASCII — seeded creators have Thai names in the column — and a
 * percent-encoded segment does not always reach the page decoded. Decoding here keeps
 * /profile/{handle} working for the same handles the API already resolves.
 */
function decodeHandle(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * A creator's public page. The chat panel's profile button links here
 * (/profile/{username}) and until now that URL did not exist, so the button 404'd.
 */
async function loadCreator(rawUsername: string) {
  const username = decodeHandle(rawUsername);
  const creator = await db.user.findUnique({
    where: { username },
    select: {
      id: true,
      username: true,
      displayName: true,
      avatarUrl: true,
      tier: true,
      followerCount: true,
      createdAt: true,
    },
  });
  if (!creator) return null;

  const characters = await db.character.findMany({
    where: { creatorId: creator.id, isPublic: true, reviewStatus: 'APPROVED' },
    orderBy: { chatCount: 'desc' },
    take: 60,
    select: {
      id: true,
      name: true,
      tagline: true,
      avatarUrl: true,
      chatCount: true,
      likeCount: true,
      isAdult: true,
    },
  });

  // The list is capped at 60, so its length is not the total.
  const totals = await db.character.aggregate({
    where: { creatorId: creator.id, isPublic: true, reviewStatus: 'APPROVED' },
    _count: { _all: true },
    _sum: { chatCount: true, likeCount: true },
  });

  const followerCount = await db.follow.count({ where: { followingId: creator.id } });
  return { creator: { ...creator, followerCount }, characters, totals };
}

export async function generateMetadata({ params: paramsPromise }: { params: Promise<{ username: string }> }): Promise<Metadata> {
  const params = await paramsPromise;

  const data = await loadCreator(params.username);
  if (!data) return { title: zhText("ไม่พบครีเอเตอร์ | Khui AI") };
  const name = data.creator.displayName ?? data.creator.username;
  return {
    title: `${name} (@${data.creator.username}) | Khui AI`,
    description: zhText("ตัวละครทั้งหมดของ") + (name) + zhText("บน Khui AI"),
  };
}

export default async function CreatorProfilePage({ params: paramsPromise }: { params: Promise<{ username: string }> }) {
  const params = await paramsPromise;

  const data = await loadCreator(params.username);
  if (!data) notFound();

  const { creator, characters, totals } = data;
  const name = creator.displayName ?? creator.username;

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8">
      <header className="flex items-center gap-4">
        {creator.avatarUrl ? (
          <img
            src={creator.avatarUrl}
            alt={name}
            className="h-20 w-20 rounded-full object-cover"
          />
        ) : (
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-purple-500 to-pink-500 text-2xl font-bold text-white">
            {name[0]?.toUpperCase()}
          </div>
        )}
        <div className="min-w-0">
          <h1 className="truncate font-athiti text-2xl font-bold text-white">{name}</h1>
          <p className="font-barlow text-sm text-zinc-400">@{creator.username}</p>
          <p className="mt-1 font-barlow text-xs text-zinc-500">
            {creator.tier} · {compactNumber(creator.followerCount)} {zhText("ผู้ติดตาม ·")}{' '}
            {compactNumber(totals._count._all)} {zhText("ตัวละคร ·")}{' '}
            {compactNumber(totals._sum.chatCount ?? 0)} {zhText("แชท")}</p>
        </div>
      </header>

      <CreatorCommunity username={creator.username} initialFollowerCount={creator.followerCount} />

      <h2 className="mb-4 mt-8 font-athiti text-lg font-semibold text-white">{zhText("ตัวละคร")}</h2>

      {characters.length === 0 ? (
        <p className="font-athiti text-zinc-500">{zhText("ครีเอเตอร์คนนี้ยังไม่มีตัวละครสาธารณะ")}</p>
      ) : (
        <ul className="grid grid-cols-2 gap-4 tablet:grid-cols-3 desktop:grid-cols-5">
          {characters.map(character => (
            <li key={character.id}>
              <Link
                href={`/chat?character=${character.id}`}
                className="group block overflow-hidden rounded-2xl border border-white/10 bg-zinc-900/60 transition-colors hover:border-white/25"
              >
                <div className="aspect-square w-full overflow-hidden bg-zinc-800">
                  {character.avatarUrl ? (
                    <img
                      src={character.avatarUrl}
                      alt={character.name}
                      loading="lazy"
                      className="h-full w-full object-cover transition-transform group-hover:scale-105"
                    />
                  ) : null}
                </div>
                <div className="p-3">
                  <p className="truncate font-athiti text-sm font-semibold text-white">{character.name}</p>
                  {character.tagline && (
                    <p className="mt-0.5 truncate font-athiti text-xs text-zinc-500">{character.tagline}</p>
                  )}
                  <div className="mt-2 flex items-center gap-3 font-barlow text-[11px] text-zinc-500">
                    <span title={zhText("ไลก์")}>{compactNumber(character.likeCount)}</span>
                    <span title={zhText("แชท")}>{compactNumber(character.chatCount)}</span>
                    {character.isAdult && <span className="text-amber-500/80">18+</span>}
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
