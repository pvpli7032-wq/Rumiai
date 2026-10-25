'use client';

import {Suspense, useEffect, useState} from 'react';
import {useSearchParams} from 'next/navigation';
import Link from 'next/link';
import {BackButton} from '@/components/layout/back-button';
import {useAuth} from '@web/lib/auth-context';
import {ReportDialog} from '@/components/moderation';
import {MessageActions} from './message-actions';
import {RoleplayText} from './roleplay-text';
import {ConversationTools} from './conversation-tools';
import {CHAT_STICKERS, type ChatMessage} from '@rumiai/contracts/api-types/conversations';

function HistoryView() {
  const id = useSearchParams().get('conversation');
  const {token, isLoading} = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [title, setTitle] = useState('对话历史');
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [report, setReport] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    setMessages([]); setTitle('对话历史'); setError(''); setReport(null); setCursor(null); setHasMore(false);
    if (!token || !id) { setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true);
    fetch('/api/conversations/' + encodeURIComponent(id), {signal: controller.signal, headers: {Authorization: 'Bearer ' + token}})
      .then(response => response.ok ? response.json() : null)
      .then(data => {if (!controller.signal.aborted && data?.conversation?.character?.name) setTitle(data.conversation.character.name);})
      .catch(() => {});
    fetch('/api/conversations/' + encodeURIComponent(id) + '/messages?limit=50', {signal: controller.signal, headers: {Authorization: 'Bearer ' + token}})
      .then(async response => {const data = await response.json(); if (!response.ok) throw Error(data.error || '加载历史失败。'); return data;})
      .then(data => {if (!controller.signal.aborted) {setMessages(data.messages); setCursor(data.nextCursor); setHasMore(data.hasMore);}})
      .catch(cause => {if (!controller.signal.aborted) setError(cause instanceof TypeError ? '网络连接失败，请重试。' : cause.message);})
      .finally(() => {if (!controller.signal.aborted) setLoading(false);});
    return () => controller.abort();
  }, [id, token, reload]);

  async function earlier() {
    if (!id || !token || !cursor || loading) return;
    setLoading(true); setError('');
    try {
      const response = await fetch('/api/conversations/' + encodeURIComponent(id) + '/messages?limit=50&before=' + encodeURIComponent(cursor), {headers: {Authorization: 'Bearer ' + token}});
      const data = await response.json();
      if (!response.ok) throw Error(data.error || '加载失败，请重试。');
      setMessages(previous => {const known = new Set(previous.map(message => message.id)); return [...data.messages.filter((message: ChatMessage) => !known.has(message.id)), ...previous];});
      setCursor(data.nextCursor); setHasMore(data.hasMore);
    } catch (cause) {setError(cause instanceof Error ? cause.message : '加载失败，请重试。');}
    finally {setLoading(false);}
  }

  return <main className="mx-auto max-w-3xl space-y-4 p-4">
    <BackButton fallback="/chat" />
    <h1 className="text-xl font-semibold">对话历史（只读）</h1>
    {!token && !isLoading ? <Link href="/login">请先登录</Link> : !id ? <p>请选择一段对话。</p> : <>
      <p className="break-words font-medium">{title}</p>
      {token && <ConversationTools conversationId={id} token={token} title={title} onDeleted={() => {setMessages([]); setError('这段对话已删除。');}} />}
      {error && <div role="alert" className="space-y-2"><p>{error}</p><button type="button" className="min-h-11 text-brand" onClick={() => messages.length && hasMore ? void earlier() : setReload(value => value + 1)}>重新加载</button></div>}
      {hasMore && <button type="button" disabled={loading} onClick={() => void earlier()} className="min-h-11 rounded-full border border-border px-4 text-sm disabled:opacity-50">加载更早的消息</button>}
      {loading && <p role="status">正在加载…</p>}
      {!loading && !error && !messages.length && <p>暂无消息。</p>}
      <ul className="space-y-4">{messages.map(message => <li key={message.id} className="space-y-2 break-words rounded-xl border border-border p-4">
        <p className="text-xs text-muted-foreground">{message.role === 'USER' ? '我' : message.role === 'ASSISTANT' ? 'AI 角色' : '系统'} · {message.createdAt && new Date(message.createdAt).toLocaleString('zh-CN')}</p>
        {message.attachments?.map(attachment => attachment.type === 'IMAGE' ? <img key={attachment.id} src={attachment.url} alt="发送的图片" className="max-h-72 max-w-full rounded-xl object-contain" /> : <span key={attachment.id} role="img" aria-label={CHAT_STICKERS.find(item => item.id === attachment.stickerId)?.label || '表情包'} className="block text-5xl">{CHAT_STICKERS.find(item => item.id === attachment.stickerId)?.glyph || '表情包'}</span>)}
        {message.role === 'USER' ? <p className="whitespace-pre-wrap">{message.content}</p> : <RoleplayText text={message.content} />}
        <MessageActions role={message.role} content={message.content} onReport={message.role === 'ASSISTANT' ? () => setReport(message.id) : undefined} />
      </li>)}</ul>
    </>}
    {report && <ReportDialog targetType="MESSAGE" targetId={report} targetName="这条 AI 回复" onClose={() => setReport(null)} />}
  </main>;
}

export function ChatHistoryPage() {return <Suspense fallback={<p className="p-4">正在加载…</p>}><HistoryView /></Suspense>;}
