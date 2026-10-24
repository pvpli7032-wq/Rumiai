'use client';

import {useCallback, useEffect, useState} from 'react';
import Link from 'next/link';
import {useAuth} from '@web/lib/auth-context';
import {CATEGORY_LABELS} from '@rumiai/contracts/report-labels';
import {API} from '@rumiai/contracts/api-paths';

type Report = {id: string; targetType: string; category: keyof typeof CATEGORY_LABELS; status: string; createdAt: string; details: string; evidenceContent?: string};
const statuses: Record<string, string> = {OPEN: '待处理', REVIEWING: '处理中', ACTIONED: '已处理', DISMISSED: '未采纳'};
const targets: Record<string, string> = {MESSAGE: 'AI 回复', CHARACTER: '角色', USER: '用户', COMMENT: '评论', POST: '帖子', POST_COMMENT: '帖子评论', UNIVERSE: '世界'};

export function MyReports() {
  const {token, isLoading} = useAuth();
  const [reports, setReports] = useState<Report[] | null>(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const load = useCallback((signal?: AbortSignal) => {
    if (!token) return;
    setReports(null); setError('');
    void fetch(API.reports, {signal, headers: {Authorization: `Bearer ${token}`}}).then(async response => { const data = await response.json().catch(() => ({})); if (!response.ok) throw Error(data.error || '举报记录加载失败，请重试。'); return data; }).then(data => { if (!signal?.aborted) setReports(Array.isArray(data) ? data : []); }).catch(cause => { if (!signal?.aborted) setError(cause instanceof Error ? cause.message : '举报记录加载失败，请重试。'); });
  }, [token]);
  useEffect(() => { const controller = new AbortController(); load(controller.signal); return () => controller.abort(); }, [load, revision]);
  return <main className="mx-auto max-w-3xl space-y-4 p-4 pb-24"><header><h1 className="text-2xl font-bold">我的举报</h1><p className="mt-1 text-sm text-muted-foreground">提交时保留的处理依据仅在这里向你展示。</p></header>{!token && !isLoading ? <Link href="/login?next=/my-reports" className="text-brand">请先登录</Link> : error ? <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-4"><p>{error}</p><button onClick={() => setRevision(value => value + 1)} className="mt-2 min-h-10 text-sm text-brand underline underline-offset-2">重试</button></div> : !reports ? <p role="status" className="text-sm text-muted-foreground">正在加载…</p> : !reports.length ? <p className="rounded-xl border border-dashed border-border p-5 text-sm text-muted-foreground">暂无举报记录。</p> : <ul className="space-y-3">{reports.map(report => <li key={report.id} className="space-y-2 rounded-2xl border border-border bg-card p-4"><p className="font-semibold">{targets[report.targetType] || '内容'} · {CATEGORY_LABELS[report.category] || report.category}</p><p className="text-sm text-muted-foreground">{statuses[report.status] || report.status} · {new Date(report.createdAt).toLocaleString('zh-CN')}</p>{report.details && <p className="whitespace-pre-wrap break-words text-sm">{report.details}</p>}{report.evidenceContent && <details><summary className="min-h-11 cursor-pointer py-3 text-sm">查看提交时的回复</summary><p className="whitespace-pre-wrap break-words rounded-xl bg-muted p-3 text-sm">{report.evidenceContent}</p></details>}</li>)}</ul>}</main>;
}