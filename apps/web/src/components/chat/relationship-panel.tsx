'use client';

import Link from 'next/link';
import { Heart, Flame, CalendarDays, MessageSquare, Archive, Cpu, NotebookPen, Check, User } from 'lucide-react';
import { compactNumber } from '@web/lib/i18n';
import { useConversationPanel } from './use-conversation-panel';
import {relationshipMeter, type RelationshipMeter} from '@rumiai/contracts/conversations/relationship';

export function RelationshipPanel({
  conversationId,
  token,
  onArchived,
}: {
  conversationId: string;
  token: string;
  onArchived?: () => void;
}) {
  const { state, policy, history, models, modelLabels, modelQuotes, defaultModel, modelsLoaded, notes, setNotes, savedNotes, setSavedNotes, saving, notice, noticeError, error, retry, patch } = useConversationPanel(conversationId, token);

  if (!state) {
    return (
      <aside className="hidden w-80 min-w-80 border-l border-border bg-card desktop:block">
        <div className="flex h-40 items-center justify-center">
          {error ? <div className="p-4 text-sm"><p role="alert">{error}</p><button type="button" onClick={retry} className="mt-2 min-h-11 text-primary">重新加载</button></div> : <span role="status" aria-label="读取关系资料" className="h-5 w-5 animate-spin motion-reduce:animate-none rounded-full border-2 border-border border-t-primary" />}
        </div>
      </aside>
    );
  }

  const priceLabel = (key: string | null) => { const quote = key ? modelQuotes[key] : null; return !quote ? '费用读取中' : quote.pricing === 'NO_PRICE' ? '暂不可用（未定价）' : quote.pricing === 'CHARGED' ? '每条 ' + quote.coins + ' 币，免费额度优先' : '当前免费'; };
  const chooseModel = async (key: string | null) => {const actual = key ?? defaultModel; const quote = actual ? modelQuotes[actual] : null; if (!quote || quote.pricing === 'NO_PRICE') return; if (!window.confirm('切换为' + (actual ? modelLabels[actual] ?? actual : '默认模型') + '：' + priceLabel(actual) + '。下一次生成生效，确认切换？')) return; await patch({ai_model: key}, '模型已更新，下一次生成生效。'); };
  const romance = relationshipMeter(state.romance, policy?.romanceLevels ?? []);
  const intimacy = relationshipMeter(state.intimacy, policy?.intimacyLevels ?? []);
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
            barClass="bg-pink-500"
          />
          <Meter
            icon={<Flame className="h-3.5 w-3.5 text-brand" />}
            label={"亲密值"}
            raw={state.intimacy}
            tier={intimacy}
            barClass="bg-primary"
          />
        </div>

        {policy && <p className="text-xs leading-5 text-muted-foreground">{policy.romancePerReply || policy.intimacyPerReply ? '关系模式开启时，每次成功的新回复增加浪漫值 ' + policy.romancePerReply + '、亲密值 ' + policy.intimacyPerReply + '；重生成、取消和失败不增加。' : '当前未配置聊天成长；历史数值仍保留。'}</p>}
        {history.length > 0 && <details className="rounded-2xl border border-border p-3"><summary className="min-h-8 cursor-pointer text-sm">最近成长记录</summary><ul className="mt-2 space-y-2">{history.map(event => <li key={event.id} className="text-xs leading-5 text-muted-foreground"><time dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleString('zh-CN')}</time><p>成功的新回复 · 浪漫值 +{event.romanceDelta}，亲密值 +{event.intimacyDelta}</p></li>)}</ul></details>}

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
          disabled={saving}
          aria-pressed={state.relationshipMode}
          onClick={() => patch({ relationship_mode: !state.relationshipMode })}
          className="flex w-full items-center justify-between rounded-2xl border border-border bg-secondary/60 px-3 py-2.5 text-left hover:border-brand/40"
        >
          <span className="text-left"><span className="block text-sm text-foreground">关系模式</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">开启后，角色回复会参考当前关系状态与已配置等级。</span></span>
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
                label={"默认" + (defaultModel ? ` (${modelLabels[defaultModel]??defaultModel})` : '') + ' · ' + priceLabel(defaultModel)}
                selected={!state.aiModel}
                onClick={() => void chooseModel(null)}
                disabled={saving || !defaultModel || !modelQuotes[defaultModel] || modelQuotes[defaultModel].pricing === 'NO_PRICE'}
              />
              {models.map((m) => (
                <ModelOption
                  key={m}
                  label={(modelLabels[m]??m) + ' · ' + priceLabel(m)}
                  selected={state.aiModel === m}
                  onClick={() => void chooseModel(m)}
                  disabled={saving || !modelQuotes[m] || modelQuotes[m].pricing === 'NO_PRICE'}
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
            {"我的笔记"}</p><p className="mb-2 text-xs leading-5 text-muted-foreground">仅自己查看，不会自动作为AI记忆。</p>
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
          <p role={noticeError ? "alert" : "status"} className={`flex items-center justify-center gap-1 text-xs ${noticeError ? "text-destructive" : "text-primary"}`}>
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
  tier: RelationshipMeter;
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
        <span className="font-bold text-foreground">{raw.toLocaleString('zh-CN')}</span>
      </div>
      {tier.percent !== null && <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className={`h-full rounded-full ${barClass}`} style={{ width: `${tier.percent}%` }} />
      </div>}
      <p className="mt-1 text-[10px] text-muted-foreground">
        {tier.name ?? (tier.percent === null ? '等级尚未配置' : '尚未达到首个等级')}
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
  onClick, disabled,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      className={`min-h-11 focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50 flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-[11px] transition-colors ${
        selected ? 'bg-brand-strong/15 text-foreground' : 'text-muted-foreground hover:bg-secondary'
      }`}
    >
      <span className="whitespace-normal leading-5">{label}</span>
      {selected && <Check className="h-3 w-3 shrink-0 text-brand-strong" />}
    </button>
  );
}
