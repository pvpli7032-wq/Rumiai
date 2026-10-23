'use client';
import {useCallback, useEffect, useRef, useState} from 'react';
import {useRouter} from 'next/navigation';
import {useAuth} from '@web/lib/auth-context';
import {loginWithNext} from '@web/lib/next-path';
import {ArrowLeft, Loader2, Send, Square} from 'lucide-react';

type PublicTurn = {id: string; turnNo: number; status: string; stateStatus: string; inputMessageId: string | null; assistantMessageId: string | null; committedAt: string | null};
type PublicEvent = {id: string; type: string; chapterKey: string; payload: {summary: string}; createdAt: string};
type StoryRunView = {id: string; conversationId: string; template: {title: string; publicSummary: string}; chapter: {key: string; title: string}; status: string; revision: number; turns: PublicTurn[]; events: PublicEvent[]};
type ChatItem = {key: string; role: 'USER' | 'ASSISTANT' | 'EVENT'; text: string};
type ConversationMessage = {id: string; role: string; content: string};

export function StoryMode({runId}: {runId: string}) {
  const router = useRouter(); const {token, isLoading: authLoading} = useAuth();
  const [run, setRun] = useState<StoryRunView | null>(null); const [items, setItems] = useState<ChatItem[]>([]); const [localItems, setLocalItems] = useState<ChatItem[]>([]);
  const [input, setInput] = useState(''); const [loading, setLoading] = useState(true); const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState(''); const [fatal, setFatal] = useState(''); const [streamText, setStreamText] = useState(''); const [historyUnavailable, setHistoryUnavailable] = useState(false);
  const requestId = useRef<string | null>(null); const requestContent = useRef<string | null>(null); const controller = useRef<AbortController | null>(null); const scrollRef = useRef<HTMLDivElement>(null);
  const loadRun = useCallback(async () => {
    if (!token) return;
    const response = await fetch('/api/story-runs/' + encodeURIComponent(runId), {headers: {Authorization: 'Bearer ' + token}});
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) { router.push(loginWithNext()); return; }
    if (response.status === 404) { setFatal('故事不存在或你无权访问。'); setLoading(false); return; }
    if (!response.ok) { setFatal(typeof data.error === 'string' ? data.error : '无法读取故事，请稍后重试。'); setLoading(false); return; }
    const view: StoryRunView = data.run;
    const next: ChatItem[] = [];
    const turnRows = view.turns ?? [];
    for (const turn of turnRows) next.push({key: turn.id, role: 'EVENT', text: '第 ' + turn.turnNo + ' 回合 · ' + turn.status + (turn.stateStatus ? ' · 状态整理 ' + turn.stateStatus : '')});
    for (const event of view.events ?? []) next.push({key: event.id, role: 'EVENT', text: event.payload.summary});
    setRun(view); setItems(next); setHistoryUnavailable(false); setFatal(''); setLoading(false);
    const messagesTask = fetch('/api/conversations/' + encodeURIComponent(view.conversationId) + '/messages', {headers: {Authorization: 'Bearer ' + token}}).then(async response => {
      if (!response.ok) throw Error('conversation messages unavailable');
      return await response.json() as ConversationMessage[];
    });
    try {
      const messages = await messagesTask; const byId = new Map(messages.map(message => [message.id, message]));
      const transcript: ChatItem[] = [];
      for (const turn of turnRows) {
        const user = turn.inputMessageId ? byId.get(turn.inputMessageId) : undefined;
        const assistant = turn.assistantMessageId ? byId.get(turn.assistantMessageId) : undefined;
        if (user) transcript.push({key: user.id, role: 'USER', text: user.content});
        if (assistant) transcript.push({key: assistant.id, role: 'ASSISTANT', text: assistant.content});
      }
      const events = (view.events ?? []).map(event => ({key: event.id, role: 'EVENT' as const, text: event.payload.summary}));
      setItems([...transcript, ...events]);
    } catch { setHistoryUnavailable(true); }
  }, [token, runId, router]);
  useEffect(() => { if (authLoading) return; if (!token) {router.push(loginWithNext()); return;} void loadRun().catch(() => {setFatal('无法读取故事，请检查网络后重试。');setLoading(false);}); }, [authLoading, token, router, loadRun]);
  useEffect(() => { scrollRef.current?.scrollIntoView({behavior: 'smooth'}); }, [items, streamText]);
  useEffect(() => () => controller.current?.abort(), []);
  const cancel = () => { controller.current?.abort(); };
  async function send() {
    const content = input.trim(); if (!content || !run || sending) return;
    if (requestContent.current !== null && requestContent.current !== content) requestId.current = null;
    const id = requestId.current ?? crypto.randomUUID(); requestId.current = id; requestContent.current = content;
    const active = new AbortController(); controller.current = active; setSending(true); setNotice(''); setStreamText('');
    try {
      const response = await fetch('/api/story-runs/' + encodeURIComponent(runId) + '/turns', {method: 'POST', headers: {Authorization: 'Bearer ' + token, 'Content-Type': 'application/json'}, body: JSON.stringify({expectedRevision: run.revision, requestId: id, content}), signal: active.signal});
      if (!response.ok) { const data = await response.json().catch(() => ({})); setNotice(typeof data.error === 'string' ? data.error : '请求失败（' + response.status + '）。'); if (response.status === 409 || response.status === 422) requestId.current = id; else requestId.current = null; return; }
      if (!response.body) throw Error('响应流不可用。');
      setLocalItems(items => [...items, {key: id + ':user', role: 'USER', text: content}]); setInput(''); let generatedText = ''; let buffer = ''; const reader = response.body.getReader(); const decoder = new TextDecoder();
      while (true) {
        const {done, value} = await reader.read(); if (done) break; buffer += decoder.decode(value, {stream: true});
        const frames = buffer.split(/\r?\n\r?\n/); buffer = frames.pop() ?? '';
        for (const frame of frames) for (const line of frame.split(/\r?\n/)) {
          if (!line.startsWith('data:')) continue; const raw = line.slice(5).trim(); if (!raw) continue; if (raw === '[DONE]') continue;
          let event: Record<string, unknown>; try { event = JSON.parse(raw); } catch { continue; }
          if (event.type === 'delta' && typeof event.content === 'string') { generatedText += event.content; setStreamText(generatedText); }
          if (event.type === 'error') setNotice(typeof event.message === 'string' ? event.message : '故事回合失败。');
          if (event.type === 'committed') { requestId.current = null; }
          if (event.type === 'done') { if (generatedText) setLocalItems(items => [...items, {key: id + ':assistant', role: 'ASSISTANT', text: generatedText}]); await loadRun(); }
        }
      }
      if (active.signal.aborted) return;
      requestId.current = null;
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) setNotice(error instanceof Error ? error.message : '故事回合失败。');
    } finally { if (controller.current === active) controller.current = null; setSending(false); setStreamText(''); }
  }
  const back = () => router.push('/discover');
  if (loading) return <main className="min-h-screen flex items-center justify-center bg-zinc-950 text-zinc-200"><Loader2 className="h-6 w-6 animate-spin" /></main>;
  if (fatal) return <main className="min-h-screen bg-zinc-950 text-zinc-100 p-6"><p role="alert">{fatal}</p><button className="mt-4 inline-flex items-center gap-2" onClick={back}><ArrowLeft size={16} />返回</button></main>;
  return <main className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col">
    <header className="border-b border-zinc-800 px-4 py-3 flex items-center gap-3"><button aria-label="返回" onClick={back}><ArrowLeft size={18} /></button><div><h1 className="font-semibold">{run?.template.title}</h1><p className="text-sm text-zinc-400">{run?.chapter.title}</p></div></header>
    <div className="mx-auto w-full max-w-3xl flex-1 overflow-y-auto px-4 py-5 space-y-4">
      <p className="text-sm text-zinc-400">{run?.template.publicSummary}</p>
      {historyUnavailable && <p role="status" className="text-sm text-amber-300">历史正文暂时无法读取</p>}
      {[...items, ...localItems].map(item => <article key={item.key} className={'max-w-[85%] rounded-lg px-4 py-3 ' + (item.role === 'USER' ? 'ml-auto bg-indigo-600' : item.role === 'EVENT' ? 'mx-auto border border-zinc-700 text-zinc-300' : 'bg-zinc-800')}><p className="whitespace-pre-wrap">{item.text}</p></article>)}
      {streamText && <article className="max-w-[85%] rounded-lg bg-zinc-800 px-4 py-3 whitespace-pre-wrap">{streamText}</article>}
      <div ref={scrollRef} />
    </div>
    {notice && <p role="alert" className="mx-auto w-full max-w-3xl px-4 py-2 text-sm text-amber-300">{notice}</p>}
    <form className="mx-auto w-full max-w-3xl border-t border-zinc-800 p-4 flex gap-2" onSubmit={event => {event.preventDefault();void send();}}>
      <textarea aria-label="发送故事内容" value={input} onChange={event => setInput(event.target.value)} disabled={sending || run?.status !== 'ACTIVE'} rows={2} maxLength={5000} className="min-w-0 flex-1 resize-y rounded-md bg-zinc-900 border border-zinc-700 p-3 disabled:opacity-60" placeholder={run?.status === 'ACTIVE' ? '继续故事…' : '故事当前不可继续'} />
      {sending ? <button type="button" aria-label="取消回合" title="取消回合" onClick={cancel} className="shrink-0 p-3 rounded-md border border-zinc-700"><Square size={17} /></button> : <button type="submit" aria-label="发送" disabled={!input.trim() || run?.status !== 'ACTIVE'} className="shrink-0 p-3 rounded-md bg-indigo-600 disabled:opacity-50"><Send size={17} /></button>}
    </form>
  </main>;
}
