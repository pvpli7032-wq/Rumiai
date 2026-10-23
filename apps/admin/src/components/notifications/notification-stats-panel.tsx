'use client';

import {useEffect, useState} from 'react';
import {Bell} from 'lucide-react';
import {AdminNotice, AdminPage, AdminPageHeader, AdminPanel, AdminStat, AdminStatGrid} from '../admin-page';
import {Badge} from '@rumiai/ui/badge';
import {DataTable} from '@admin/components/layout/data-table';
import {cn} from '@rumiai/ui/cn';
import {RANGE_OPTIONS, type RangeDays} from '../workbench/range';
import {API} from '@rumiai/contracts/api-paths';
import type {NotificationStats} from '@rumiai/contracts/admin/notifications';

const number = (value: number) => new Intl.NumberFormat('zh-CN').format(value);
/** 分母为 0 时是 null：写「—」，绝不写 0%。 */
const percent = (value: number | null) => (value === null ? '—' : (value * 100).toFixed(1) + '%');

/**
 * 通知统计（V3 第 17 章）。日期范围沿用工作台的 RANGE_OPTIONS，
 * 与运营分析共用同一套 days 参数。类型中文名由服务端给出，这里不再二次映射。
 */
export function NotificationStatsPanel({sessionActive}: {sessionActive: boolean}) {
  const [days, setDays] = useState<RangeDays>(7);
  const [report, setReport] = useState<NotificationStats | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(''); setReport(null);
    void fetch(API.admin.notificationStats('days=' + days), {credentials: 'include', cache: 'no-store', signal: controller.signal})
      .then(async response => { const data = await response.json(); if (!response.ok) throw Error(data.error); return data as NotificationStats; })
      .then(setReport)
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '通知统计读取失败。'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [days, sessionActive]);

  return <AdminPage>
    <AdminPageHeader
      eyebrow="系统与安全"
      title="通知统计"
      description="各类型通知的发送量、未读与已读情况。只统计已落表的通知；写入失败只有日志，不在此页。"
      actions={<div role="group" aria-label="日期范围" className="inline-flex rounded-2xl border border-border/80 bg-card p-1 shadow-sm">
        {RANGE_OPTIONS.map(option => <button
          key={option.days}
          type="button"
          aria-pressed={days === option.days}
          onClick={() => setDays(option.days)}
          className={cn(
            'min-h-9 rounded-xl px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            days === option.days ? 'bg-brand-soft text-brand' : 'text-muted-foreground hover:text-foreground',
          )}
        >{option.label}</button>)}
      </div>}
    />

    {loading && <AdminNotice tone="loading" title="正在读取通知统计…" />}
    {error && <AdminNotice tone="error" title={error} />}
    {report && <>
      <AdminStatGrid>
        <AdminStat label="发送量" value={number(report.totals.sent)} hint={'统计区间内落表的通知总数'} icon={<Bell aria-hidden className="h-4 w-4" />} />
        <AdminStat label="未读" value={number(report.totals.unread)} hint="read_at 为空的通知" tone="warning" />
        <AdminStat label="已读" value={number(report.totals.read)} hint="用户已打开过的通知" tone="success" />
        <AdminStat label="已读率" value={percent(report.totals.readRate)} hint="已读 / 发送量" />
      </AdminStatGrid>

      <AdminPanel
        title="按类型统计"
        description="登记过的四类即使 0 条也列出：某一类归零说明对应生产者不再发送。历史遗留的未知类型按原始值显示。"
        badge={<Badge variant="neutral">{report.rows.length} 类</Badge>}
      >
        <DataTable
          rows={report.rows}
          getRowId={row => row.type}
          dense
          className="border-none"
          columns={[
            {id: 'label', header: '类型', cell: row => <span className="text-foreground">{row.label}</span>},
            {id: 'sent', header: '发送量', align: 'right', cell: row => <span className="tabular-nums">{number(row.sent)}</span>},
            {id: 'unread', header: '未读', align: 'right', cell: row => <span className="tabular-nums">{number(row.unread)}</span>},
            {id: 'read', header: '已读', align: 'right', cell: row => <span className="tabular-nums">{number(row.read)}</span>},
            {id: 'rate', header: '已读率', align: 'right', cell: row => <span className="flex min-w-24 items-center justify-end gap-2"><span className="h-1.5 w-14 overflow-hidden rounded-full bg-border/60"><span className="block h-full rounded-full bg-emerald-500" style={{width: `${row.readRate === null ? 0 : Math.max(2, Math.min(100, row.readRate * 100))}%`}} /></span><span className="tabular-nums">{percent(row.readRate)}</span></span>},
          ]}
        />
      </AdminPanel>

      <AdminPanel title="统计口径">
        <div className="space-y-1 text-sm text-muted-foreground">
          <p>时间范围按发送时间（created_at）过滤，含区间两端。</p>
          <p>未读 = read_at 为空；已读 = read_at 有值。已读率分母为 0 时显示「—」，不显示 0%。</p>
          <p>统计区间：{new Date(report.since).toLocaleString('zh-CN')} 至 {new Date(report.generatedAt).toLocaleString('zh-CN')}</p>
        </div>
      </AdminPanel>
    </>}
  </AdminPage>;
}
