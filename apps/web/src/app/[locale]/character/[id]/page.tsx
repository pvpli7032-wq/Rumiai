import { permanentRedirect } from 'next/navigation';

type Query = Record<string, string | string[] | undefined>;

/** Keep shared/bookmarked old character URLs and the selected ID in the shared, anonymously readable detail flow. */
export default async function CharacterPage({ params, searchParams }: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Query>;
}) {
  const [{ id }, values] = await Promise.all([params, searchParams]);
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key, item);
  }
  query.set('character', id);
  permanentRedirect(`/discover?${query}`);
}
