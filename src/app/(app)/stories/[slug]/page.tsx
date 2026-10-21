import { notFound } from 'next/navigation';
import { StoryEntryPage } from '@/components/stories/story-entry-page';
import { readPublishedStory } from '@/lib/stories/catalog-service';
import { StoryError } from '@/lib/stories/repository/contracts';

// Reads the published story in-process instead of calling our own HTTP route: the route
// would need an absolute base URL, which differs between the isolated test instance, dev
// and production. Same projection either way — the route and this page share one service.
export default async function StoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    return <StoryEntryPage story={await readPublishedStory(slug)} />;
  } catch (error) {
    if (error instanceof StoryError && error.status === 404) notFound();
    throw error;
  }
}
