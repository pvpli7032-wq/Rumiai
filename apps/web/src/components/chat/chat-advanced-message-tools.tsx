'use client';
import {useEffect, useState} from 'react';
import {createPortal} from 'react-dom';
import {BookOpen, GitBranch, Layers, MessageSquareText, PencilLine, Sparkles, EyeOff, Eye, Flag} from 'lucide-react';
import {api} from '@web/lib/api-client';
import {ChatPanelSheet} from './chat-panel-sheet';
import type {ChatMessage} from '@rumiai/contracts/api-types/conversations';
import type {ConversationToolSettings, MessageVersionView} from '@rumiai/contracts/conversations/context-tools';

type Mode = 'versions' | 'memory' | 'branch' | 'context' | 'feedback' | 'continue' | 'suggest' | null;
export function ChatAdvancedMessageTools({message, conversationId, token, generation, memoryEnabled, isLatest, disabled, onChanged, onBranch, onGenerate}: {
  message: ChatMessage; conversationId: string; token: string; generation?: ConversationToolSettings['generation']; memoryEnabled: boolean; isLatest: boolean; disabled: boolean;
  onChanged: () => Promise<unknown>; onBranch: (id: string) => void; onGenerate: (id: string, revision: {kind: 'CONTINUE' | 'SUGGEST'; instruction?: string}) => Promise<void>;
}) {
  const [mode, setMode] = useState<Mode>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [draft, setDraft] = useState(''), [versions, setVersions] = useState<MessageVersionView[]>([]), [selected, setSelected] = useState<string | null>(null);
  const base = '/api/conversations/' + encodeURIComponent(conversationId), messageBase = base + '/messages/' + encodeURIComponent(message.id);
  const row = 'flex min-h-12 w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-[15px] font-normal hover:bg-secondary focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40';
  const primary = 'min-h-12 w-full rounded-full bg-brand px-4 text-sm font-medium text-brand-foreground disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-ring';
  const reply = message.role === 'ASSISTANT';
  function open(next: Mode) {setError(''); setNotice(''); setDraft(next === 'memory' ? message.content : ''); setMode(next);}
  useEffect(() => {
    if (mode !== 'versions') return;
    const controller = new AbortController();
    setBusy(true); setVersions([]);
    void api.get<{items: MessageVersionView[]; selectedVersionId: string | null}>(messageBase + '/versions', {token, signal: controller.signal})
      .then(data => {setVersions(data.items); setSelected(data.selectedVersionId ?? data.items[0]?.id ?? null);})
      .catch(cause => {if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '版本读取失败。');})
      .finally(() => {if (!controller.signal.aborted) setBusy(false);});
    return () => controller.abort();
  }, [mode, messageBase, token]);
  async function run() {
    if (busy) return;
    setBusy(true); setError('');
    try {
      if (mode === 'versions') {
        if (!selected || selected === 'current') {setMode(null); return;}
        await api.patch(messageBase + '/selected-version', {versionId: selected}, {token});
        await onChanged(); setMode(null);
      } else if (mode === 'context') {
        await api.patch(messageBase + '/context', {included: message.contextIncluded === false}, {token});
        await onChanged(); setMode(null);
      } else if (mode === 'memory') {
        await api.post(base + '/memory', {text: draft, sourceMessageId: message.id}, {token});
        setNotice('已保存为确认记忆，下一轮将按记忆规则参考。');
      } else if (mode === 'branch') {
        const result = await api.post<{id: string}>(base + '/branches', {messageId: message.id}, {token});
        setMode(null); onBranch(result.id);
      } else if (mode === 'feedback') {
        const result = await api.post<{message: string}>(messageBase + '/feedback', {reason: 'REPETITIVE'}, {token});
        setNotice(result.message);
      } else if (mode === 'continue' || mode === 'suggest') {
        await onGenerate(message.id, {kind: mode === 'continue' ? 'CONTINUE' : 'SUGGEST', instruction: draft});
        setMode(null);
      }
    } catch (cause) {setError(cause instanceof Error ? cause.message : '操作失败，请重试。');}
    finally {setBusy(false);}
  }
  const title = mode === 'versions' ? '回复版本' : mode === 'memory' ? '记住这句' : mode === 'branch' ? '从这里新建分支' : mode === 'context' ? '调整上下文' : mode === 'feedback' ? '反馈重复内容' : mode === 'continue' ? '继续写这条回复' : '按建议改写';
  return <>
    {reply && <button type="button" data-close-message-menu className={row} disabled={disabled} onClick={() => open('versions')}><Layers size={18} />查看与切换版本</button>}
    {reply && isLatest && <button type="button" data-close-message-menu className={row} disabled={disabled || !generation?.available} onClick={() => open('continue')}><Sparkles size={18} />继续写</button>}
    {reply && isLatest && <button type="button" data-close-message-menu className={row} disabled={disabled || !generation?.available} onClick={() => open('suggest')}><PencilLine size={18} />按建议改写</button>}
    {reply && isLatest && generation?.reason && <p className="px-3 pb-2 text-xs leading-5 text-muted-foreground">{generation.reason}</p>}
    {memoryEnabled && message.content && <button type="button" data-close-message-menu className={row} disabled={disabled} onClick={() => open('memory')}><BookOpen size={18} />记住这句</button>}
    <button type="button" data-close-message-menu className={row} disabled={disabled} onClick={() => open('context')}>{message.contextIncluded === false ? <Eye size={18} /> : <EyeOff size={18} />}{message.contextIncluded === false ? '重新纳入上下文' : '后续不参考这条'}</button>
    <button type="button" data-close-message-menu className={row} disabled={disabled} onClick={() => open('branch')}><GitBranch size={18} />从这里新建分支</button>
    {reply && <button type="button" data-close-message-menu className={row} disabled={disabled} onClick={() => open('feedback')}><Flag size={18} />反馈内容重复</button>}
    {mode && createPortal(<ChatPanelSheet open onClose={() => {if (!busy) setMode(null);}} title={title}>
      <div className="space-y-5 text-sm leading-6">
        {mode === 'versions' && <>
          <p className="text-muted-foreground">选择的版本将进入后续对话。切换旧版本会删除这条之后的消息，并使相关记忆失效。</p>
          <div className="space-y-2">{versions.map((version, index) => <button type="button" key={version.id} aria-pressed={selected === version.id} onClick={() => setSelected(version.id)} className={'w-full rounded-2xl p-4 text-left focus-visible:outline-2 focus-visible:outline-ring ' + (selected === version.id ? 'bg-brand/10 ring-1 ring-brand/30' : 'bg-secondary/50')}>
            <span className="mb-2 block text-xs text-muted-foreground">版本 {index + 1} · {new Date(version.createdAt).toLocaleString('zh-CN')}{version.id === message.selectedVersionId ? ' · 当前' : ''}</span>
            <span className="block max-h-40 overflow-y-auto whitespace-pre-wrap font-normal">{version.content}</span>
          </button>)}</div>
        </>}
        {mode === 'memory' && <><p className="text-muted-foreground">请确认这句话准确。保存后会作为本会话的确定记忆，来源消息修改或删除后将失效。</p><textarea aria-label="要记住的内容" rows={4} value={draft} onChange={event => setDraft(event.target.value)} className="web-control w-full rounded-2xl p-3" /></>}
        {mode === 'branch' && <p className="text-muted-foreground">保留原会话，把此处之前的消息与有效来源记忆复制到新会话。分支之后各自发展，不复制旧费用或公开分享。</p>}
        {mode === 'context' && <p className="text-muted-foreground">{message.contextIncluded === false ? '重新纳入后，之后的回复可以参考这条消息；此前已失效的记忆不会自动恢复。' : '消息仍保留在历史中，但后续AI请求和摘要不再参考；相关派生记忆会失效。'}</p>}
        {mode === 'feedback' && <p className="text-muted-foreground">记录这条回复存在重复内容。不会自动调用模型；若选择重新生成，沿用当前生成费用。</p>}
        {(mode === 'continue' || mode === 'suggest') && <>
          <p className="text-muted-foreground">使用 {generation?.modelName}。{generation?.pricing === 'CHARGED' ? '每次生成 ' + generation.coins + ' 币，免费额度优先。' : '当前模型报价免费。'}沿用重新生成的计费与取消规则，旧版本会保留。</p>
          {mode === 'suggest' ? <textarea aria-label="改写方向" maxLength={generation?.maxInstructionChars} rows={4} value={draft} onChange={event => setDraft(event.target.value)} placeholder="例如：少一些旁白，语气更自然" className="web-control w-full rounded-2xl p-3" /> : <p>仅续写新的部分，不重复原文；生成完成后保存为新版本。</p>}
        </>}
        {error && <p role="alert" className="text-destructive">{error}</p>}
        {notice && <p role="status" className="text-brand">{notice}</p>}
        {!notice && <button type="button" className={primary} disabled={busy || (mode === 'memory' || mode === 'suggest') && !draft.trim() || mode === 'versions' && !selected} onClick={() => void run()}>{busy ? '正在处理…' : mode === 'versions' ? '应用所选版本' : mode === 'branch' ? '创建分支' : mode === 'memory' ? '确认并保存记忆' : mode === 'feedback' ? '提交反馈' : mode === 'context' ? '确认调整' : '确认生成'}</button>}
      </div>
    </ChatPanelSheet>, document.body)}
  </>;
}
