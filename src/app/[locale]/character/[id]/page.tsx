import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import {
  SITE_URL,
  alternateLanguages,
  compactNumber,
  getDictionary,
  isLocale,
  type Locale,
} from '@/lib/i18n';
import { PublicHeader } from '@/components/public-header';

export const revalidate = 300;

/**
 * Public, indexable character page — the bulk of the live site's sitemap. Only
 * public characters are served here; a private one must not become crawlable.
 */
async function loadCharacter(id: string) {
  return db.character.findFirst({
    where: { id, isPublic: true, reviewStatus: 'APPROVED' },
    select: {
      id: true,
      name: true,
      tagline: true,
      greeting: true,
      personality: true,
      avatarUrl: true,
      chatCount: true,
      tags: true,
      creator: { select: { username: true, displayName: true } },
    },
  });
}

export async function generateMetadata({
  params: paramsPromise,
}: {
  params: Promise<{ locale: string; id: string }>;
}): Promise<Metadata> {
  const params = await paramsPromise;

  if (!isLocale(params.locale)) return {};
  const dict = getDictionary(params.locale);
  const character = await loadCharacter(params.id);
  if (!character) return { title: dict.notFound };

  const url = `${SITE_URL}/${params.locale}/character/${character.id}`;
  const title = `${character.name} | ${dict.characterTitleSuffix}`;
  const description = character.tagline || character.greeting || character.personality.slice(0, 160);

  return {
    title,
    description,
    alternates: { canonical: url, languages: alternateLanguages(`/character/${character.id}`) },
    openGraph: {
      title: `${character.name} | Khui AI`,
      description,
      url,
      type: 'website',
      // Absolute, not relative: a relative og:image resolves against whatever
      // origin served the page, which in development leaks localhost into the
      // social preview.
      ...(character.avatarUrl
        ? { images: [{ url: character.avatarUrl.startsWith('/') ? `${SITE_URL}${character.avatarUrl}` : character.avatarUrl }] }
        : {}),
    },
  };
}

export default async function CharacterPage({ params: paramsPromise }: { params: Promise<{ locale: string; id: string }> }) {
  const params = await paramsPromise;

  const locale = (isLocale(params.locale) ? params.locale : 'th') as Locale;
  const dict = getDictionary(locale);
  const character = await loadCharacter(params.id);
  if (!character) notFound();

  const tagRows = await db.tag.findMany({ select: { key: true, label: true } });
  const labelByKey = new Map(tagRows.map(t => [t.key, t.label]));
  const tagLabels = (character.tags ?? '')
    .split(',')
    .map(key => labelByKey.get(key.trim()) ?? key.trim())
    .filter(Boolean);

  const creatorName = character.creator?.displayName ?? character.creator?.username;
  const communityPosts = await db.post.findMany({
    where: { characterId: character.id, status: 'VISIBLE', circle: { status: 'ACTIVE' } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 10,
    select: { id: true, content: true, createdAt: true, circle: { select: { id: true, name: true } } },
  });

  return (
    <main className="flex min-h-[100svh] flex-col">
      <PublicHeader locale={locale} signInLabel={dict.signIn} />

      <article className="mx-auto w-full max-w-2xl px-6 py-10">
        <div className="flex flex-col items-center text-center">
          {character.avatarUrl ? (
            <img
              src={character.avatarUrl}
              alt={character.name}
              className="h-40 w-40 rounded-full object-cover shadow-xl"
            />
          ) : (
            <div className="h-40 w-40 rounded-full bg-gradient-to-br from-purple-500 to-pink-500" />
          )}

          <h1 className="mt-5 font-athiti text-2xl font-bold text-white">{character.name}</h1>
          {character.tagline && (
            <p className="mt-2 font-athiti text-zinc-400">&ldquo;{character.tagline}&rdquo;</p>
          )}

          {tagLabels.length > 0 && (
            <ul className="mt-4 flex flex-wrap justify-center gap-2">
              {tagLabels.map(label => (
                <li
                  key={label}
                  className="rounded-full bg-white/5 px-3 py-1 font-athiti text-xs text-zinc-300"
                >
                  {label}
                </li>
              ))}
            </ul>
          )}

          <p className="mt-4 font-barlow text-sm text-zinc-500">
            {compactNumber(character.chatCount)} {dict.chatsLabel}
            {creatorName ? ` · @${creatorName}` : ''}
          </p>

          <Link
            href={`/${locale}/auth`}
            className="mt-7 rounded-full bg-gradient-to-r from-purple-600 to-pink-600 px-10 py-3 font-athiti text-lg font-semibold text-white shadow-lg transition-transform hover:scale-105"
          >
            {dict.chatNow}
          </Link>
        </div>

        {character.greeting && (
          <blockquote className="mt-10 rounded-2xl border border-white/10 bg-zinc-900/60 p-5 font-athiti leading-relaxed text-zinc-300">
            {character.greeting}
          </blockquote>
        )}
        {communityPosts.length > 0 && <section className="mt-10">
          <h2 className="mb-3 font-athiti text-lg font-semibold text-white">社区相关帖子</h2>
          <ul className="space-y-3">{communityPosts.map(post => <li key={post.id} className="rounded-xl border border-white/10 bg-zinc-900/60 p-4">
            <p className="whitespace-pre-wrap break-words text-sm text-zinc-200">{post.content}</p>
            <Link href={`/circles/${post.circle.id}#post-${post.id}`} className="mt-2 inline-flex min-h-11 items-center text-sm text-orange-400">{post.circle.name} · 前往帖子</Link>
          </li>)}</ul>
        </section>}
      </article>
    </main>
  );
}
