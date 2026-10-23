import {Avatar, Badge, Card, CardContent} from '@rumiai/ui';
import type {SceneConfig} from '@rumiai/contracts/stories/scene-config';

export type SceneHeaderProps = {
  scene: SceneConfig;
  character: {id: string; name: string; tagline?: string | null; avatarUrl?: string | null};
};

export function SceneHeader({scene, character}: SceneHeaderProps) {
  return (
    <header className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Avatar src={character.avatarUrl} name={character.name} />
        <div className="min-w-0 flex-1">
          <p className="font-medium">{character.name}</p>
          {character.tagline && <p className="text-sm text-muted-foreground">{character.tagline}</p>}
        </div>
        {scene.estimatedMinutes != null && <Badge>约 {scene.estimatedMinutes} 分钟</Badge>}
      </div>
      <div>
        <h1 className="text-2xl font-semibold leading-snug">{scene.title}</h1>
        <p className="mt-2 leading-relaxed text-muted-foreground">{scene.hook}</p>
      </div>
      <Card>
        <CardContent className="grid gap-6 pt-5 sm:grid-cols-3">
          <section><h2 className="font-semibold">我是谁</h2><p className="mt-2 text-sm leading-relaxed text-muted-foreground">{scene.userIdentity}</p></section>
          <section><h2 className="font-semibold">发生什么</h2><p className="mt-2 text-sm leading-relaxed text-muted-foreground">{scene.conflict}</p></section>
          <section><h2 className="font-semibold">这次要做什么</h2><p className="mt-2 text-sm leading-relaxed text-muted-foreground">{scene.goal}</p></section>
        </CardContent>
      </Card>
      {Boolean(scene.publicOpenQuestions?.length) && (
        <section>
          <h2 className="font-semibold">待探索的问题</h2>
          <ul className="mt-2 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
            {scene.publicOpenQuestions?.map(question => <li key={question}>{question}</li>)}
          </ul>
        </section>
      )}
    </header>
  );
}
