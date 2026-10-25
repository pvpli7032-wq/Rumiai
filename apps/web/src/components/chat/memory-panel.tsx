'use client';

import Link from 'next/link';
import {MemorySummaryPanel} from './memory-summary-panel';
import type {MemoryPanelData} from '@rumiai/contracts/memory/panel';
import {useCallback, useEffect, useRef, useState} from 'react';
import {Brain, Check, ChevronDown, Pencil, Pin, PinOff, Trash2, X} from 'lucide-react';
import {api} from '@web/lib/api-client';
import {API} from '@rumiai/contracts/api-paths';
import {Badge, Button, Input, Skeleton} from '@rumiai/ui';

/**
 * 聊天页记忆面板（V3 §25 表 21）。
 *
 * 用户能做的四件事都必须有前台入口：
 * - 「待确认」事实是摘要任务从对话里推出来的，确认前不注入上下文；
 * - 已确认的事实可以编辑、固定或删除，删掉之后就不再影响角色。
 *
 * 编辑与固定都是低频操作，所以是行内输入加一个切换按钮：没有弹窗、没有拖拽、
 * 没有撤销栈。保存后重新拉列表，排序（固定在前）只有服务端一处实现。
 *
 * 记忆开关关闭时接口回 enabled=false，整个面板不渲染 —— 前端不读设置中心，
 * 也不写死一份开关兜底。
 */

interface MemoryFact {
  id: string;
  text: string;
  pinned: boolean;
  status: 'ACTIVE' | 'PENDING' | 'INVALID' | 'DELETED';
  createdAt: string;
  sourceMessageId?: string | null;
}

export function MemoryPanel({conversationId, token, defaultOpen = false, onSourceNavigate}: {conversationId: string; token: string; defaultOpen?: boolean; onSourceNavigate?: () => void}) {
  const [panelData,setPanelData]=useState<MemoryPanelData|null>(null);
  const controllerRef=useRef<AbortController|null>(null);
  const [facts, setFacts] = useState<MemoryFact[] | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [open, setOpen] = useState(defaultOpen);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [creating, setCreating] = useState(false);
  const [newFact, setNewFact] = useState('');
  const [notice, setNotice] = useState('');
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(true);
  const loadSequence = useRef(0);

  const load = useCallback(async () => {
    controllerRef.current?.abort();
    const controller=new AbortController();controllerRef.current=controller;
    const timeout=window.setTimeout(()=>controller.abort('timeout'),15000);
    const sequence = ++loadSequence.current;
    setLoading(true); setLoadError('');
    try {
      const data = await api.get<MemoryPanelData>(API.conversations.memory(conversationId), {token,signal:controller.signal});
      if (sequence !== loadSequence.current) return;
      setPanelData(data);setEnabled(data.enabled);
      setFacts(data.facts);
    } catch (cause) {
      if(sequence===loadSequence.current&&(controller.signal.reason==='timeout'||!controller.signal.aborted))setLoadError(controller.signal.reason==='timeout'?'记忆读取超时，请重新加载。':cause instanceof Error?cause.message:'记忆加载失败，请重试。');
    } finally {window.clearTimeout(timeout); if (sequence === loadSequence.current) setLoading(false); }
  }, [conversationId, token]);

  useEffect(() => { setFacts(null); setEnabled(false); setEditingId(null); setNotice(''); void load(); return () => {loadSequence.current++;controllerRef.current?.abort();}; }, [load]);


  async function addFact() {
    if (!newFact.trim() || busyId) return;
    setBusyId('new'); setNotice('');
    try {
      await api.post(API.conversations.memory(conversationId), {text: newFact.trim()}, {token});
      setCreating(false); setNewFact(''); await load(); setNotice('记忆已添加，后续会按记忆规则参考。');
    } catch (cause) {setNotice(cause instanceof Error ? cause.message : '添加失败，请重试。');}
    finally {setBusyId(null);}
  }

  async function act(fact: MemoryFact, action: 'confirm' | 'ignore' | 'delete') {
    setBusyId(fact.id);
    setNotice('');
    try {
      if (action === 'delete' && !window.confirm('删除这条确定记忆？后续回复将不再参考它。')) return;
      if (action === 'delete') await api.del(API.conversations.memoryFact(conversationId, fact.id), {token});
      else if (action === 'confirm') await api.post(API.conversations.memoryConfirm(conversationId, fact.id), undefined, {token});
      else await api.post(API.conversations.memoryIgnore(conversationId, fact.id), undefined, {token});
      if (action === 'confirm') setFacts(prev => (prev ?? []).map(item => item.id === fact.id ? {...item, status: 'ACTIVE'} : item));
      else setFacts(prev => (prev ?? []).filter(item => item.id !== fact.id));
      setNotice(action === 'confirm' ? '已确认，之后会作为确定记忆。' : action === 'ignore' ? '已忽略。' : '已删除。');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '操作失败，请重试。');
    } finally {
      setBusyId(null);
    }
  }

  /** 保存正文：校验（空/超长）由服务端负责，这里只把中文原因原样显示出来。 */
  async function saveText(fact: MemoryFact) {
    setBusyId(fact.id);
    setNotice('');
    try {
      await api.patch(API.conversations.memoryFact(conversationId, fact.id), {text: draft}, {token});
      setEditingId(null);
      await load();
      setNotice('已保存。');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '保存失败，请重试。');
    } finally {
      setBusyId(null);
    }
  }

  async function togglePin(fact: MemoryFact) {
    setBusyId(fact.id);
    setNotice('');
    try {
      await api.patch(API.conversations.memoryFact(conversationId, fact.id), {pinned: !fact.pinned}, {token});
      await load();
      setNotice(fact.pinned ? '已取消固定。' : '已固定，会优先被角色记住。');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '操作失败，请重试。');
    } finally {
      setBusyId(null);
    }
  }

  function startEdit(fact: MemoryFact) {
    setEditingId(fact.id);
    setDraft(fact.text);
    setNotice('');
  }

  if (loading && facts === null) return <p role="status" className="px-4 py-3 text-sm text-muted-foreground">正在读取记忆…</p>;
  if (loadError) return <div role="alert" className="space-y-2 p-4 text-sm"><p>{loadError}</p><button type="button" className="min-h-11 text-brand" onClick={() => void load()}>重新加载</button></div>;


  const list = facts ?? [];
  const pendingCount = list.filter(fact => fact.status === 'PENDING').length;

  return <div className="space-y-7 px-1">
    {!enabled&&<p role="status" className="border-l-2 border-brand pl-3 text-sm leading-6 text-muted-foreground">聊天记忆尚未开启。已有内容保留，暂不参与角色回复。</p>}
    {panelData&&<MemorySummaryPanel data={panelData} conversationId={conversationId} token={token} onChanged={load} onSourceNavigate={onSourceNavigate}/>}
    {notice&&<p role="status" className="text-sm text-brand">{notice}</p>}
    <section>
    {([{title:'确定记忆',description:'你确认过的偏好、约定与经历，角色按上下文预算参考。',facts:list.filter(f=>f.status==='ACTIVE')},{title:'待确认',description:'从对话中提取的候选内容；确认之前不会用于回复。',facts:list.filter(f=>f.status==='PENDING')}] as const).map(group=><section key={group.title} className="mt-5 space-y-2"><h3 className="text-lg font-medium">{group.title}<span className="ml-2 text-sm text-muted-foreground">{group.facts.length}</span></h3><p className="text-sm leading-6 text-muted-foreground">{group.description}</p>{!group.facts.length&&<p className="py-3 text-sm text-muted-foreground">暂无{group.title}。</p>}
              {group.facts.map(fact => (
            <div key={fact.id} className="flex flex-col gap-3 sm:flex-row sm:items-start border-b border-border py-4">
              <div className="min-w-0 flex-1">
                {editingId === fact.id ? (
                  <Input
                    autoFocus
                    value={draft}
                    maxLength={200}
                    disabled={!enabled || busyId === fact.id}
                    aria-label="编辑这条记忆"
                    onChange={event => setDraft(event.target.value)}
                    onKeyDown={event => {
                      if (event.key === 'Enter') { event.preventDefault(); void saveText(fact); }
                      if (event.key === 'Escape') { event.preventDefault(); setEditingId(null); }
                    }}
                  />
                ) : (
                  <p className="text-[15px] leading-7 text-foreground">
                    {fact.pinned && <Pin className="mr-1 inline h-3 w-3 text-amber-400" aria-hidden />}
                    {fact.text}
                  </p>
                )}
                <p className="mt-0.5 text-xs leading-[18px] text-muted-foreground">
                  {fact.status === 'PENDING' ? '待确认：确认后才会被角色记住' : '已记住'}
                  {fact.pinned ? ' · 已固定' : ''}
                </p>
                {fact.sourceMessageId && <Link href={'/chat?conversation=' + encodeURIComponent(conversationId) + '&message=' + encodeURIComponent(fact.sourceMessageId)} onClick={() => onSourceNavigate?.()} className="inline-flex min-h-11 items-center text-xs text-brand">查看来源</Link>}
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-1">
                {editingId === fact.id ? (
                  <>
                    <Button className="min-h-11" size="sm" variant="ghost" disabled={!enabled} loading={busyId === fact.id} onClick={() => void saveText(fact)}>
                      <Check className="h-3.5 w-3.5" />保存
                    </Button>
                    <Button className="min-h-11" size="sm" variant="ghost" disabled={!enabled || busyId === fact.id} onClick={() => setEditingId(null)}>
                      <X className="h-3.5 w-3.5" />取消
                    </Button>
                  </>
                ) : fact.status === 'PENDING' ? (
                  <>
                    <Button className="min-h-11" size="sm" variant="ghost" disabled={!enabled || !!busyId} loading={busyId === fact.id} onClick={() => void act(fact, 'confirm')}>
                      <Check className="h-3.5 w-3.5" />确认
                    </Button>
                    <Button className="min-h-11" size="sm" variant="ghost" disabled={!enabled || busyId === fact.id} onClick={() => void act(fact, 'ignore')}>
                      <X className="h-3.5 w-3.5" />忽略
                    </Button>
                  </>
                ) : (
                  <>
                    <Button className="min-h-11" size="sm" variant="ghost" disabled={!enabled || busyId === fact.id} onClick={() => startEdit(fact)} aria-label="编辑这条记忆">
                      <Pencil className="h-3.5 w-3.5" />编辑
                    </Button>
                    <Button className="min-h-11" size="sm" variant="ghost" disabled={!enabled || busyId === fact.id} onClick={() => void togglePin(fact)} aria-label={fact.pinned ? '取消固定' : '固定这条记忆'}>
                      {fact.pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                      {fact.pinned ? '取消固定' : '固定'}
                    </Button>
                    <Button className="min-h-11" size="sm" variant="ghost" disabled={!enabled || busyId === fact.id} onClick={() => void act(fact, 'delete')} aria-label="删除这条记忆">
                      <Trash2 className="h-3.5 w-3.5" />删除
                    </Button>
                  </>
                )}
              </div>
            </div>
          ))}

    </section>)}
              {creating ? <form className="space-y-3 rounded-2xl bg-secondary/40 p-3" onSubmit={event => {event.preventDefault(); void addFact();}}>
            <label className="block space-y-2 text-sm"><span>添加一条确定记忆</span><textarea rows={3} aria-label="新记忆内容" value={newFact} disabled={!enabled || busyId === 'new'} onChange={event => setNewFact(event.target.value)} className="web-control min-h-11 w-full rounded-xl border border-border bg-background px-3 py-2" /></label>
            <p className="text-xs leading-5 text-muted-foreground">只添加你确认准确、希望本次会话记住的信息。</p>
            <div className="flex gap-3"><button type="button" disabled={busyId === 'new'} className="min-h-11 flex-1 rounded-full border border-border text-sm" onClick={() => setCreating(false)}>取消</button><button type="submit" disabled={busyId === 'new' || !newFact.trim()} className="min-h-11 flex-1 rounded-full bg-brand text-sm text-brand-foreground disabled:opacity-40">{busyId === 'new' ? '保存中…' : '保存记忆'}</button></div>
          </form> : <button type="button" disabled={!enabled} className="flex min-h-[46px] w-full items-center justify-center rounded-full bg-brand px-4 text-[15px] text-brand-foreground disabled:opacity-40" onClick={() => {setCreating(true); setNotice('');}}>添加记忆</button>}


    </section>
  </div>;
}
