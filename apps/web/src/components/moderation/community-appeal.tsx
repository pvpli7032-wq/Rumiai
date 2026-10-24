'use client';

import {useCallback, useEffect, useState} from 'react';
import {useAuth} from '@web/lib/auth-context';

type Appeal = {id: string; reason: string; status: string; resolution: string | null; createdAt: string};

export function CommunityAppeal() {
  const {token, isLoading} = useAuth();
  const [reason, setReason] = useState('');
  const [appeals, setAppeals] = useState<Appeal[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true); setError('');
    try { const response = await fetch('/api/community-appeals', {headers: {Authorization: `Bearer ${token}`}}); const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error || '申诉记录加载失败。'); setAppeals(Array.isArray(data) ? data : []); }
    catch (value) { setError(value instanceof Error ? value.message : '申诉记录加载失败。'); }
    finally { setLoading(false); }
  }, [token]);
  useEffect(() => { if (!isLoading && token) void load(); }, [isLoading, token, load]);
  async function submit() {
    if (!token || busy) return;
    setBusy(true); setError('');
    try { const response = await fetch('/api/community-appeals', {method: 'POST', headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'}, body: JSON.stringify({reason})}); const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error || '提交失败。'); setReason(''); await load(); }
    catch (value) { setError(value instanceof Error ? value.message : '提交失败。'); }
    finally { setBusy(false); }
  }
  if (isLoading) return <main className="mx-auto max-w-2xl p-4" role="status">正在读取登录状态…</main>;
  if (!token) return <main className="mx-auto max-w-2xl space-y-3 p-4"><h1 className="text-xl font-bold">社区申诉</h1><p>请登录被限制的账号后提交申诉。</p><a href="/login?next=%2Fcommunity-appeal" className="inline-flex min-h-11 items-center text-brand">前往登录</a></main>;
  return <main className="mx-auto max-w-2xl space-y-5 p-4 pb-24"><header><h1 className="text-2xl font-bold">社区申诉</h1><p className="mt-2 text-sm text-muted-foreground">说明你希望复核的社区发言限制。申诉不会自动解除限制。</p></header>{error && <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"><p>{error}</p><button type="button" onClick={() => void load()} disabled={loading || busy} className="mt-2 min-h-10 underline underline-offset-2 disabled:opacity-50">重试加载</button></div>}<section className="rounded-2xl border border-border bg-card p-4"><label htmlFor="community-appeal-reason" className="block text-sm font-medium">申诉说明（10–1000 字）</label><textarea id="community-appeal-reason" aria-describedby="community-appeal-count" value={reason} onChange={event => setReason(event.target.value)} maxLength={1000} className="mt-2 min-h-32 w-full rounded-xl border border-input bg-background p-3" /><p id="community-appeal-count" className="mt-1 text-right text-xs text-muted-foreground">{reason.trim().length}/1000</p><button disabled={busy || reason.trim().length < 10} onClick={() => void submit()} className="mt-3 min-h-11 rounded-xl bg-brand px-5 text-sm font-semibold text-brand-foreground disabled:opacity-50">{busy ? '正在提交…' : '提交申诉'}</button></section><section aria-busy={loading}><h2 className="mb-2 font-semibold">我的申诉记录</h2>{loading ? <p role="status" className="text-sm text-muted-foreground">正在读取申诉记录…</p> : appeals.length ? <ul className="space-y-3">{appeals.map(appeal => <li key={appeal.id} className="rounded-xl border border-border bg-card p-3"><p className="text-xs text-muted-foreground">{appeal.status} · {new Date(appeal.createdAt).toLocaleString('zh-CN')}</p><p className="mt-2 whitespace-pre-wrap break-words text-sm">{appeal.reason}</p>{appeal.resolution && <p className="mt-2 text-sm text-brand">复核结果：{appeal.resolution}</p>}</li>)}</ul> : <p className="text-sm text-muted-foreground">暂无申诉记录。</p>}</section></main>;
}