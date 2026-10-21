'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { loginWithNext } from '@/lib/next-path';
import { Avatar, Badge, Button, Card, CardContent, CardHeader, EmptyState, ErrorState } from '@/components/ui';

type Story = { slug: string; title: string; locale: string; characterId: string; characterName: string; characterTagline: string | null; characterAvatarUrl: string | null; publicSummary: string; chapters: { key: string; title: string }[]; templateVersionId: string };
type Run = { id: string; status: string; templateVersionId?: string };

export function StoryEntryPage({ story }: { story: Story }) {
  const router = useRouter();
  const { user, token, isLoading: authLoading } = useAuth();
  const [runs, setRuns] = useState<Run[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);
  const [starting, setStarting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user || !token) return;
    let active = true;
    setRunsLoading(true);
    fetch('/api/story-runs?limit=100', { headers: { Authorization: 'Bearer ' + token } })
      .then(async response => response.ok ? response.json() : null)
      .then(data => { if (active) setRuns(Array.isArray(data?.items) ? data.items : []); })
      .catch(() => { if (active) setRuns([]); })
      .finally(() => { if (active) setRunsLoading(false); });
    return () => { active = false; };
  }, [user, token]);

  const activeRun = useMemo(() => runs.find(run => run.templateVersionId === story.templateVersionId && !['CLOSED', 'ENDED', 'COMPLETED'].includes(run.status)), [runs, story.templateVersionId]);
  const firstChapter = story.chapters[0];
  const summaryParagraphs = story.publicSummary.split(/\n\s*\n/).map(part => part.trim()).filter(Boolean);

  async function start(chapterKey: string) {
    if (!user) { router.push(loginWithNext()); return; }
    setError(null);
    setStarting(chapterKey);
    try {
      const response = await fetch('/api/story-runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (token ?? '') },
        body: JSON.stringify({ templateVersionId: story.templateVersionId, chapterKey, requestId: crypto.randomUUID() }),
      });
      const data = await response.json();
      if (!response.ok || typeof data?.run?.id !== 'string') throw new Error(data?.error || '暂时无法开始，请稍后重试。');
      router.push('/chat?storyRun=' + encodeURIComponent(data.run.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '暂时无法开始，请稍后重试。');
      setStarting(null);
    }
  }

  return (
    <main className="mx-auto w-full max-w-5xl min-w-0 px-4 py-8 sm:px-6 sm:py-12">
      <header className="min-w-0 max-w-3xl">
        <p className="text-sm font-medium text-brand">故事体验</p>
        <h1 className="mt-2 break-words text-3xl font-semibold leading-tight text-foreground sm:text-4xl">{story.title}</h1>
        <section aria-labelledby="story-conflict-title" className="mt-6 max-w-2xl">
          <h2 id="story-conflict-title" className="text-base font-semibold">这次会发生什么</h2>
          <div className="mt-3 space-y-4 text-base leading-8 text-muted-foreground">
            {summaryParagraphs.map((paragraph, index) => <p key={index} className="whitespace-pre-wrap break-words">{paragraph}</p>)}
          </div>
        </section>
      </header>

      <section aria-labelledby="story-character-title" className="mt-8">
        <Card className="min-w-0">
          <CardContent className="flex min-w-0 items-start gap-4 p-5 sm:p-6">
            <Avatar src={story.characterAvatarUrl} name={story.characterName} alt={story.characterName} size="lg" />
            <div className="min-w-0 flex-1">
              <h2 id="story-character-title" className="break-words text-lg font-semibold">{story.characterName}</h2>
              {story.characterTagline && <p className="mt-1 break-words text-sm leading-6 text-muted-foreground">{story.characterTagline}</p>}
            </div>
          </CardContent>
        </Card>
      </section>

      <section aria-labelledby="story-identity-title" className="mt-8 max-w-3xl">
        <h2 id="story-identity-title" className="text-lg font-semibold">你的身份</h2>
        <p className="mt-2 text-sm leading-7 text-muted-foreground">当前公开资料未提供你的具体身份，页面不会替你补充设定。</p>
      </section>

      <section aria-labelledby="story-chapters-title" className="mt-10">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div><h2 id="story-chapters-title" className="text-xl font-semibold">选择章节</h2><p className="mt-1 text-sm text-muted-foreground">可随时离开，之后再回到故事。</p></div>
          <Badge variant="neutral">{story.chapters.length} 个章节</Badge>
        </div>
        {!story.chapters.length ? <EmptyState className="mt-4" title="目前没有可开始的章节" description="请稍后再来看看。" /> : (
          <ol className="mt-4 grid min-w-0 gap-3">
            {story.chapters.map((chapter, index) => {
              const continueTo = chapter.key === firstChapter?.key ? activeRun : undefined;
              return <li key={chapter.key} className="min-w-0"><Card className="min-w-0"><CardHeader className="flex-row flex-wrap items-center gap-3 p-4 sm:p-5">
                <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold text-muted-foreground">{index + 1}</span>
                <div className="min-w-0 flex-1"><p className="text-xs text-muted-foreground">第 {index + 1} 章</p><h3 className="mt-1 break-words font-semibold">{chapter.title}</h3></div>
                {continueTo ? <Button className="w-full sm:w-auto" onClick={() => router.push('/chat?storyRun=' + encodeURIComponent(continueTo.id))}>继续故事</Button> : <Button className="w-full sm:w-auto" loading={starting === chapter.key} disabled={Boolean(starting) || authLoading || runsLoading} onClick={() => start(chapter.key)}>{starting === chapter.key ? '正在准备…' : '开始故事'}</Button>}
              </CardHeader></Card></li>;
            })}
          </ol>
        )}
        {error && <ErrorState className="mt-4" title="无法开始故事" description={error} action={<Button variant="outline" onClick={() => setError(null)}>知道了</Button>} />}
        {!authLoading && user && runsLoading && <p role="status" className="mt-3 text-sm text-muted-foreground">正在查看你的故事…</p>}
      </section>
    </main>
  );
}
