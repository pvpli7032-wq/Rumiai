'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';

type ReportRow = { id: string; targetType: string; targetId: string; category: string; details: string; evidenceContent: string | null; status: string; target: any; reporter: { username: string } };
type AppealRow = { id: string; userId: string; reason: string; status: string; user: { username: string; communityBanReason: string | null } };
type AuditRow = { id: string; targetType: string; targetId: string; action: string; reason: string; createdAt: string; actor: { username: string } };
type Tab = 'reports' | 'appeals' | 'audit';

export function CommunityModeration() {
  const { token, isLoading } = useAuth();
  const [tab, setTab] = useState<Tab>('reports');
  const [reportStatus, setReportStatus] = useState('OPEN');
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [appeals, setAppeals] = useState<AppealRow[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [resolutions, setResolutions] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    if (!token) return;
    setError('');
    const path = tab === 'reports' ? `/api/moderation/reports?status=${reportStatus}` : tab === 'appeals' ? '/api/moderation/appeals?status=OPEN' : '/api/moderation/audit';
    try {
      const response = await fetch(path, { headers: { Authorization: `Bearer ${token}` } });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '加载失败。');
      if (tab === 'reports') setReports(data);
      else if (tab === 'appeals') setAppeals(data);
      else setAudit(data);
    } catch (value) { setError(value instanceof Error ? value.message : '加载失败。'); }
  }, [tab, token, reportStatus]);
  useEffect(() => { if (!isLoading) void load(); }, [isLoading, load]);

  async function moderateReport(report: ReportRow, action: string) {
    const reason = reasons[report.id]?.trim() || (action === 'REVIEWING' ? '开始核查' : '根据举报完成复核');
    setBusy(report.id); setError('');
    try {
      const response = await fetch(`/api/moderation/reports/${report.id}`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ action, reason }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || '处置失败。');
      await load();
    } catch (value) { setError(value instanceof Error ? value.message : '处置失败。'); }
    finally { setBusy(''); }
  }
  async function reviewAppeal(appeal: AppealRow, status: 'ACCEPTED' | 'REJECTED') {
    const resolution = resolutions[appeal.id]?.trim();
    if (!resolution) { setError('请先填写申诉复核说明。'); return; }
    setBusy(appeal.id); setError('');
    try {
      const response = await fetch(`/api/moderation/appeals/${appeal.id}`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ status, resolution }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || '复核失败。');
      await load();
    } catch (value) { setError(value instanceof Error ? value.message : '复核失败。'); }
    finally { setBusy(''); }
  }

  return <section className="mt-10 space-y-4 border-t border-border pt-6">
    <h2 className="text-xl font-bold">社区管理台</h2>
    <nav className="flex flex-wrap gap-2">{([['reports', '举报队列'], ['appeals', '申诉队列'], ['audit', '审计记录']] as const).map(([id, label]) => <button key={id} onClick={() => setTab(id)} className={`min-h-11 rounded-lg border px-4 ${tab === id ? 'border-orange-500 text-orange-400' : 'border-border'}`}>{label}</button>)}{tab === 'reports' && <select aria-label="举报状态" value={reportStatus} onChange={event => setReportStatus(event.target.value)} className="min-h-11 rounded-lg border border-border bg-background px-3"><option value="OPEN">待处理</option><option value="REVIEWING">处理中</option><option value="ALL">全部记录</option></select>}<button onClick={() => void load()} className="min-h-11 rounded-lg border border-border px-4">刷新</button></nav>
    {error && <p role="alert" className="text-red-400">{error}</p>}
    {tab === 'reports' && (reports.length ? reports.map(report => <article key={report.id} className="space-y-3 rounded-xl border border-border p-4">
      <div className="flex flex-wrap justify-between gap-2"><h3 className="font-semibold">{report.targetType} · {report.category}</h3><span className="text-xs text-muted-foreground">举报人：@{report.reporter.username}</span></div>
      <p className="whitespace-pre-wrap break-words text-sm">{report.target?.content || report.target?.name || report.target?.username || report.evidenceContent || '目标当前不可读取'}</p>
      {report.details && <p className="text-sm text-muted-foreground">补充说明：{report.details}</p>}
      {report.targetType === 'USER' && report.target?.communityBannedAt && <p className="text-sm text-amber-400">已封禁：{report.target.communityBanReason}</p>}
      <label className="block text-sm">处置记录说明<textarea maxLength={1000} value={reasons[report.id] || ''} onChange={event => setReasons(value => ({ ...value, [report.id]: event.target.value }))} className="mt-1 min-h-20 w-full rounded border border-border bg-background p-2" /></label>
      <div className="flex flex-wrap gap-2">{['OPEN', 'REVIEWING'].includes(report.status) && <><button disabled={!!busy} onClick={() => void moderateReport(report, 'REVIEWING')} className="min-h-11 rounded border border-border px-3">标记处理中</button><button disabled={!!busy} onClick={() => void moderateReport(report, 'DISMISS')} className="min-h-11 rounded border border-border px-3">驳回举报</button>{(report.targetType === 'POST' || report.targetType === 'POST_COMMENT') && <button disabled={!!busy} onClick={() => void moderateReport(report, 'HIDE')} className="min-h-11 rounded bg-orange-700 px-3 text-white">隐藏内容</button>}{report.targetType === 'USER' && !report.target?.communityBannedAt && <button disabled={!!busy} onClick={() => void moderateReport(report, 'BAN')} className="min-h-11 rounded bg-red-700 px-3 text-white">封禁社区发言</button>}</>}{report.targetType === 'USER' && report.target?.communityBannedAt && <button disabled={!!busy} onClick={() => void moderateReport(report, 'UNBAN')} className="min-h-11 rounded border border-border px-3">解除封禁</button>}</div>
    </article>) : <p className="py-4 text-sm text-muted-foreground">暂无待处理举报。</p>)}
    {tab === 'appeals' && (appeals.length ? appeals.map(appeal => <article key={appeal.id} className="space-y-3 rounded-xl border border-border p-4"><h3 className="font-semibold">@{appeal.user.username} 的社区申诉</h3><p className="whitespace-pre-wrap text-sm">{appeal.reason}</p><p className="text-xs text-muted-foreground">封禁原因：{appeal.user.communityBanReason || '未提供'}</p><label className="block text-sm">复核说明<textarea maxLength={1000} value={resolutions[appeal.id] || ''} onChange={event => setResolutions(value => ({ ...value, [appeal.id]: event.target.value }))} className="mt-1 min-h-20 w-full rounded border border-border bg-background p-2" /></label><div className="flex gap-2"><button disabled={!!busy} onClick={() => void reviewAppeal(appeal, 'ACCEPTED')} className="min-h-11 rounded bg-green-700 px-3 text-white">接受申诉并解封</button><button disabled={!!busy} onClick={() => void reviewAppeal(appeal, 'REJECTED')} className="min-h-11 rounded border border-border px-3">驳回申诉</button></div></article>) : <p className="py-4 text-sm text-muted-foreground">暂无待复核申诉。</p>)}
    {tab === 'audit' && (audit.length ? <ul className="divide-y divide-border">{audit.map(row => <li key={row.id} className="py-3 text-sm"><p className="font-medium">{row.action} · {row.targetType} · {row.targetId}</p><p className="text-muted-foreground">审核人 @{row.actor.username} · {new Date(row.createdAt).toLocaleString('zh-CN')}</p><p className="whitespace-pre-wrap">{row.reason}</p></li>)}</ul> : <p className="py-4 text-sm text-muted-foreground">暂无审计记录。</p>)}
  </section>;
}
