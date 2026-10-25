import { permanentRedirect } from 'next/navigation';

type Query = Record<string, string | string[] | undefined>;

/** Compatibility entry: the former marketing page now opens the shared app. */
export default async function LocaleHome({ searchParams }: { searchParams: Promise<Query> }) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key, item);
  }
  permanentRedirect(`/discover${query.size ? `?${query}` : ''}`);
}
