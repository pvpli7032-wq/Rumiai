import { permanentRedirect } from 'next/navigation';

type Query = Record<string, string | string[] | undefined>;

/** Old catalogue links retain their filters in the shared Discover directory. */
export default async function ExplorePage({ searchParams }: { searchParams: Promise<Query> }) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key, item);
  }
  query.set('view', 'characters');
  if (!query.has('q') && query.has('search')) query.set('q', query.get('search')!);
  const types = [...new Set([...query.getAll('type'), ...query.getAll('tag')]
    .flatMap(value => value.split(',')).map(value => value.trim()).filter(Boolean))];
  if (types.length) query.set('type', types.join(','));
  else query.delete('type');
  query.delete('search');
  query.delete('tag');
  permanentRedirect(`/discover?${query}`);
}
