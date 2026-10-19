'use client';

import {Button, Card, CardContent, EmptyState} from '@/components/ui';
import type {ChapterCloseData} from '@/lib/stories/chapter-close';

export type ChapterCloseProps = {
  sceneTitle: string;
  data: ChapterCloseData;
  publicOpenQuestions?: readonly string[] | null;
  onContinue: () => void;
  onBackToChat: () => void;
};

export function ChapterClose({sceneTitle, data, publicOpenQuestions, onContinue, onBackToChat}: ChapterCloseProps) {
  return (
    <section className="space-y-6">
      <header><p className="text-sm text-muted-foreground">本次体验回看</p><h1 className="mt-1 text-2xl font-semibold">{sceneTitle}</h1></header>
      <section className="space-y-3">
        <h2 className="font-semibold">对话片段</h2>
        {data.excerpts.length ? data.excerpts.map(excerpt => {
          const date = new Date(excerpt.createdAt);
          const validDate = !Number.isNaN(date.getTime());
          const speaker = excerpt.role.toLowerCase() === 'user' ? '你' : excerpt.role.toLowerCase() === 'assistant' ? '角色' : '其他消息';
          return (
            <Card key={excerpt.id}>
              <CardContent className="pt-5">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>{speaker}</span>
                  {validDate && <time dateTime={date.toISOString()}>{new Intl.DateTimeFormat('zh-CN', {dateStyle: 'short', timeStyle: 'short'}).format(date)}</time>}
                </div>
                <blockquote className="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed">{excerpt.content}</blockquote>
              </CardContent>
            </Card>
          );
        }) : <EmptyState title="还没有可回看的片段" />}
      </section>
      {Boolean(publicOpenQuestions?.length) && (
        <section><h2 className="font-semibold">待探索的问题</h2><ul className="mt-2 list-disc space-y-2 pl-5 text-sm text-muted-foreground">{publicOpenQuestions?.map(question => <li key={question}>{question}</li>)}</ul></section>
      )}
      <div className="flex flex-wrap gap-3">
        <Button onClick={onContinue}>继续体验</Button>
        <Button variant="outline" onClick={onBackToChat}>回到聊天</Button>
      </div>
    </section>
  );
}
