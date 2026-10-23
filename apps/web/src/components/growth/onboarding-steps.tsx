'use client';

import {Check, Sparkles} from 'lucide-react';
import Link from 'next/link';
import {Avatar, Badge, EmptyState} from '@rumiai/ui';
import {cn} from '@rumiai/ui/cn';
import type {RecommendedCharacter} from './types';

const STEP_LABELS = ['选兴趣', '推荐角色', '开始聊天'] as const;

/** 三步进度条。当前步用 aria-current 标出，读屏也能听到「第 2 步」。 */
export function StepProgress({step}: {step: 1 | 2 | 3}) {
  return (
    <ol aria-label="引导进度" className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
      {STEP_LABELS.map((label, index) => {
        const value = index + 1;
        const done = value < step;
        const active = value === step;
        return (
          <li key={label} aria-current={active ? 'step' : undefined} className={cn('flex items-center gap-1.5', active && 'font-medium text-foreground')}>
            <span
              className={cn(
                'flex h-5 w-5 items-center justify-center rounded-full border text-[11px]',
                active && 'border-brand bg-brand text-brand-foreground',
                done && 'border-brand text-brand',
                !active && !done && 'border-border',
              )}
            >
              {done ? <Check aria-hidden className="h-3 w-3" /> : value}
            </span>
            {label}
          </li>
        );
      })}
    </ol>
  );
}

/** 第一步：兴趣标签多选。标签由后端下发，前端不写死词表。 */
export function InterestStep({
  tags,
  selected,
  onToggle,
}: {
  tags: string[];
  selected: string[];
  onToggle: (tag: string) => void;
}) {
  if (!tags.length) {
    return <EmptyState title="暂时没有可选兴趣" description="直接进入下一步，先看看推荐角色。" />;
  }
  return (
    <div role="group" aria-label="兴趣标签" className="flex flex-wrap gap-2">
      {tags.map(tag => {
        const active = selected.includes(tag);
        return (
          <button
            key={tag}
            type="button"
            aria-pressed={active}
            onClick={() => onToggle(tag)}
            className={cn(
              'min-h-11 rounded-full border px-4 text-sm transition-colors',
              active ? 'border-brand bg-brand-soft font-medium text-brand' : 'border-border text-foreground hover:bg-muted',
            )}
          >
            {tag}
          </button>
        );
      })}
    </div>
  );
}

/** 第二步：推荐角色卡片，单选。 */
export function RecommendedStep({
  characters,
  selectedId,
  onSelect,
}: {
  characters: RecommendedCharacter[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (!characters.length) {
    return (
      <EmptyState
        icon={<Sparkles aria-hidden className="h-6 w-6" />}
        title="暂时没有推荐角色"
        description="可以先去角色广场挑一个开始聊天。"
        action={
          <Link href="/discover" className="text-sm font-medium text-brand hover:underline">
            去看全部角色 →
          </Link>
        }
      />
    );
  }
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {characters.map(character => {
        const active = character.id === selectedId;
        return (
          <li key={character.id}>
            <button
              type="button"
              aria-pressed={active}
              onClick={() => onSelect(character.id)}
              className={cn(
                'flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors',
                active ? 'border-brand bg-brand-soft' : 'border-border hover:bg-muted',
              )}
            >
              <Avatar src={character.avatarUrl} name={character.name} alt="" size="md" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-foreground">{character.name}</span>
                {character.summary && (
                  <span className="mt-0.5 line-clamp-2 block text-xs leading-5 text-muted-foreground">{character.summary}</span>
                )}
              </span>
              {active && <Check aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-brand" />}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** 第三步：确认选中的角色与已选兴趣，按钮由外层给。 */
export function StartStep({character, interests}: {character: RecommendedCharacter | null; interests: string[]}) {
  return (
    <div className="space-y-4">
      {character ? (
        <div className="flex items-center gap-3 rounded-xl border border-border p-4">
          <Avatar src={character.avatarUrl} name={character.name} alt="" size="lg" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">{character.name}</p>
            <p className="mt-0.5 text-xs leading-5 text-muted-foreground">从和 {character.name} 说第一句话开始。</p>
          </div>
        </div>
      ) : (
        <p className="text-sm leading-6 text-muted-foreground">还没有选角色，可以直接去角色广场挑一个开始聊天。</p>
      )}
      {interests.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">已选兴趣</p>
          <div className="flex flex-wrap gap-1.5">
            {interests.map(tag => (
              <Badge key={tag} variant="brand">
                {tag}
              </Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
