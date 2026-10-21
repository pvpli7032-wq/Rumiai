'use client';
import {useCallback, useEffect, useState} from 'react';
import Link from 'next/link';
import {Plus, Scale} from 'lucide-react';
import {Button, EmptyState} from '@/components/ui';
import {API} from '@/lib/api-paths';
import {useAuth} from '@/lib/auth-context';
import type {DisputeCaseSummary, DisputeListResult} from '@/lib/disputes/types';
import {DisputeCaseCard} from './case-card';
import {SORT_TABS} from './shared';

/** 列表：热门 / 最新 / 我参与的。发起入口在顶部，点开进入表单。 */
export function DisputeBoard({locale}: {locale: string}) {
  const {token, isLoading} = useAuth();
  const [sort, setSort] = useState<'hot' | 'latest' | 'joined'>('hot');
  const [items, setItems] = useState<DisputeCaseSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (next: 'hot' | 'latest' | 'joined', after: string | null, append: boolean, signal?: AbortSignal) => {
    if (next === 'joined' && !token) { setItems([]); setLoading(false); return; }
    setLoading(true);
    setError('');
    try {
      const query = new URLSearchParams({sort: next, limit: '20', ...(after ? {cursor: after} : {})});
      const response = await fetch(API.disputes.list(query.toString()), {signal, headers: token ? {Authorization: `Bearer ${token}`} : {}});
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '评理列表加载失败。');
      const page = data as DisputeListResult;
      setItems(rows => append ? [...rows, ...page.items] : page.items);
      setCursor(page.nextCursor);
    } catch (cause) {
      if (!signal?.aborted) setError(cause instanceof Error ? cause.message : '加载失败，请重试。');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (isLoading) return;
    const controller = new AbortController();
    void load(sort, null, false, controller.signal);
    return () => controller.abort();
  }, [isLoading, load, sort]);

  return (
    <main className="mx-auto w-full max-w-3xl space-y-4 p-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-2xl font-bold"><Scale aria-hidden className="h-6 w-6" /> 评理广场</h1>
          <p className="mt-1 text-sm text-muted-foreground">从聊天里摘一段对话，说清你的诉求，让大家投票谁更有理。</p>
        </div>
        <Link href={`/${locale}/disputes/new`}><Button leadingIcon={<Plus className="h-4 w-4" />}>发起评理</Button></Link>
      </header>

      <div role="tablist" aria-label="排序" className="flex flex-wrap gap-2">
        {SORT_TABS.map(tab => (
          <button key={tab.value} type="button" role="tab" aria-selected={sort === tab.value} disabled={tab.value === 'joined' && !token}
            onClick={() => setSort(tab.value)}
            className={`min-h-10 rounded-lg border px-3 text-sm transition-colors ${sort === tab.value ? 'border-brand bg-brand-soft text-brand' : 'border-border hover:bg-muted'} disabled:opacity-50`}>
            {tab.label}
          </button>
        ))}
      </div>

      {sort === 'joined' && !token ? (
        <p className="text-sm text-muted-foreground">登录后可查看你参与过的评理。<Link href={`/${locale}/auth`} className="ml-1 text-brand underline-offset-4 hover:underline">去登录</Link></p>
      ) : error ? (
        <p role="alert" className="text-sm text-destructive">{error} <Button size="sm" variant="link" onClick={() => void load(sort, null, false)}>重试</Button></p>
      ) : loading && items.length === 0 ? (
        <p className="text-sm text-muted-foreground">正在加载…</p>
      ) : items.length === 0 ? (
        <EmptyState icon={<Scale className="h-8 w-8" />} title={sort === 'joined' ? '你还没有参与评理' : '还没有评理案例'} description={sort === 'joined' ? '发起或投过票的案例会出现在这里。' : '做第一个发起的人，让大家来评评理。'} />
      ) : (
        <ul className="space-y-3">
          {items.map(item => <DisputeCaseCard key={item.id} item={item} locale={locale} />)}
        </ul>
      )}
      {cursor ? <Button variant="outline" fullWidth loading={loading} onClick={() => void load(sort, cursor, true)}>加载更多</Button> : null}
    </main>
  );
}
