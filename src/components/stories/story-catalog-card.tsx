import Link from 'next/link';
import {Avatar, Card, CardContent, CardFooter, CardHeader} from '@/components/ui';

/**
 * One published story in the catalogue. Deliberately separate from StoryCard:
 * that one renders a hard-coded V0 scene config, while this only ever shows what
 * the public catalogue endpoint returned — no invented copy, no private fields.
 */
export type StoryCatalogEntry = {
  slug: string;
  title: string;
  characterName: string;
  characterTagline: string | null;
  characterAvatarUrl: string | null;
  publicSummary: string;
  chapters: {key: string; title: string}[];
};

export function StoryCatalogCard({story}: {story: StoryCatalogEntry}) {
  // The summary is a full paragraph; the card shows an excerpt and the entry page
  // shows all of it, so nothing is lost by trimming here.
  const excerpt = story.publicSummary.length > 96 ? story.publicSummary.slice(0, 96) + '…' : story.publicSummary;
  return (
    <Card className="flex h-full min-w-0 flex-col overflow-hidden">
      <CardHeader className="min-w-0">
        <h2 className="break-words text-lg font-semibold leading-snug">{story.title}</h2>
        <p className="break-words text-sm leading-relaxed text-muted-foreground">{excerpt}</p>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-1 items-center gap-3">
        <Avatar src={story.characterAvatarUrl} name={story.characterName} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="break-words text-sm font-medium">{story.characterName}</p>
          {story.characterTagline && <p className="break-words text-xs text-muted-foreground">{story.characterTagline}</p>}
        </div>
      </CardContent>
      <CardFooter>
        <Link href={'/stories/' + encodeURIComponent(story.slug)} className="rounded-md text-sm font-medium text-brand underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={'查看故事：' + story.title}>
          查看故事
        </Link>
      </CardFooter>
    </Card>
  );
}
