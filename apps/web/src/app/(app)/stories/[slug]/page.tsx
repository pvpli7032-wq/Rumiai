import { notFound } from 'next/navigation';
import { StoryEntryPage } from '@/components/stories/story-entry-page';
import { fetchPublicApi, PublicApiError } from '@/lib/server-api';
export const dynamic = 'force-dynamic';
import type {PublicStory} from '@rumiai/contracts/stories/public';

// Reads the published story in-process instead of calling our own HTTP route: the route
// would need an absolute base URL, which differs between the isolated test instance, dev
// and production. Same projection either way — the route and this page share one service.
export default async function StoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try { const payload = await fetchPublicApi<{story:PublicStory}>(`/api/stories/${encodeURIComponent(slug)}`); return <StoryEntryPage story={payload.story} />; }
  catch (error) { if (error instanceof PublicApiError && error.status === 404) notFound(); throw error; }
}
