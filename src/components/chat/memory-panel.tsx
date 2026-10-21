'use client';

import {useCallback, useEffect, useState} from 'react';
import {Brain, Check, ChevronDown, Trash2, X} from 'lucide-react';
import {api} from '@/lib/api-client';
import {API} from '@/lib/api-paths';
import {Badge, Button, Skeleton} from '@/components/ui';

/**
 * 聊天页记忆面板（V3 §25）。
 *
 * 两件事只有用户能做，所以必须有前台入口：
 * - 「待确认」事实是摘要任务从对话里推出来的，确认前不注入上下文；
 * - 已确认的事实用户可以随时删掉，删掉之后就不再影响角色。
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

export function MemoryPanel({conversationId, token}: {conversationId: string; token: string}) {
  const [facts, setFacts] = useState<MemoryFact[] | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
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

  if (!enabled) return null;

  const list = facts ?? [];
  const pendingCount = list.filter(fact => fact.status === 'PENDING').length;

  return (
    <section className="mx-auto mt-3 max-w-3xl rounded-2xl border border-white/10 bg-zinc-900/60">
      <button
        type="button"
        onClick={() => setOpen(prev => !prev)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm text-zinc-200 hover:text-white"
      >
        <Brain className="h-4 w-4 text-zinc-500" />
        <span className="font-medium">记忆</span>
        {pendingCount > 0 && <Badge variant="warning" size="sm">待确认 {pendingCount}</Badge>}
        <span className="ml-auto text-[11px] text-zinc-500">{facts === null ? '加载中…' : `${list.length} 条`}</span>
        <ChevronDown className={`h-4 w-4 text-zinc-500 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="space-y-2 border-t border-white/10 px-4 py-3">
          {facts === null && <Skeleton className="h-12 w-full" />}
          {facts !== null && list.length === 0 && (
            <p className="text-xs text-zinc-500">还没有记住什么。聊得多一些，角色会记住你在意的事。</p>
          )}
          {list.map(fact => (
            <div key={fact.id} className="flex items-start gap-2 rounded-xl border border-white/10 bg-zinc-800/40 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm text-zinc-100">{fact.text}</p>
                <p className="mt-0.5 text-[10px] text-zinc-500">
                  {fact.status === 'PENDING' ? '待确认：确认后才会被角色记住' : '已记住'}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {fact.status === 'PENDING' ? (
                  <>
                    <Button size="sm" variant="ghost" loading={busyId === fact.id} onClick={() => void act(fact, 'confirm')}>
                      <Check className="h-3.5 w-3.5" />确认
                    </Button>
                    <Button size="sm" variant="ghost" disabled={busyId === fact.id} onClick={() => void act(fact, 'ignore')}>
                      <X className="h-3.5 w-3.5" />忽略
                    </Button>
                  </>
                ) : (
                  <Button size="sm" variant="ghost" disabled={busyId === fact.id} onClick={() => void act(fact, 'delete')} aria-label="删除这条记忆">
                    <Trash2 className="h-3.5 w-3.5" />删除
                  </Button>
                )}
              </div>
            </div>
          ))}
          {notice && <p className="text-[11px] text-zinc-400">{notice}</p>}
        </div>
      )}
    </section>
  );
}
