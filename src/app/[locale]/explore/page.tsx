import type { Metadata } from 'next';
import Link from 'next/link';
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

export async function generateMetadata({ params: paramsPromise }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const params = await paramsPromise;

  if (!isLocale(params.locale)) return {};
  const dict = getDictionary(params.locale);
  return {
    title: `${dict.charactersSection} | Khui AI`,
    description: dict.exploreSubhead,
    alternates: {
      canonical: `${SITE_URL}/${params.locale}/explore`,
      languages: alternateLanguages('/explore'),
    },
  };
}

const CARD_LIMIT = 60;

export default async function ExplorePage({ params: paramsPromise }: { params: Promise<{ locale: string }> }) {
  const params = await paramsPromise;

  const locale = (isLocale(params.locale) ? params.locale : 'th') as Locale;
  const dict = getDictionary(locale);

  const [characters, total, tagRows, conversationCounts] = await Promise.all([
    db.character.findMany({
      where: { isPublic: true, reviewStatus: 'APPROVED' },
      orderBy: { chatCount: 'desc' },
      take: CARD_LIMIT,
      select: { id: true, name: true, tagline: true, avatarUrl: true, chatCount: true, tags: true },
    }),
    db.character.count({ where: { isPublic: true, reviewStatus: 'APPROVED' } }),
    db.tag.findMany({ select: { key: true, label: true } }),
    db.conversation.groupBy({ by: ['characterId'], _count: { id: true } }),
  ]);

  // Tags are stored as a comma-separated list of keys; the cards show the Thai
  // labels, and the live site shows two per card.
  const labelByKey = new Map(tagRows.map(t => [t.key, t.label]));
  const conversationsById = new Map(conversationCounts.map(c => [c.characterId, c._count.id]));

  return (
    <main className="flex min-h-[100svh] flex-col">
      <PublicHeader locale={locale} signInLabel={dict.signIn} />

      <div className="px-4 pb-16 desktop:px-8">
        <section className="py-10 text-center">
          <h1 className="mx-auto max-w-2xl font-athiti text-2xl font-bold text-white desktop:text-4xl">
            {dict.exploreHeadline(compactNumber(total))}
          </h1>
          <p className="mx-auto mt-3 max-w-xl font-athiti text-zinc-400">{dict.exploreSubhead}</p>
          <Link
            href={`/${locale}/auth`}
            className="mt-6 inline-block rounded-full bg-linear-to-r/srgb from-purple-600 to-pink-600 px-8 py-3 font-athiti font-semibold text-white shadow-lg transition-transform hover:scale-105"
          >
            {dict.chatNow}
          </Link>
        </section>

        <h2 className="mb-4 font-athiti text-lg font-semibold text-white">{dict.charactersSection}</h2>

        <ul className="grid grid-cols-2 gap-4 tablet:grid-cols-3 desktop:grid-cols-5">
          {characters.map(character => {
            const tagLabels = (character.tags ?? '')
              .split(',')
              .map(key => labelByKey.get(key.trim()) ?? key.trim())
              .filter(Boolean)
              .slice(-2);

            return (
              <li key={character.id}>
                <Link
                  href={`/${locale}/character/${character.id}`}
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

                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {tagLabels.map(label => (
                        <span
                          key={label}
                          className="rounded-full bg-white/5 px-2 py-0.5 font-athiti text-[11px] text-zinc-400"
                        >
                          {label}
                        </span>
                      ))}
                    </div>

                    <div className="mt-2 flex gap-3 font-barlow text-[11px] text-zinc-500">
                      <span title={dict.conversationsLabel}>
                        {compactNumber(conversationsById.get(character.id) ?? 0)}
                      </span>
                      <span title={dict.chatsLabel}>{compactNumber(character.chatCount)}</span>
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </main>
  );
}
