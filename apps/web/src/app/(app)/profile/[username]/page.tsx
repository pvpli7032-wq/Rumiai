import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { compactNumber } from '@web/lib/i18n';
import { CreatorCommunity } from '@/components/creator-community';
import type {CreatorProfileProjection} from '@rumiai/contracts/public-api';
import {fetchPublicApi, PublicApiError} from '@/lib/server-api';

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
async function loadCreator(rawUsername: string) {try{return await fetchPublicApi<CreatorProfileProjection>(`/api/creators/${encodeURIComponent(decodeHandle(rawUsername))}`);}catch(error){if(error instanceof PublicApiError&&error.status===404)return null;throw error;}}

export async function generateMetadata({ params: paramsPromise }: { params: Promise<{ username: string }> }): Promise<Metadata> {
  const params = await paramsPromise;

  const data = await loadCreator(params.username);
  if (!data) return { title: "创作者不存在 | 星伴" };
  const name = data.creator.displayName ?? data.creator.username;
  return {
    title: `${name} (@${data.creator.username}) | 星伴`,
    description: "创作者的全部角色：" + (name) + " · 星伴",
  };
}

export default async function CreatorProfilePage({ params: paramsPromise }: { params: Promise<{ username: string }> }) {
  const params = await paramsPromise;

  const data = await loadCreator(params.username);
  if (!data) notFound();

  const { creator, characters } = data;
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
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-linear-to-br/srgb from-purple-500 to-pink-500 text-2xl font-bold text-white">
            {name[0]?.toUpperCase()}
          </div>
        )}
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-bold text-white">{name}</h1>
          <p className="text-sm text-zinc-400">@{creator.username}</p>
          <p className="mt-1 text-xs text-zinc-500">
            {creator.tier} · {compactNumber(creator.followerCount)} {"位关注者 ·"}{' '}
            {compactNumber(creator.publicCharacterCount)} {"个角色 ·"}{' '}
            {compactNumber(creator.chatCount)} {"聊天"}</p>
        </div>
      </header>

      <CreatorCommunity username={creator.username} initialFollowerCount={creator.followerCount} />

      <h2 className="mb-4 mt-8 text-lg font-semibold text-white">{"角色"}</h2>

      {characters.length === 0 ? (
        <p className="text-zinc-500">{"这位创作者还没有公开角色"}</p>
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
                  <p className="truncate text-sm font-semibold text-white">{character.name}</p>
                  {character.tagline && (
                    <p className="mt-0.5 truncate text-xs text-zinc-500">{character.tagline}</p>
                  )}
                  <div className="mt-2 flex items-center gap-3 text-[11px] text-zinc-500">
                    <span title={"点赞"}>{compactNumber(character.likeCount)}</span>
                    <span title={"聊天"}>{compactNumber(character.chatCount)}</span>
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
