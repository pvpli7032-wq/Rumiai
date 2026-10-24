import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {SITE_URL, alternateLanguages, compactNumber, getDictionary, isLocale, type Locale, DEFAULT_LOCALE} from '@web/lib/i18n';
import { PublicHeader } from '@/components/layout/public-header';
import { getSceneConfigByCharacterId } from '@rumiai/contracts/stories/scene-config';
import { resolveScene } from '@rumiai/contracts/stories/scene-service';
import { CharacterReplyPlan } from '@/components/characters/character-reply-plan';
import { CharacterVisual, resolveCharacterVisual } from '@/components/characters/character-visual';
import type {PublicCharacterProjection} from '@rumiai/contracts/public-api';
import {fetchPublicApi, PublicApiError} from '@/lib/server-api';
export const dynamic = 'force-dynamic';

export const revalidate = 300;

export async function generateMetadata({
  params: paramsPromise,
}: {
  params: Promise<{ locale: string; id: string }>;
}): Promise<Metadata> {
  const params = await paramsPromise;

  if (!isLocale(params.locale)) return {};
  const dict = getDictionary(params.locale);
  let projection: PublicCharacterProjection;
  try { projection = await fetchPublicApi<PublicCharacterProjection>(`/api/public-character/${encodeURIComponent(params.id)}`); } catch (error) { if (error instanceof PublicApiError && error.status === 404) return { title: dict.notFound }; throw error; }
  const character = projection.character;
  if (!character) return { title: dict.notFound };

  const url = `${SITE_URL}/${params.locale}/character/${character.id}`;
  const title = `${character.name} | ${dict.characterTitleSuffix}`;
  const description = character.tagline || character.greeting || character.personality.slice(0, 160);

  return {
    title,
    description,
    alternates: { canonical: url, languages: alternateLanguages(`/character/${character.id}`) },
    openGraph: {
      title: `${character.name} | 星伴`,
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

  const locale = (isLocale(params.locale) ? params.locale : DEFAULT_LOCALE) as Locale;
  const dict = getDictionary(locale);
  let projection: PublicCharacterProjection;
  try { projection = await fetchPublicApi<PublicCharacterProjection>(`/api/public-character/${encodeURIComponent(params.id)}`); } catch (error) { if (error instanceof PublicApiError && error.status === 404) notFound(); throw error; }
  const character = projection.character;
  if (!character) notFound();
  const {tagLabels, communityPosts} = projection;

  const creatorName = character.creator?.displayName ?? character.creator?.username;
  const sceneConfig = getSceneConfigByCharacterId(character.id);
  const sceneResolution = resolveScene(character, sceneConfig);
  const availableScene = sceneResolution.kind === 'available' ? sceneResolution.scene : undefined;

  return (
    <main className="flex min-h-[100svh] flex-col bg-background text-foreground">
      <PublicHeader locale={locale} signInLabel={dict.signIn} />

      <article className="mx-auto w-full max-w-2xl px-6 py-10">
        <div className="flex flex-col items-center text-center">
          {resolveCharacterVisual({ id: character.id, avatarUrl: character.avatarUrl }) ? (
            <span className="relative h-40 w-40 overflow-hidden rounded-full shadow-xl"><CharacterVisual id={character.id} avatarUrl={character.avatarUrl} alt={character.name} sizes="160px" className="h-full w-full object-cover" /></span>
          ) : <div className="h-40 w-40 rounded-full bg-linear-to-br/srgb from-purple-500 to-pink-500" />}

          <h1 className="mt-5 text-2xl font-bold text-foreground">{character.name}</h1>
          {character.tagline && (
            <p className="mt-2 text-muted-foreground">&ldquo;{character.tagline}&rdquo;</p>
          )}

          {availableScene && (
            <section className="mt-5 rounded-xl border border-border bg-white/5 p-4 text-left">
              <p className="text-sm text-muted-foreground">本角色有一个可体验的场景</p>
              <p className="mt-1 font-semibold text-foreground">{availableScene.title}</p>
              <Link href={'/chat?character=' + encodeURIComponent(character.id) + '&scene=1'} className="mt-3 inline-flex min-h-10 items-center text-sm font-semibold text-brand-strong underline-offset-4 hover:underline">查看场景</Link>
            </section>
          )}

          {tagLabels.length > 0 && (
            <ul className="mt-4 flex flex-wrap justify-center gap-2">
              {tagLabels.map(label => (
                <li
                  key={label}
                  className="rounded-full bg-white/5 px-3 py-1 text-xs text-muted-foreground"
                >
                  {label}
                </li>
              ))}
            </ul>
          )}

          <p className="mt-4 text-sm text-muted-foreground">
            {compactNumber(character.chatCount)} {dict.chatsLabel}
            {creatorName ? ` · @${creatorName}` : ''}
          </p>

          <Link
            href={`/${locale}/auth`}
            className="mt-7 rounded-full bg-linear-to-r/srgb from-purple-600 to-pink-600 px-10 py-3 text-lg font-semibold text-white shadow-lg transition-transform hover:scale-105"
          >
            {dict.chatNow}
          </Link>

          <div className="mt-5 w-full max-w-md">
            <CharacterReplyPlan characterId={character.id} />
          </div>
        </div>

        {character.greeting && (
          <blockquote className="mt-10 rounded-2xl border border-border bg-card p-5 leading-relaxed text-muted-foreground">
            {character.greeting}
          </blockquote>
        )}
        {communityPosts.length > 0 && <section className="mt-10">
          <h2 className="mb-3 text-lg font-semibold text-foreground">社区相关帖子</h2>
          <ul className="space-y-3">{communityPosts.map(post => <li key={post.id} className="rounded-xl border border-border bg-card p-4">
            <p className="whitespace-pre-wrap break-words text-sm text-foreground">{post.content}</p>
            <Link href={`/circles/${post.circle.id}#post-${post.id}`} className="mt-2 inline-flex min-h-11 items-center text-sm text-primary">{post.circle.name} · 前往帖子</Link>
          </li>)}</ul>
        </section>}
      </article>
    </main>
  );
}
