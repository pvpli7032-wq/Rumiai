'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';

type Appeal = { id: string; reason: string; status: string; resolution: string | null; createdAt: string };
export function CommunityAppeal() {
  const { token, isLoading } = useAuth();
  const [reason, setReason] = useState('');
  const [appeals, setAppeals] = useState<Appeal[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function load() {
    if (!token) return;
    const response = await fetch('/api/community-appeals', { headers: { Authorization: `Bearer ${token}` } });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '申诉记录加载失败。');
    setAppeals(data);
  }
  useEffect(() => { if (!isLoading && token) void load().catch(value => setError(value.message)); }, [isLoading, token]);
  async function submit() {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/community-appeals', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || '提交失败。');
      setReason(''); await load();
    } catch (value) { setError(value instanceof Error ? value.message : '提交失败。'); }
    finally { setBusy(false); }
  }
  if (isLoading) return <main className="mx-auto max-w-2xl p-4">正在读取登录状态…</main>;
  if (!token) return <main className="mx-auto max-w-2xl space-y-3 p-4"><h1 className="text-xl font-bold">社区申诉</h1><p>请登录被限制的账号后提交申诉。</p><a href="/login?next=%2Fcommunity-appeal" className="inline-flex min-h-11 items-center text-orange-500">前往登录</a></main>;
  return <main className="mx-auto max-w-2xl space-y-4 p-4"><h1 className="text-xl font-bold">社区申诉</h1><p className="text-sm text-muted-foreground">说明你希望复核的社区发言限制。申诉不会自动解除限制。</p>{error && <p role="alert" className="text-red-400">{error}</p>}<label className="block text-sm">申诉说明（10–1000 字）<textarea value={reason} onChange={event => setReason(event.target.value)} maxLength={1000} className="mt-2 min-h-32 w-full rounded-lg border border-border bg-background p-3" /></label><p className="text-right text-xs text-muted-foreground">{reason.trim().length}/1000</p><button disabled={busy || reason.trim().length < 10} onClick={() => void submit()} className="min-h-11 rounded-lg bg-orange-600 px-5 text-white disabled:opacity-50">{busy ? '正在提交…' : '提交申诉'}</button><section><h2 className="mb-2 font-semibold">我的申诉记录</h2>{appeals.length ? <ul className="space-y-3">{appeals.map(appeal => <li key={appeal.id} className="rounded-lg border border-border p-3"><p className="text-xs text-muted-foreground">{appeal.status} · {new Date(appeal.createdAt).toLocaleString('zh-CN')}</p><p className="mt-2 whitespace-pre-wrap text-sm">{appeal.reason}</p>{appeal.resolution && <p className="mt-2 text-sm text-orange-300">复核结果：{appeal.resolution}</p>}</li>)}</ul> : <p className="text-sm text-muted-foreground">暂无申诉记录。</p>}</section></main>;
}
