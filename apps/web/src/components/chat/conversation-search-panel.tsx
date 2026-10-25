'use client';
import {useEffect, useState} from 'react';
import Link from 'next/link';
import {api} from '@web/lib/api-client';
import {ChatPanelSheet} from './chat-panel-sheet';
type Hit = {id: string; conversationId: string; snippet: string; role: string; createdAt: string; conversation: {title: string | null}};
export function ConversationSearchPanel({open, onClose, token}: {open: boolean; onClose: () => void; token: string}) {
  const [query, setQuery] = useState(''), [items, setItems] = useState<Hit[]>([]), [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    setItems([]); setCursor(null); setError('');
    if (!open || !query.trim()) return;
    const controller = new AbortController();
    setLoading(true);
    const timer = window.setTimeout(() => {
      void api.get<{items: Hit[]; nextCursor: string | null}>('/api/conversations/search?q=' + encodeURIComponent(query.trim()), {token, signal: controller.signal})
        .then(data => {setItems(data.items); setCursor(data.nextCursor);})
        .catch(cause => {if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '搜索失败。');})
        .finally(() => {if (!controller.signal.aborted) setLoading(false);});
    }, 250);
    return () => {window.clearTimeout(timer); controller.abort();};
  }, [open, query, token]);
  async function more() {
    if (!cursor || loading) return;
    setLoading(true); setError('');
    try {const data = await api.get<{items: Hit[]; nextCursor: string | null}>('/api/conversations/search?q=' + encodeURIComponent(query.trim()) + '&cursor=' + encodeURIComponent(cursor), {token}); setItems(previous => {const ids = new Set(previous.map(row => row.id)); return [...previous, ...data.items.filter(row => !ids.has(row.id))];}); setCursor(data.nextCursor);}
    catch (cause) {setError(cause instanceof Error ? cause.message : '加载失败。');}
    finally {setLoading(false);}
  }
  return <ChatPanelSheet open={open} onClose={onClose} title="搜索聊天正文">
    <div className="space-y-4">
      <label className="block space-y-2 text-sm"><span>搜索本人的普通聊天记录</span><input type="search" aria-label="搜索聊天正文" value={query} onChange={event => setQuery(event.target.value)} className="web-control w-full rounded-full px-4 py-2" placeholder="想找哪句话？"/></label>
      {loading && <p role="status" className="text-sm text-muted-foreground">正在搜索…</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {!query.trim() && <p className="text-sm text-muted-foreground">输入关键词，点击结果可直接定位到那条消息。</p>}
      {!loading && query.trim() && !error && !items.length && <p className="text-sm text-muted-foreground">没有找到匹配消息，试试更短的关键词。</p>}
      <ul className="divide-y divide-border">{items.map(hit => <li key={hit.id}><Link href={'/chat?conversation=' + encodeURIComponent(hit.conversationId) + '&message=' + encodeURIComponent(hit.id)} onClick={onClose} className="block rounded-xl px-1 py-4 focus-visible:outline-2 focus-visible:outline-ring"><span className="block text-sm font-medium">{hit.conversation.title || '对话'}</span><span className="my-2 block text-[15px] font-normal leading-6">{hit.snippet}</span><span className="text-xs text-muted-foreground">{hit.role === 'USER' ? '我' : '角色'} · {new Date(hit.createdAt).toLocaleString('zh-CN')}</span></Link></li>)}</ul>
      {cursor && <button type="button" disabled={loading} onClick={() => void more()} className="min-h-11 w-full rounded-full border border-border text-sm disabled:opacity-40">加载更多结果</button>}
    </div>
  </ChatPanelSheet>;
}
