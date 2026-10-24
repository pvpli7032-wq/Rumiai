'use client';

import { Check, Coins, Sparkles, Users } from 'lucide-react';
import type { SceneConfig } from '@rumiai/contracts/stories/scene-config';
import { SceneHeader } from '@/components/stories/scene-header';
import { Section } from './character-detail-parts';
import type { DetailCharacter, GiftOption, Quest } from './use-character-detail';

export function AboutTab({
  character,
  scene,
  giftOptions,
  sendingGift,
  token,
  onSendGift,
  replyPlan,
}: {
  character: DetailCharacter;
  scene?: SceneConfig;
  giftOptions: GiftOption[];
  sendingGift: string | null;
  token: string | null;
  onSendGift: (gift: GiftOption) => void;
  /** 可用模型与费用（V3 表 15）；由详情弹窗注入，人设/开场之后、礼物之前。 */
  replyPlan?: React.ReactNode;
}) {
  return (
    <div className="space-y-4">
      {scene && <SceneHeader scene={scene} character={character} />}
      <div><h3 className="text-lg font-semibold">角色介绍</h3>{character.tagline && <p className="mt-2 text-sm leading-6 text-muted-foreground">{character.tagline}</p>}<span aria-hidden className="mt-3 block h-[3px] w-5 rounded-full bg-[var(--action)]"/></div>
      <h3 className="text-lg font-semibold">角色设定</h3>
      <Section title={"个性"}>{character.personality}</Section>
      {character.scenario && <Section title={"场景"}>{character.scenario}</Section>}
      {character.copyrightStatement && <Section title="版权声明">{character.copyrightStatement}</Section>}
      {character.background && <Section title={"故事"}>{character.background}</Section>}
      {character.greeting && <Section title={"开场白"}>{character.greeting}</Section>}
      {replyPlan}
      {giftOptions.length>0&&<section id="character-gifts" className="space-y-2"><h3 className="text-xs font-bold text-muted-foreground">赠送礼物</h3><div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{giftOptions.map(gift=><button key={gift.id} onClick={()=>{if(window.confirm(`确认赠送「${gift.name}」？将消耗 ${gift.coinPrice} 金币。`))onSendGift(gift);}} disabled={!token||!!sendingGift} className="flex min-h-14 items-center gap-2 rounded-xl border border-border bg-card px-3 text-left hover:border-primary/50 disabled:opacity-50"><span className="text-xl">{gift.emoji}</span><span className="min-w-0 flex-1"><span className="block truncate text-sm">{gift.name}</span><span className="text-xs text-[var(--action)]">{gift.coinPrice} 金币</span></span></button>)}</div>{!token&&<p className="text-xs text-muted-foreground">登录后可赠送礼物</p>}</section>}

      {character.emojis.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-bold text-muted-foreground">{"情绪"}</p>
          <div className="flex flex-wrap gap-2">
            {character.emojis.map((e) => (
              <div key={e.id} className="flex flex-col items-center gap-1">
                <img src={e.url} alt={e.emotion} className="h-14 w-14 rounded-xl object-cover" />
                <span className="text-[10px] text-muted-foreground">{e.emotion}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function QuestsTab({
  quests,
  claiming,
  onClaim,
}: {
  quests: Quest[];
  claiming: string | null;
  onClaim: (questId: string) => void;
}) {
  return (
    <div className="space-y-2">
      {quests.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {"该角色暂无任务"}</p>
      ) : (
        quests.map((q) => (
          <div
            key={q.id}
            className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3"
          >
            <span
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                q.isCompleted ? 'bg-emerald-500/15 text-emerald-400' : 'bg-brand-strong/15 text-brand-strong'
              }`}
            >
              {q.isCompleted ? <Check className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-foreground">{q.title}</p>
              {q.description && (
                <p className="truncate text-xs text-muted-foreground">{q.description}</p>
              )}
              <p className="mt-0.5 flex items-center gap-1 text-[11px] text-[var(--action)]">
                <Coins className="h-3 w-3" />
                {q.rewardCoins}
              </p>
              {!q.isCompleted&&<p className="mt-0.5 text-[11px] text-muted-foreground">消息进度 {q.progress}/{q.requiredMessages}</p>}
            </div>
            <button
              onClick={() => onClaim(q.id)}
              disabled={q.isCompleted || !q.isQualified || claiming === q.id}
              className="shrink-0 rounded-full bg-muted px-3 py-1.5 text-xs font-bold text-foreground hover:bg-muted disabled:opacity-40"
            >
              {q.isCompleted ? "已领取" : claiming === q.id ? '...' : q.isQualified?"领取奖励":'尚未达成'}
            </button>
          </div>
        ))
      )}
    </div>
  );
}

export function CastTab({ cast }: { cast: DetailCharacter['supportCast'] }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {cast.map((s) => (
        <div key={s.id} className="flex items-center gap-2 rounded-2xl border border-border bg-card p-2.5">
          {s.avatarUrl ? (
            <img src={s.avatarUrl} alt={s.name} className="h-10 w-10 rounded-full object-cover" />
          ) : (
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
              <Users className="h-4 w-4 text-muted-foreground" />
            </span>
          )}
          <div className="min-w-0">
            <p className="truncate text-sm text-foreground">{s.name}</p>
            {s.description && (
              <p className="truncate text-[11px] text-muted-foreground">{s.description}</p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
