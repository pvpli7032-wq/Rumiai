'use client';
import {useCallback, useEffect, useMemo, useState} from 'react';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {ChevronDown, ChevronUp} from 'lucide-react';
import {Badge, Button, Textarea} from '@/components/ui';
import {API} from '@/lib/api-paths';
import {useAuth} from '@/lib/auth-context';

type Conversation = {id: string; title: string | null; character?: {name: string} | null; updatedAt?: string};
type Candidate = {messageId: string; role: 'USER' | 'ASSISTANT'; content: string; createdAt: string};
type ExcerptOptions = {enabled: boolean; maxExcerptMessages: number; claimMaxChars: number; dailyLimit: number; minAccountAgeHours: number; maxVoteChanges: number; closeAfterHours: number; closeAtVotes: number; remaining: number | null; eligible: boolean | null};

type Selection = {conversationId: string; messageIds: string[]};

/**
 * 发起表单：选一段自己的聊天 → 勾选连续消息 → 写诉求 → 预览 → 提交。
 * 连续性在点击时就检查，服务端还会再校验一次。
 */
export function DisputeComposer({locale}: {locale: string}) {
  const {token, isLoading} = useAuth();
  const router = useRouter();
  const [options, setOptions] = useState<ExcerptOptions | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationId, setConversationId] = useState('');
  const [messages, setMessages] = useState<Candidate[]>([]);
  const [selection, setSelection] = useState<Selection>({conversationId: '', messageIds: []});
  const [claim, setClaim] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(false);

  useEffect(() => {
    if (isLoading) return;
    const controller = new AbortController();
    void fetch(`${API.disputes.create}/options`, {signal: controller.signal, headers: token ? {Authorization: `Bearer ${token}`} : {}}).then(r => r.ok ? r.json() : null).then(data => { if (data?.options) setOptions(data.options); }).catch(() => {});
    if (token) void fetch(API.conversations.list(), {signal: controller.signal, headers: {Authorization: `Bearer ${token}`}}).then(r => r.ok ? r.json() : []).then((rows: Conversation[]) => setConversations(Array.isArray(rows) ? rows.slice(0, 50) : [])).catch(() => {});
    return () => controller.abort();
  }, [isLoading, token]);

  const loadMessages = useCallback(async (id: string) => {
    if (!token || !id) return;
    setConversationId(id);
    setSelection({conversationId: id, messageIds: []});
    setMessages([]);
    setNotice('');
    try {
      const response = await fetch(`${API.disputes.create}/excerpt?conversationId=${encodeURIComponent(id)}`, {headers: {Authorization: `Bearer ${token}`}});
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '聊天消息加载失败。');
      setMessages(data.messages ?? []);
      if (data.claimMaxChars && options) setOptions(current => current ? {...current, claimMaxChars: data.claimMaxChars, maxExcerptMessages: data.maxExcerptMessages ?? current.maxExcerptMessages} : current);
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : '聊天消息加载失败。'); }
  }, [token, options]);

  const chosen = useMemo(() => messages.filter(message => selection.messageIds.includes(message.messageId)), [messages, selection.messageIds]);

  function toggle(message: Candidate) {
    if (!options) return;
    if (selection.conversationId !== conversationId) { setSelection({conversationId, messageIds: [message.messageId]}); return; }
    const ids = selection.messageIds;
    if (ids.includes(message.messageId)) { setSelection({conversationId, messageIds: ids.filter(id => id !== message.messageId)}); return; }
    const positions = [...ids.map(id => messages.findIndex(row => row.messageId === id)), messages.findIndex(row => row.messageId === message.messageId)].sort((a, b) => a - b);
    const contiguous = positions[positions.length - 1] - positions[0] === positions.length - 1;
    if (!contiguous) { setNotice('摘录必须是聊天里的连续消息。'); return; }
    if (ids.length >= options.maxExcerptMessages) { setNotice(`最多选择 ${options.maxExcerptMessages} 条连续消息。`); return; }
    setNotice('');
    setSelection({conversationId, messageIds: [...ids, message.messageId]});
  }

  async function submit() {
    if (!token || busy || !options) return;
    if (!chosen.length) { setNotice('请先选择摘录消息。'); return; }
    if (!claim.trim()) { setNotice('请填写你的诉求。'); return; }
    setBusy(true);
    setNotice('');
    try {
      const response = await fetch(API.disputes.create, {method: 'POST', headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'}, body: JSON.stringify({conversationId, messageIds: chosen.map(message => message.messageId), claim: claim.trim()})});
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '发起失败，请重试。');
      router.push(`/${locale}/disputes/${data.caseId}`);
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : '发起失败，请重试。'); setBusy(false); }
  }

  if (isLoading) return <p className="text-sm text-muted-foreground">正在加载…</p>;
  if (!token) return <p className="text-sm">登录后才能发起评理。<Link href={`/${locale}/auth`} className="ml-1 text-brand underline-offset-4 hover:underline">去登录</Link></p>;
  if (!options) return <p className="text-sm text-muted-foreground">正在读取规则…</p>;
  if (!options.enabled) return <p className="text-sm">评理广场暂停发起新案例，已有案例照常结束。</p>;
  if (options.eligible === false) return <p className="text-sm">注册满 {options.minAccountAgeHours} 小时后才能发起评理。</p>;
  if ((options.remaining ?? 0) <= 0) return <p className="text-sm">今天已发起 {options.dailyLimit} 个案例，请明天再来。</p>;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
        <Badge variant="outline">最多 {options.maxExcerptMessages} 条连续消息</Badge>
        <Badge variant="outline">诉求 {options.claimMaxChars} 字</Badge>
        <Badge variant="outline">今天还能发起 {options.remaining} 次</Badge>
        <Badge variant="outline">{options.closeAfterHours} 小时或 {options.closeAtVotes} 票先到先结</Badge>
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">1. 选择一段聊天</h2>
        <select value={conversationId} onChange={event => void loadMessages(event.target.value)} className="min-h-11 w-full rounded-lg border border-border bg-background px-3 text-sm">
          <option value="">选择聊天</option>
          {conversations.map(item => <option key={item.id} value={item.id}>{item.title || item.character?.name || '未命名聊天'}</option>)}
        </select>
      </section>

      {messages.length ? (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">2. 勾选连续的消息（已选 {chosen.length} 条）</h2>
          <ul className="max-h-80 space-y-1.5 overflow-y-auto rounded-lg border border-border p-2">
            {messages.map(message => {
              const picked = selection.messageIds.includes(message.messageId);
              return (
                <li key={message.messageId}>
                  <button type="button" onClick={() => toggle(message)} aria-pressed={picked}
                    className={`w-full rounded-lg border p-2 text-left text-sm ${picked ? 'border-brand bg-brand-soft' : 'border-transparent hover:bg-muted'}`}>
                    <span className="text-xs text-muted-foreground">{message.role === 'USER' ? '发起人' : '角色'}：</span>
                    <span className="whitespace-pre-wrap break-words">{message.content.slice(0, 160)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">3. 写下你的诉求</h2>
        <Textarea value={claim} maxLength={options.claimMaxChars} rows={4} invalid={claim.trim().length > options.claimMaxChars} onChange={event => setClaim(event.target.value)} placeholder="例如：我说想吃面，TA 坚持要煮饭，这样安排是不是太强势？" />
        <p className="text-xs text-muted-foreground">{claim.length}/{options.claimMaxChars}</p>
      </section>

      {chosen.length ? (
        <section className="space-y-2">
          <button type="button" className="flex items-center gap-1 text-sm font-semibold" onClick={() => setPreview(value => !value)}>
            4. 预览公开内容 {preview ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          {preview ? (
            <div className="space-y-2 rounded-lg border border-border p-3 text-sm">
              <p className="font-medium">诉求：{claim || '（还没写）'}</p>
              <ol className="space-y-1 text-muted-foreground">
                {chosen.map(message => <li key={message.messageId} className="break-words">· {message.role === 'USER' ? '发起人' : '角色'}：{message.content}</li>)}
              </ol>
              <p className="text-xs text-muted-foreground">公开后其他人能看到这段摘录与你的诉求，摘录在发起时固定。</p>
            </div>
          ) : null}
        </section>
      ) : null}

      {notice ? <p role="alert" className="break-words text-sm text-destructive">{notice}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button loading={busy} disabled={!chosen.length || !claim.trim()} onClick={() => void submit()}>公开发起评理</Button>
        <Link href={`/${locale}/disputes`}><Button variant="ghost">取消</Button></Link>
      </div>
    </div>
  );
}
