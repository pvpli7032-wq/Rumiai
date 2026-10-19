'use client';

import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import {useAdminAccess} from '@/components/admin/use-admin-access';
import { useAuth } from '@/lib/auth-context';
import {AdminNotice, AdminPanel} from '@/components/admin/admin-page';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Select} from '@/components/ui/select';
import {Textarea} from '@/components/ui/textarea';
import {Tabs, TabsContent, TabsList, TabsTrigger} from '@/components/ui/tabs';

type ReportTarget = { content?: string | null; name?: string | null; username?: string | null; communityBannedAt?: string | null; communityBanReason?: string | null } | null;
type ReportRow = { id: string; targetType: string; targetId: string; category: string; details: string; evidenceContent: string | null; status: string; target: ReportTarget; reporter: { username: string } };
type AppealRow = { id: string; userId: string; reason: string; status: string; user: { username: string; communityBanReason: string | null } };
type AuditRow = { id: string; targetType: string; targetId: string; action: string; reason: string; createdAt: string; actor: { username: string } };
type Tab = 'reports' | 'appeals' | 'audit';

export function CommunityModeration() {
  const { token, isLoading } = useAuth();
  const {permissions} = useAdminAccess();
  const canModerate = permissions.includes('moderation.write');
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
    const path = tab === 'reports' ? `/api/admin/moderation/reports?status=${reportStatus}` : tab === 'appeals' ? '/api/admin/moderation/appeals?status=OPEN' : '/api/admin/moderation/audit';
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
    if (!canModerate || busy) return;
    const reason = reasons[report.id]?.trim() || (action === 'REVIEWING' ? '开始核查' : '根据举报完成复核');
    setBusy(report.id); setError('');
    try {
      const response = await fetch(`/api/admin/moderation/reports/${report.id}`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ action, reason }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || '处置失败。');
      await load();
    } catch (value) { setError(value instanceof Error ? value.message : '处置失败。'); }
    finally { setBusy(''); }
  }
  async function reviewAppeal(appeal: AppealRow, status: 'ACCEPTED' | 'REJECTED') {
    if (!canModerate || busy) return;
    const resolution = resolutions[appeal.id]?.trim();
    if (!resolution) { setError('请先填写申诉复核说明。'); return; }
    setBusy(appeal.id); setError('');
    try {
      const response = await fetch(`/api/admin/moderation/appeals/${appeal.id}`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ status, resolution }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || '复核失败。');
      await load();
    } catch (value) { setError(value instanceof Error ? value.message : '复核失败。'); }
    finally { setBusy(''); }
  }

  return (
    <AdminPanel
      title="社区治理"
      description="举报队列、申诉复核与处置审计按标签切换，处置动作均需填写理由。"
      badge={<Badge variant={canModerate ? 'brand' : 'neutral'}>{canModerate ? '可处置' : '只读'}</Badge>}
      actions={
        <>
          {tab === 'reports' && (
            <div className="w-32">
              <Select size="sm" aria-label="举报状态" value={reportStatus} onChange={event => setReportStatus(event.target.value)}>
                <option value="OPEN">待处理</option>
                <option value="REVIEWING">处理中</option>
                <option value="ALL">全部记录</option>
              </Select>
            </div>
          )}
          <Button size="sm" variant="outline" leadingIcon={<RefreshCw className="h-4 w-4" />} onClick={() => void load()}>刷新</Button>
        </>
      }
    >
      <Tabs value={tab} onValueChange={value => setTab(value as Tab)}>
        <TabsList aria-label="社区治理视图">
          <TabsTrigger value="reports">举报队列</TabsTrigger>
          <TabsTrigger value="appeals">申诉队列</TabsTrigger>
          <TabsTrigger value="audit">审计记录</TabsTrigger>
        </TabsList>

        {error && <AdminNotice tone="error" title={error} className="py-6" />}

        <TabsContent value="reports" className="mt-4">
          {reports.length === 0 ? (
            <p className="py-6 text-sm text-muted-foreground">暂无待处理举报。</p>
          ) : (
            <div className="grid gap-4 xl:grid-cols-2">
              {reports.map(report => (
                <article key={report.id} className="space-y-3 rounded-lg border border-border p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold text-foreground">{report.targetType} · {report.category}</h3>
                      <Badge variant={report.status === 'OPEN' ? 'warning' : report.status === 'REVIEWING' ? 'brand' : 'neutral'}>{report.status}</Badge>
                    </div>
                    <span className="text-xs text-muted-foreground">举报人：@{report.reporter.username}</span>
                  </div>
                  <p className="whitespace-pre-wrap break-words text-sm text-foreground">{report.target?.content || report.target?.name || report.target?.username || report.evidenceContent || '目标当前不可读取'}</p>
                  {report.details && <p className="text-sm text-muted-foreground">补充说明：{report.details}</p>}
                  {report.targetType === 'USER' && report.target?.communityBannedAt && <p className="text-sm text-amber-600">已封禁：{report.target.communityBanReason}</p>}
                  <label className="block space-y-1.5">
                    <span className="text-sm font-medium">处置记录说明</span>
                    <Textarea rows={3} maxLength={1000} value={reasons[report.id] || ''} onChange={event => setReasons(value => ({ ...value, [report.id]: event.target.value }))} />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {['OPEN', 'REVIEWING'].includes(report.status) && (
                      <>
                        <Button size="sm" variant="outline" disabled={!!busy || !canModerate} onClick={() => void moderateReport(report, 'REVIEWING')}>标记处理中</Button>
                        <Button size="sm" variant="outline" disabled={!!busy || !canModerate} onClick={() => void moderateReport(report, 'DISMISS')}>驳回举报</Button>
                        {(report.targetType === 'POST' || report.targetType === 'POST_COMMENT') && <Button size="sm" disabled={!!busy || !canModerate} onClick={() => void moderateReport(report, 'HIDE')}>隐藏内容</Button>}
                        {report.targetType === 'USER' && !report.target?.communityBannedAt && <Button size="sm" variant="danger" disabled={!!busy || !canModerate} onClick={() => void moderateReport(report, 'BAN')}>封禁社区发言</Button>}
                      </>
                    )}
                    {report.targetType === 'USER' && report.target?.communityBannedAt && <Button size="sm" variant="outline" disabled={!!busy || !canModerate} onClick={() => void moderateReport(report, 'UNBAN')}>解除封禁</Button>}
                  </div>
                </article>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="appeals" className="mt-4">
          {appeals.length === 0 ? (
            <p className="py-6 text-sm text-muted-foreground">暂无待复核申诉。</p>
          ) : (
            <div className="grid gap-4 xl:grid-cols-2">
              {appeals.map(appeal => (
                <article key={appeal.id} className="space-y-3 rounded-lg border border-border p-4">
                  <h3 className="text-sm font-semibold text-foreground">@{appeal.user.username} 的社区申诉</h3>
                  <p className="whitespace-pre-wrap text-sm text-foreground">{appeal.reason}</p>
                  <p className="text-xs text-muted-foreground">封禁原因：{appeal.user.communityBanReason || '未提供'}</p>
                  <label className="block space-y-1.5">
                    <span className="text-sm font-medium">复核说明</span>
                    <Textarea rows={3} maxLength={1000} value={resolutions[appeal.id] || ''} onChange={event => setResolutions(value => ({ ...value, [appeal.id]: event.target.value }))} />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="success" disabled={!!busy || !canModerate} onClick={() => void reviewAppeal(appeal, 'ACCEPTED')}>接受申诉并解封</Button>
                    <Button size="sm" variant="outline" disabled={!!busy || !canModerate} onClick={() => void reviewAppeal(appeal, 'REJECTED')}>驳回申诉</Button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="audit" className="mt-4">
          {audit.length === 0 ? (
            <p className="py-6 text-sm text-muted-foreground">暂无审计记录。</p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {audit.map(row => (
                <li key={row.id} className="p-4 text-sm">
                  <p className="font-medium text-foreground">{row.action} · {row.targetType} · {row.targetId}</p>
                  <p className="mt-0.5 text-muted-foreground">审核人 @{row.actor.username} · {new Date(row.createdAt).toLocaleString('zh-CN')}</p>
                  <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{row.reason}</p>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
      </Tabs>
    </AdminPanel>
  );
}
