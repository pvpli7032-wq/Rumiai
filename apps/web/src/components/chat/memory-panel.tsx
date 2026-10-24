'use client';

import {useCallback, useEffect, useState} from 'react';
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
}

export function MemoryPanel({conversationId, token, defaultOpen = false}: {conversationId: string; token: string; defaultOpen?: boolean}) {
  const [facts, setFacts] = useState<MemoryFact[] | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [open, setOpen] = useState(defaultOpen);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    try {
      const data = await api.get<{enabled: boolean; facts: MemoryFact[]}>(API.conversations.memory(conversationId), {token});
      setEnabled(data.enabled);
      setFacts(data.facts);
    } catch {
      // 面板是可选信息：拿不到就整块不显示，不打断聊天。
      setEnabled(false);
      setFacts([]);
    }
  }, [conversationId, token]);

  useEffect(() => { void load(); }, [load]);

  async function act(fact: MemoryFact, action: 'confirm' | 'ignore' | 'delete') {
    setBusyId(fact.id);
    setNotice('');
    try {
      if (action === 'delete') await api.del(API.conversations.memoryFact(conversationId, fact.id), {token});
      else if (action === 'confirm') await api.post(API.conversations.memoryConfirm(conversationId, fact.id), undefined, {token});
      else await api.post(API.conversations.memoryIgnore(conversationId, fact.id), undefined, {token});
      setFacts(prev => (prev ?? []).filter(item => item.id !== fact.id));
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

  if (!enabled) return null;

  const list = facts ?? [];
  const pendingCount = list.filter(fact => fact.status === 'PENDING').length;

  return (
    <section className="mx-auto mt-3 max-w-3xl rounded-2xl border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen(prev => !prev)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm text-foreground hover:text-foreground"
      >
        <Brain className="h-4 w-4 text-muted-foreground" />
        <span className="font-medium">记忆</span>
        {pendingCount > 0 && <Badge variant="warning" size="sm">待确认 {pendingCount}</Badge>}
        <span className="ml-auto text-[11px] text-muted-foreground">{facts === null ? '加载中…' : `${list.length} 条`}</span>
        <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="space-y-2 border-t border-border px-4 py-3">
          {facts === null && <Skeleton className="h-12 w-full" />}
          {facts !== null && list.length === 0 && (
            <p className="text-xs text-muted-foreground">还没有记住什么。聊得多一些，角色会记住你在意的事。</p>
          )}
          {list.map(fact => (
            <div key={fact.id} className="flex items-start gap-2 rounded-xl border border-border bg-secondary/60 px-3 py-2">
              <div className="min-w-0 flex-1">
                {editingId === fact.id ? (
                  <Input
                    autoFocus
                    value={draft}
                    maxLength={200}
                    disabled={busyId === fact.id}
                    aria-label="编辑这条记忆"
                    onChange={event => setDraft(event.target.value)}
                    onKeyDown={event => {
                      if (event.key === 'Enter') { event.preventDefault(); void saveText(fact); }
                      if (event.key === 'Escape') { event.preventDefault(); setEditingId(null); }
                    }}
                  />
                ) : (
                  <p className="text-sm text-foreground">
                    {fact.pinned && <Pin className="mr-1 inline h-3 w-3 text-amber-400" aria-hidden />}
                    {fact.text}
                  </p>
                )}
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  {fact.status === 'PENDING' ? '待确认：确认后才会被角色记住' : '已记住'}
                  {fact.pinned ? ' · 已固定' : ''}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {editingId === fact.id ? (
                  <>
                    <Button size="sm" variant="ghost" loading={busyId === fact.id} onClick={() => void saveText(fact)}>
                      <Check className="h-3.5 w-3.5" />保存
                    </Button>
                    <Button size="sm" variant="ghost" disabled={busyId === fact.id} onClick={() => setEditingId(null)}>
                      <X className="h-3.5 w-3.5" />取消
                    </Button>
                  </>
                ) : fact.status === 'PENDING' ? (
                  <>
                    <Button size="sm" variant="ghost" loading={busyId === fact.id} onClick={() => void act(fact, 'confirm')}>
                      <Check className="h-3.5 w-3.5" />确认
                    </Button>
                    <Button size="sm" variant="ghost" disabled={busyId === fact.id} onClick={() => void act(fact, 'ignore')}>
                      <X className="h-3.5 w-3.5" />忽略
                    </Button>
                  </>
                ) : (
                  <>
                    <Button size="sm" variant="ghost" disabled={busyId === fact.id} onClick={() => startEdit(fact)} aria-label="编辑这条记忆">
                      <Pencil className="h-3.5 w-3.5" />编辑
                    </Button>
                    <Button size="sm" variant="ghost" disabled={busyId === fact.id} onClick={() => void togglePin(fact)} aria-label={fact.pinned ? '取消固定' : '固定这条记忆'}>
                      {fact.pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                      {fact.pinned ? '取消固定' : '固定'}
                    </Button>
                    <Button size="sm" variant="ghost" disabled={busyId === fact.id} onClick={() => void act(fact, 'delete')} aria-label="删除这条记忆">
                      <Trash2 className="h-3.5 w-3.5" />删除
                    </Button>
                  </>
                )}
              </div>
            </div>
          ))}
          {notice && <p className="text-[11px] text-muted-foreground">{notice}</p>}
        </div>
      )}
    </section>
  );
}
