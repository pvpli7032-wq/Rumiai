'use client';
import {ChatPanelSheet} from './chat-panel-sheet';
import {StoryStateRecovery,unfinishedStoryTurns} from '@/components/stories/story-state-recovery';
import {PlayModePicker} from '@/components/stories/play-mode-picker';
import {StorySceneSettingsPanel} from '@/components/stories/story-scene-settings';
import {useCallback, useEffect, useRef, useState} from 'react';
import {useRouter} from 'next/navigation';
import {useAuth} from '@web/lib/auth-context';
import {loginWithNext} from '@web/lib/next-path';
import {Loader2} from 'lucide-react';
import {DesignIcon} from '@/components/primitives/design-icon';
import {StoryTools} from '@/components/stories/story-tools';
import {Dialog} from '@rumiai/ui';
import {useAppBack} from '@/components/layout/navigation-history';

type PublicTurn = {id: string; turnNo: number; status: string; stateStatus: string; inputMessageId: string | null; assistantMessageId: string | null; committedAt: string | null};
type PublicEvent = {id: string; type: string; chapterKey: string; payload: {summary: string}; sourceMessageId?: string|null; createdAt: string};
type StoryRunView = {id: string;characterId:string; conversationId: string; template: {title: string; publicSummary: string}; chapter: {key: string; title: string}; status: string; revision: number; turns: PublicTurn[]; events: PublicEvent[]};
type ChatItem = {key: string; role: 'USER' | 'ASSISTANT' | 'EVENT'; text: string};
type ConversationMessage = {id: string; role: string; content: string};

export function StoryMode({runId}: {runId: string}) {
  const router = useRouter(); const {token, isLoading: authLoading} = useAuth();
  const [run, setRun] = useState<StoryRunView | null>(null); const [items, setItems] = useState<ChatItem[]>([]); const [localItems, setLocalItems] = useState<ChatItem[]>([]);
  const [settingsOpen,setSettingsOpen]=useState(false);
  const [menuOpen,setMenuOpen]=useState(false),[menuTab,setMenuTab]=useState<'chat'|'settings'>('chat');
  useEffect(()=>{setMenuOpen(false);setSettingsOpen(false);},[runId]);
  const [input, setInput] = useState(''); const [loading, setLoading] = useState(true); const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState(''); const [closeConfirmOpen, setCloseConfirmOpen] = useState(false); const [closing, setClosing] = useState(false); const [fatal, setFatal] = useState(''); const [streamText, setStreamText] = useState(''); const [historyUnavailable, setHistoryUnavailable] = useState(false);
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
      setLocalItems(previous => previous.filter(local => !transcript.some(saved => saved.role === local.role && saved.text === local.text)));
    } catch { setHistoryUnavailable(true); }
  }, [token, runId, router]);
  useEffect(() => { if (authLoading) return; if (!token) {router.push(loginWithNext()); return;} void loadRun().catch(() => {setFatal('无法读取故事，请检查网络后重试。');setLoading(false);}); }, [authLoading, token, router, loadRun]);
  useEffect(() => { scrollRef.current?.scrollIntoView({behavior: 'smooth'}); }, [items, streamText]);
  useEffect(() => () => controller.current?.abort(), []);
  const cancel = () => { requestId.current = null; requestContent.current = null; controller.current?.abort(); };
  async function send() {
    const content = input.trim(); if (!content || !run || sending) return;
    if (requestId.current && requestContent.current !== content) { setNotice('上一回合仍在确认中，请保留原内容重连或等待服务端结果。'); return; }
    const id = requestId.current ?? crypto.randomUUID(); requestId.current = id; requestContent.current = content;
    const active = new AbortController(); controller.current = active; setSending(true); setNotice(''); setStreamText('');
    try {
      const response = await fetch('/api/story-runs/' + encodeURIComponent(runId) + '/turns', {method: 'POST', headers: {Authorization: 'Bearer ' + token, 'Content-Type': 'application/json'}, body: JSON.stringify({expectedRevision: run.revision, requestId: id, content}), signal: active.signal});
      if (!response.ok) { const data = await response.json().catch(() => ({})); setInput(content); setNotice(typeof data.error === 'string' ? data.error : '请求失败（' + response.status + '）。'); if (data.code !== 'TURN_IN_PROGRESS') { requestId.current = null; requestContent.current = null; } return; }
      if (!response.body) throw Error('响应流不可用。');
      setLocalItems(items => [...items, {key: id + ':user', role: 'USER', text: content}]); setInput(''); let generatedText = ''; let buffer = ''; const reader = response.body.getReader(); const decoder = new TextDecoder();
      while (true) {
        const {done, value} = await reader.read(); if (done) break; buffer += decoder.decode(value, {stream: true});
        const frames = buffer.split(/\r?\n\r?\n/); buffer = frames.pop() ?? '';
        for (const frame of frames) for (const line of frame.split(/\r?\n/)) {
          if (!line.startsWith('data:')) continue; const raw = line.slice(5).trim(); if (!raw) continue; if (raw === '[DONE]') continue;
          let event: Record<string, unknown>; try { event = JSON.parse(raw); } catch { continue; }
          if (event.type === 'accepted') setNotice('');
          if (event.type === 'demo') setNotice('当前为演示回复。');
          if (event.type === 'cost' || event.type === 'costResult' || 'costResult' in event) setNotice('额度已按服务端结果更新。');
          if (event.type === 'delta' && typeof event.content === 'string') { generatedText += event.content; setStreamText(generatedText); }
          if (event.type === 'error') setNotice(typeof event.message === 'string' ? event.message : '故事回合失败。');
          if (event.type === 'committed') { requestId.current = null; }
          if (event.type === 'state_pending') setNotice('故事状态整理中，暂时不能结束章节。');
          if (event.type === 'done') { if (generatedText) setLocalItems(items => [...items, {key: id + ':assistant', role: 'ASSISTANT', text: generatedText}]); setStreamText(''); await loadRun(); }
        }
      }
      if (active.signal.aborted) return;
      if (requestId.current) { setInput(content); setNotice('连接已结束；已保留原内容和请求号，再次发送会向服务端查询这一次回合，不会新建扣费请求。'); await loadRun(); }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) { setInput(content); setNotice('连接异常；已保留原内容和请求号，再次发送会向服务端查询这一次回合。'); await loadRun().catch(() => {}); }
    } finally { if (controller.current === active) controller.current = null; setSending(false); setStreamText(''); }
  }
  async function closeChapter() {
    if (!run || closing) return;
    setClosing(true); setNotice('');
    try { const response = await fetch('/api/story-runs/' + encodeURIComponent(runId) + '/close-chapter', {method: 'POST', headers: {Authorization: 'Bearer ' + token, 'Content-Type': 'application/json'}, body: JSON.stringify({expectedRevision: run.revision})}); const data = await response.json().catch(() => ({})); if (!response.ok) { if (data.run) { setRun(data.run); await loadRun(); } setNotice(typeof data.error === 'string' ? data.error : '无法结束章节。'); return; } if (data.run) { setRun(data.run); } await loadRun(); } catch { setNotice('网络连接失败，请稍后重试。'); } finally { setClosing(false); }
  }
  async function resumeChapter() {
    if (!run || closing) return;
    setClosing(true); setNotice('');
    try { const response = await fetch('/api/story-runs/' + encodeURIComponent(runId) + '/resume', {method: 'POST', headers: {Authorization: 'Bearer ' + token, 'Content-Type': 'application/json'}, body: JSON.stringify({expectedRevision: run.revision})}); const data = await response.json().catch(() => ({})); if (!response.ok) { if (data.run) { setRun(data.run); await loadRun(); } setNotice(typeof data.error === 'string' ? data.error : '无法继续故事。'); return; } if (data.run) { setRun(data.run); } await loadRun(); } catch { setNotice('网络连接失败，请稍后重试。'); } finally { setClosing(false); }
  }
  const back = useAppBack('/chat');
  if (loading) return <main className="h-full min-h-0 flex items-center justify-center bg-background text-foreground"><Loader2 className="h-6 w-6 animate-spin" /></main>;
  if (fatal) return <main className="h-full min-h-0 bg-background text-foreground p-6"><p role="alert">{fatal}</p><button className="mt-4 inline-flex items-center gap-2" onClick={back}><DesignIcon name="ph:arrow-left" size={20} />返回</button></main>;
  return <main className="h-full min-h-0 bg-background text-foreground flex flex-col">
    <header className="flex min-h-16 shrink-0 items-center gap-2 border-b border-border bg-background px-3 py-2"><button type="button" aria-label="返回上一页" onClick={back} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full hover:bg-secondary"><DesignIcon name="ph:arrow-left" size={20} /></button><div className="min-w-0 flex-1"><h1 className="text-[15px] font-semibold">{run?.template.title}</h1><p className="text-sm text-muted-foreground">{run?.chapter.title}</p></div><button type="button" aria-label="更多对话操作" aria-expanded={menuOpen} onClick={()=>{setMenuTab('chat');setMenuOpen(true);}} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary"><DesignIcon name="ph:dots-three" size={24}/></button></header>
    {run&&token&&<StorySceneSettingsPanel run={run} token={token} open={settingsOpen} onClose={()=>setSettingsOpen(false)} onSaved={loadRun}/>}

    {run&&token&&<ChatPanelSheet placement="right" open={menuOpen} onClose={()=>setMenuOpen(false)} title="聊天与设置" size="half">
      <div role="tablist" aria-label="聊天菜单分类" className="mb-3 grid grid-cols-2 gap-1 rounded-full bg-secondary p-1">
        {(['chat','settings'] as const).map(tab=><button key={tab} type="button" role="tab" aria-selected={menuTab===tab} aria-controls={'story-menu-'+tab} onClick={()=>setMenuTab(tab)} className={'min-h-11 rounded-full text-[15px] '+(menuTab===tab?'bg-background text-foreground':'text-muted-foreground')}>{tab==='chat'?'聊天':'设置'}</button>)}
      </div>
      <div role="tabpanel" id="story-menu-chat" hidden={menuTab!=='chat'} className="space-y-4">
        <StoryStateRecovery key={run.id} run={run} token={token} disabled={sending||closing} onRefresh={loadRun}/>
        <div className="border-b border-border pb-3">{run.status==='ACTIVE'?<><button type="button" disabled={sending||closing||unfinishedStoryTurns(run.turns).length>0} onClick={()=>{setMenuOpen(false);setCloseConfirmOpen(true);}} className="min-h-12 w-full py-3 text-left text-[15px] disabled:opacity-40">结束本章</button>{unfinishedStoryTurns(run.turns).length>0&&<p className="text-[13px] leading-5 text-muted-foreground">请先完成上方状态整理，再结束章节。</p>}</>:<button type="button" disabled={closing} onClick={()=>{setMenuOpen(false);void resumeChapter();}} className="min-h-12 w-full py-3 text-left text-[15px] disabled:opacity-40">继续故事</button>}</div>
        <StoryTools run={run} embedded canSave={unfinishedStoryTurns(run.turns).length===0} onSuggestion={text=>{setInput(text);setMenuOpen(false);}} onNavigateToMessage={id=>{setMenuOpen(false);requestAnimationFrame(()=>document.getElementById('story-message-'+id)?.scrollIntoView({block:'center',behavior:'smooth'}));}}/>
      </div><div role="tabpanel" id="story-menu-settings" hidden={menuTab!=='settings'} className="divide-y divide-border"><button type="button" aria-label="场景设置" onClick={()=>{setMenuOpen(false);setSettingsOpen(true);}} className="min-h-16 w-full py-3 text-left"><span className="block text-[15px]">场景设置</span><span className="mt-1 block text-[13px] leading-5 text-muted-foreground">身份、章节目标、场景补充与叙事方式</span></button><details><summary className="min-h-14 cursor-pointer py-4 text-[15px]">切换玩法</summary><PlayModePicker characterId={run.characterId} token={token} currentMode="chapter"/></details></div>
    </ChatPanelSheet>}

    <div className="mx-auto w-full max-w-3xl min-h-0 flex-1 overflow-y-auto px-4 py-5 space-y-4">
      <p className="text-sm leading-6 text-muted-foreground">{run?.template.publicSummary}</p>
      {historyUnavailable && <p role="status" className="text-sm text-foreground">历史正文暂时无法读取</p>}
      {[...items, ...localItems].map(item => <article key={item.key} id={'story-message-'+item.key} className={'max-w-[85%] break-words rounded-[18px] px-4 py-3 text-[15px] leading-6 ' + (item.role === 'USER' ? 'ml-auto rounded-br-[6px] bg-secondary' : item.role === 'EVENT' ? 'mx-auto border border-border text-foreground' : 'rounded-bl-[6px] border border-border bg-card')}><p className="whitespace-pre-wrap">{item.text}</p></article>)}
      {streamText && <article className="max-w-[85%] whitespace-pre-wrap break-words rounded-[18px] rounded-bl-[6px] border border-border bg-card px-4 py-3">{streamText}</article>}
      <div ref={scrollRef} />
    </div>
    <Dialog open={closeConfirmOpen} onClose={() => setCloseConfirmOpen(false)} title="确认结束本章" description="章节结束后将等待服务端确认状态整理结果。" footer={<><button type="button" onClick={() => setCloseConfirmOpen(false)} className="min-h-11 rounded-full border border-border px-4">取消</button><button type="button" onClick={() => {setCloseConfirmOpen(false);void closeChapter();}} className="min-h-11 rounded-full bg-brand px-4 text-brand-foreground">确认结束</button></>}><p className="text-sm text-muted-foreground">确认结束当前章节？</p></Dialog>
    {notice && <p role="alert" className="mx-auto w-full max-w-3xl px-4 py-2 text-sm text-foreground shrink-0">{notice}</p>}
    <form className="mx-auto w-full max-w-3xl shrink-0 border-t border-border bg-background p-3 flex items-end gap-2" onSubmit={event => {event.preventDefault();void send();}}>
      <textarea aria-label="发送故事内容" value={input} onChange={event => setInput(event.target.value)} disabled={sending || run?.status !== 'ACTIVE'} rows={2} maxLength={5000} className="min-h-11 max-h-32 min-w-0 flex-1 resize-none rounded-[20px] border border-border bg-card px-4 py-2.5 disabled:opacity-60" placeholder={run?.status === 'ACTIVE' ? '继续故事…' : '故事当前不可继续'} />
      {sending ? <button type="button" aria-label="取消回合" title="取消回合" onClick={cancel} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border"><DesignIcon name="ph:stop-fill" size={20} /></button> : <button type="submit" aria-label="发送" disabled={!input.trim() || run?.status !== 'ACTIVE'} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand text-brand-foreground disabled:opacity-50"><DesignIcon name="ph:paper-plane-tilt-fill" size={20} /></button>}
    </form>
  </main>;
}
