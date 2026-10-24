'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { DesignIcon } from '@/components/primitives/design-icon';
import { CharacterAvatar } from './character-avatar';
import { useAuth } from '@web/lib/auth-context';
import { CHAT_LIST_CHANGED } from '@rumiai/contracts/conversations/chat-events';
import { ConversationTools } from '@/components/chat/conversation-tools';

type Conversation = { id: string; title: string; updatedAt?: string; character?: { id: string; name: string; avatarUrl?: string | null } | null };
type ConversationState = { active: Conversation[]; archived: Conversation[]; loading: boolean; error: boolean; refresh: () => void; token: string | null };
const Context = createContext<ConversationState | null>(null);

/** Shared source for the desktop sidebar and the chat inbox. */
export function ChatConversationProvider({ children }: { children: ReactNode }) {
  const { token, isLoading: authLoading } = useAuth();
  const [active, setActive] = useState<Conversation[]>([]);
  const [archived, setArchived] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision(value => value + 1), []);

  useEffect(() => { const onChanged = () => refresh(); window.addEventListener(CHAT_LIST_CHANGED, onChanged); return () => window.removeEventListener(CHAT_LIST_CHANGED, onChanged); }, [refresh]);
  useEffect(() => {
    if (authLoading) return;
    if (!token) { setActive([]); setArchived([]); setLoading(false); setError(false); return; }
    const controller = new AbortController();
    const read = async (archivedOnly: boolean) => {
      const response = await fetch(`/api/conversations${archivedOnly ? '?archived=true' : ''}`, { signal: controller.signal, headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error('conversation list unavailable');
      const body: unknown = await response.json();
      return Array.isArray(body) ? body as Conversation[] : [];
    };
    setLoading(true); setError(false);
    Promise.all([read(false), read(true)]).then(([nextActive, nextArchived]) => {
      if (!controller.signal.aborted) { setActive(nextActive); setArchived(nextArchived); }
    }).catch(() => { if (!controller.signal.aborted) setError(true); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [authLoading, token, revision]);

  const value = useMemo(() => ({ active, archived, loading, error, refresh, token }), [active, archived, loading, error, refresh, token]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useConversationState() { const value = useContext(Context); if (!value) throw new Error('ChatConversationList requires ChatConversationProvider.'); return value; }
function chatHref(row: Conversation) { return row.character?.id ? `/chat?character=${encodeURIComponent(row.character.id)}&conversation=${encodeURIComponent(row.id)}` : `/chat?conversation=${encodeURIComponent(row.id)}`; }

function Rows({ rows, compact, refresh }: { rows: Conversation[]; compact: boolean; refresh: () => void }) {
  const { token } = useConversationState();
  return <ul className={compact ? 'space-y-1' : 'divide-y divide-border'}>{rows.map(row => {
    const title = row.character?.name || row.title || '对话';
    const date = row.updatedAt ? new Date(row.updatedAt) : null;
    return <li key={row.id} className={compact ? '' : 'py-3'}><div className={`flex min-w-0 items-center ${compact ? 'gap-2 rounded-xl p-1.5 hover:bg-secondary' : 'gap-2'}`}>
      <Link href={chatHref(row)} className="flex min-h-12 min-w-0 flex-1 items-center gap-3 rounded-xl focus-visible:ring-2 focus-visible:ring-ring">
        <CharacterAvatar character={row.character || {id:row.id,name:title}} size={compact ? 40 : 48} />
        <span className="min-w-0 flex-1"><span className="flex min-w-0 items-center gap-2"><span className="truncate text-[15px] font-semibold">{title}</span>{!compact && row.character && <span className="shrink-0 text-[11px] text-muted-foreground">AI角色</span>}</span>{!compact && row.title && row.title !== title && <span className="mt-1 block truncate text-[13px] text-muted-foreground">{row.title}</span>}</span>
        {!compact && date && !Number.isNaN(date.getTime()) && <time dateTime={row.updatedAt} className="shrink-0 self-start pt-1 text-[11px] text-muted-foreground">{date.toLocaleDateString('zh-CN',{month:'numeric',day:'numeric'})}</time>}
      </Link>
      {!compact && token && <ConversationTools conversationId={row.id} token={token} title={title} historyHref={`/chat-history?conversation=${encodeURIComponent(row.id)}`} onDeleted={refresh} />}
    </div></li>;
  })}</ul>;
}

export function ChatConversationList({ variant, className = '' }: { variant: 'sidebar' | 'inbox'; className?: string }) {
  const { active, archived, loading, error, refresh, token } = useConversationState();
  const [showArchived, setShowArchived] = useState(false);
  const [query, setQuery] = useState('');
  const sidebar = variant === 'sidebar';
  const rows = (showArchived ? archived : active).filter(row => `${row.character?.name || ''} ${row.title || ''}`.toLowerCase().includes(query.toLowerCase()));
  const frequent = active.filter((row,index,all) => row.character?.id && all.findIndex(other => other.character?.id === row.character?.id) === index).slice(0,5);
  if (!token && !loading) return sidebar ? null : <section className={`mx-auto w-full max-w-3xl p-5 ${className}`}><div className="rounded-[20px] border border-border bg-card p-6"><p>登录后可以查看对话。</p><Link className="mt-3 inline-flex min-h-11 items-center text-brand" href="/login?next=/chat">登录</Link></div></section>;
  const tabs = <div className={`flex gap-6 ${sidebar ? 'border-b border-border px-3' : 'mb-3'}`}>{([['active',sidebar ? '我的对话' : '全部'],['archived','已归档']] as const).map(([key,label]) => <button key={key} type="button" aria-pressed={showArchived === (key === 'archived')} onClick={() => setShowArchived(key === 'archived')} className={`relative min-h-11 pb-2 text-[15px] ${showArchived === (key === 'archived') ? 'font-semibold text-foreground after:absolute after:bottom-0 after:left-0 after:h-[3px] after:w-5 after:rounded-full after:bg-action' : 'text-muted-foreground'}`}>{label}</button>)}</div>;
  return <section aria-label={sidebar ? '我的对话' : '聊天收件箱'} className={sidebar ? `flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-card ${className}` : `mx-auto w-full max-w-3xl px-4 pb-6 pt-2 ${className}`}>
    {tabs}
    <label className={`relative block ${sidebar ? 'm-2' : 'mb-5'}`}><DesignIcon name="ph:magnifying-glass" size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" /><input value={query} onChange={event => setQuery(event.target.value)} aria-label="搜索对话" placeholder="搜索角色或对话" className="web-control w-full rounded-full border border-border bg-card pl-10 pr-4 text-sm" /></label>
    {!sidebar && !showArchived && frequent.length > 0 && <section className="mb-6"><div className="mb-3 flex items-center justify-between"><h2 className="text-[18px] font-semibold">常聊的角色</h2><Link href="/discover" className="inline-flex min-h-11 items-center text-[13px] text-brand">发现更多 ↗</Link></div><div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1">{frequent.map(row => <Link key={row.id} href={chatHref(row)} className="relative h-[150px] w-[150px] shrink-0 snap-start overflow-hidden rounded-[20px] border border-border bg-secondary"><span className="absolute inset-0 flex items-center justify-center text-4xl font-semibold text-brand">{(row.character?.name || row.title).slice(0,1)}</span>{row.character?.avatarUrl && <img src={row.character.avatarUrl} alt="" className="absolute inset-0 h-full w-full object-cover" onError={event => {event.currentTarget.style.display='none';}} />}<span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-3 pb-3 pt-10 text-white"><span className="block truncate pr-6 text-sm font-semibold">{row.character?.name || row.title}</span><span className="mt-1 block text-[11px] text-white/90">AI角色</span></span><span className="absolute bottom-3 right-2 flex h-7 w-7 items-center justify-center rounded-full bg-card text-brand"><DesignIcon name="ph:chat-circle-text-fill" size={16} /></span></Link>)}</div></section>}
    {!sidebar && <div className="mb-1 flex items-center justify-between"><h2 className="text-[18px] font-semibold">{showArchived ? '已归档对话' : '最近对话'}</h2><span className="text-[11px] text-muted-foreground">按最近更新排序</span></div>}
    <div className={sidebar ? 'min-h-0 flex-1 overflow-y-auto px-2 pb-2' : ''}>{loading ? <p role="status" className="py-6 text-sm text-muted-foreground">正在加载对话…</p> : error ? <div className="my-3 rounded-2xl border border-border bg-card p-4"><p role="alert">加载失败，请重试。</p><button type="button" onClick={refresh} className="mt-2 min-h-11 text-brand">重新加载</button></div> : rows.length ? <Rows rows={rows} compact={sidebar} refresh={refresh} /> : <div className="py-8 text-center text-sm text-muted-foreground"><p>{query ? '没有符合搜索条件的对话。' : showArchived ? '暂无归档对话。' : '还没有对话，先认识一位角色吧。'}</p>{!showArchived && <Link href="/discover" className="mt-3 inline-flex min-h-11 items-center text-brand">发现角色</Link>}</div>}</div>
    {!sidebar && <Link href="/discover" className="relative mt-6 flex min-h-28 items-center overflow-hidden rounded-[20px] border border-border bg-card px-4 py-5"><img src="/illustrations/still-life-writing-table-v1.png" alt="" className="absolute inset-0 h-full w-full object-cover opacity-25" /><span className="absolute inset-0 bg-gradient-to-r from-background via-background/90 to-transparent" /><span className="relative"><span className="block text-[18px] font-semibold">去发现新的角色 ↗</span><span className="mt-2 block text-[13px] text-muted-foreground">遇见更多有趣的灵魂，开启新的故事。</span></span></Link>}
  </section>;
}
