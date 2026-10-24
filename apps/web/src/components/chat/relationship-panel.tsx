'use client';

import Link from 'next/link';
import { Heart, Flame, CalendarDays, MessageSquare, Archive, Cpu, NotebookPen, Check, User } from 'lucide-react';
import { compactNumber } from '@web/lib/i18n';
import { useConversationPanel } from './use-conversation-panel';

/**
 * Relationship tiers. The live site shows "浪漫值 1100" with the bar around half
 * full, so the meter is not a percentage of 100 — it fills relative to the band the value
 * currently sits in. The real thresholds are a product decision we do not have yet, so
 * these are placeholders and the raw number is always shown next to the bar.
 */
const TIERS = [
  { name: "陌生人", from: 0 },
  { name: "相识", from: 500 },
  { name: "朋友", from: 1500 },
  { name: "亲密朋友", from: 3000 },
  { name: "伴侣", from: 6000 },
  { name: "爱人", from: 12000 },
];

function tierOf(value: number) {
  let index = 0;
  for (let i = 0; i < TIERS.length; i++) if (value >= TIERS[i].from) index = i;
  const current = TIERS[index];
  const next = TIERS[index + 1];
  const span = next ? next.from - current.from : Math.max(1, current.from);
  const filled = next ? (value - current.from) / span : 1;
  return { name: current.name, next: next?.name ?? null, percent: Math.min(100, Math.max(0, filled * 100)) };
}

export function RelationshipPanel({
  conversationId,
  token,
  onArchived,
}: {
  conversationId: string;
  token: string;
  onArchived?: () => void;
}) {
  const { state, models, modelLabels, defaultModel, modelsLoaded, notes, setNotes, savedNotes, setSavedNotes, saving, notice, patch } = useConversationPanel(conversationId, token);

  if (!state) {
    return (
      <aside className="hidden w-80 min-w-80 border-l border-border bg-card desktop:block">
        <div className="flex h-40 items-center justify-center">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-700 border-t-zinc-400" />
        </div>
      </aside>
    );
  }

  const romance = tierOf(state.romance);
  const intimacy = tierOf(state.intimacy);
  const archived = Boolean(state.archivedAt);

  return (
    <aside className="hidden w-80 min-w-80 overflow-y-auto border-l border-border bg-card desktop:block">
      <div className="space-y-5 p-4">
        {/* Who you are talking to */}
        {state.character && (
          <div className="flex flex-col items-center text-center">
            {state.character.avatarUrl ? (
              <img
                src={state.character.avatarUrl}
                alt={state.character.name}
                className="h-24 w-24 rounded-2xl object-cover"
              />
            ) : (
              <span className="flex h-24 w-24 items-center justify-center rounded-2xl bg-secondary">
                <User className="h-8 w-8 text-muted-foreground" />
              </span>
            )}
            <p className="mt-2 text-sm font-bold text-foreground">{state.character.name}</p>
            {state.character.tagline && (
              <p className="text-xs text-muted-foreground">{state.character.tagline}</p>
            )}
            <Link
              href={`/chat?character=${state.character.id}&new=1`}
              className="mt-2 rounded-full border border-border px-3 py-1 text-[11px] font-bold text-foreground hover:bg-secondary"
            >
              {"新建聊天"}</Link>
          </div>
        )}

        {/* Relationship meters */}
        <div className="space-y-3 rounded-2xl border border-border bg-secondary/60 p-3">
          {state.relationshipStatus && (
            <p className="text-xs text-muted-foreground">
              {"状态："}<span className="font-bold text-foreground">{state.relationshipStatus}</span>
            </p>
          )}
          <Meter
            icon={<Heart className="h-3.5 w-3.5 text-pink-400" />}
            label={"浪漫值"}
            raw={state.romance}
            tier={romance}
            barClass="bg-linear-to-r/srgb from-pink-500 to-rose-400"
          />
          <Meter
            icon={<Flame className="h-3.5 w-3.5 text-brand" />}
            label={"亲密值"}
            raw={state.intimacy}
            tier={intimacy}
            barClass="bg-linear-to-r/srgb from-orange-500 to-amber-400"
          />
        </div>

        {/* Chat facts */}
        <div className="grid grid-cols-2 gap-2">
          <Fact icon={<CalendarDays className="h-4 w-4" />} value={`${state.daysChatting}`} label={"聊天天数"} />
          <Fact
            icon={<MessageSquare className="h-4 w-4" />}
            value={compactNumber(state.messageCount)}
            label={"消息"}
          />
        </div>

        {/* Relationship mode */}
        <button
          onClick={() => patch({ relationship_mode: !state.relationshipMode })}
          className="flex w-full items-center justify-between rounded-2xl border border-border bg-secondary/60 px-3 py-2.5 text-left hover:border-brand/40"
        >
          <span className="text-xs text-foreground">{"关系模式"}</span>
          <span
            className={`flex h-5 w-9 items-center rounded-full px-0.5 transition-colors ${
              state.relationshipMode ? 'justify-end bg-brand-strong' : 'justify-start bg-zinc-600'
            }`}
          >
            <span className="h-4 w-4 rounded-full bg-white" />
          </span>
        </button>

        {/* Model picker */}
        {models.length > 0 && (
          <div className="rounded-2xl border border-border bg-secondary/60 p-3">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-bold text-muted-foreground">
              <Cpu className="h-3.5 w-3.5" />
              {"本次聊天使用的模型"}</p>
            <div className="space-y-1">
              {state.aiModel&&!models.includes(state.aiModel)&&<p className="mb-2 text-xs text-amber-400">原选择模型已不可用，请选择当前范围内模型或恢复默认。</p>}
              <ModelOption
                label={"默认" + (defaultModel ? ` (${modelLabels[defaultModel]??defaultModel})` : '')}
                selected={!state.aiModel}
                onClick={() => patch({ ai_model: null }, "恢复默认模型")}
              />
              {models.map((m) => (
                <ModelOption
                  key={m}
                  label={modelLabels[m]??m}
                  selected={state.aiModel === m}
                  onClick={() => patch({ ai_model: m }, "切换为 " + (m))}
                />
              ))}
            </div>
          </div>
        )}
        {modelsLoaded&&models.length===0&&<p className="rounded-xl border border-border p-3 text-xs text-amber-400">此角色当前没有可用模型，请联系管理员。</p>}

        {/* Notes */}
        <div className="rounded-2xl border border-border bg-secondary/60 p-3">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-bold text-muted-foreground">
            <NotebookPen className="h-3.5 w-3.5" />
            {"我的笔记"}</p>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={4}
            placeholder={"记录与这个角色的故事"}
            className="w-full resize-none rounded-xl border border-border bg-card px-2.5 py-2 text-xs text-foreground placeholder-zinc-600 focus:border-brand-strong/50 focus:outline-hidden"
          />
          <button
            onClick={async () => {
              const updated = await patch({ notes }, "已保存");
              if (updated) setSavedNotes(notes);
            }}
            disabled={saving || notes === savedNotes}
            className="mt-2 w-full rounded-full bg-zinc-700 py-1.5 text-xs font-bold text-foreground hover:bg-zinc-600 disabled:opacity-40"
          >
            {notes === savedNotes ? "已保存" : saving ? "正在保存…" : "保存"}
          </button>
        </div>

        <button
          onClick={async () => {
            const updated = await patch({ archived: !archived }, archived ? "取消归档" : "已归档聊天");
            if (updated && !archived) onArchived?.();
          }}
          className="flex w-full items-center justify-center gap-1.5 rounded-full border border-border py-2 text-xs font-bold text-foreground hover:bg-secondary"
        >
          <Archive className="h-3.5 w-3.5" />
          {archived ? "取消归档" : "归档聊天"}
        </button>

        {notice && (
          <p className="flex items-center justify-center gap-1 text-xs text-emerald-400">
            <Check className="h-3 w-3" />
            {notice}
          </p>
        )}
      </div>
    </aside>
  );
}

function Meter({
  icon,
  label,
  raw,
  tier,
  barClass,
}: {
  icon: React.ReactNode;
  label: string;
  raw: number;
  tier: { name: string; next: string | null; percent: number };
  barClass: string;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="flex items-center gap-1 text-muted-foreground">
          {icon}
          {label}
        </span>
        {/* The raw value, because the bar is relative to the current tier, not to 100. */}
        <span className="font-bold text-foreground">{raw.toLocaleString('th-TH')}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-700">
        <div className={`h-full rounded-full ${barClass}`} style={{ width: `${tier.percent}%` }} />
      </div>
      <p className="mt-1 text-[10px] text-muted-foreground">
        {tier.name}
        {tier.next ? ` → ${tier.next}` : ''}
      </p>
    </div>
  );
}

function Fact({ icon, value, label }: { icon: React.ReactNode; value: string; label: string }) {
  return (
    <div className="rounded-2xl border border-border bg-secondary/60 p-3 text-center">
      <span className="mx-auto mb-1 flex justify-center text-muted-foreground">{icon}</span>
      <p className="text-sm font-bold text-foreground">{value}</p>
      <p className="text-[10px] text-muted-foreground">{label}</p>
    </div>
  );
}

function ModelOption({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-[11px] transition-colors ${
        selected ? 'bg-brand-strong/15 text-foreground' : 'text-muted-foreground hover:bg-secondary'
      }`}
    >
      <span className="truncate">{label}</span>
      {selected && <Check className="h-3 w-3 shrink-0 text-brand-strong" />}
    </button>
  );
}
