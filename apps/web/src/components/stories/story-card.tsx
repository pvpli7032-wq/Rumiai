import Link from 'next/link';
import {Avatar, Badge, Card, CardContent, CardFooter, CardHeader} from '@rumiai/ui';
import type {SceneConfig} from '@rumiai/contracts/stories/scene-config';

export type StoryCardProps = {
  scene: SceneConfig;
  character: {id: string; name: string; tagline?: string | null; avatarUrl?: string | null};
  href: string;
};

export function StoryCard({scene, character, href}: StoryCardProps) {
  return (
    <Card className="flex h-full flex-col overflow-hidden">
      <div className="flex aspect-[16/9] items-center justify-center bg-muted text-muted-foreground">
        {scene.imageUrl ? (
          <img src={scene.imageUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <p className="px-6 text-center text-lg font-medium">{scene.title}</p>
        )}
      </div>
      <CardHeader>
        <h2 className="text-lg font-semibold leading-snug">{scene.title}</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">{scene.hook}</p>
      </CardHeader>
      <CardContent className="flex flex-1 items-center gap-3">
        <Avatar src={character.avatarUrl} name={character.name} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{character.name}</p>
          {character.tagline && <p className="text-xs text-muted-foreground">{character.tagline}</p>}
        </div>
        {scene.estimatedMinutes != null && <Badge>约 {scene.estimatedMinutes} 分钟</Badge>}
      </CardContent>
      <CardFooter>
        <Link href={href} className="rounded-md text-sm font-medium text-brand underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={'进入场景：' + scene.title}>
          查看场景
        </Link>
      </CardFooter>
    </Card>
  );
}
