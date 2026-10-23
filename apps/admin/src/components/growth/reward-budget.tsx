'use client';

import { useEffect, useState } from 'react';
import { AdminNotice, AdminPanel, AdminStat, AdminStatGrid } from '../admin-page';
import { DataTable, type DataTableColumn } from '@rumiai/ui/data-table';
import { Select } from '@rumiai/ui/select';
import { formatNumber } from '@rumiai/contracts/format/number';

type Report = { days: number; since: string; generatedAt: string; budgetLimitConfigured: boolean; totalClaims: number; totalCoins: number; sources: { key: string; label: string; claims: number; coins: number }[]; daily: { date: string; claims: number; coins: number }[] };
const dailyColumns: DataTableColumn<Report['daily'][number]>[] = [
  { id: 'date', header: 'UTC 日期', cell: row => <span className="whitespace-nowrap">{row.date}</span> },
  { id: 'coins', header: '发放金币', align: 'right', width: '140px', cell: row => <span className="tabular-nums">{formatNumber(row.coins)}</span> },
  { id: 'claims', header: '领取笔数', align: 'right', width: '140px', cell: row => <span className="tabular-nums">{formatNumber(row.claims)}</span> },
];

export function RewardBudget({ sessionActive }: { sessionActive: boolean }) {
  const [days, setDays] = useState(7), [report, setReport] = useState<Report | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError('');
    void fetch(`/api/admin/growth/rewards?days=${days}`, {credentials: 'include', cache: 'no-store', signal: controller.signal })
      .then(async response => { const data = await response.json(); if (!response.ok) throw Error(data.error); return data as Report; })
      .then(setReport).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '奖励发放统计读取失败。'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [days, sessionActive]);

  return (
    <AdminPanel
      title="奖励发放监控"
      description="按金币账本来源汇总真实发放笔数和金币；当前没有设置预算上限，因此只展示消耗，不做封顶拦截。"
      actions={
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">统计周期</span>
          <Select size="sm" aria-label="奖励统计周期" className="w-32" value={days} onChange={event => setDays(Number(event.target.value))}>
            <option value={7}>近 7 天</option><option value={30}>近 30 天</option><option value={90}>近 90 天</option>
          </Select>
        </label>
      }
    >
      <div className="space-y-5">
        {loading && <AdminNotice tone="loading" title="正在汇总金币奖励流水…" />}
        {error && <AdminNotice tone="error" title={error} />}
        {report && (
          <>
            <AdminStatGrid className="sm:grid-cols-3 xl:grid-cols-3">
              <AdminStat label="奖励金币" value={formatNumber(report.totalCoins)} tone="brand" />
              <AdminStat label="领取笔数" value={formatNumber(report.totalClaims)} />
              <AdminStat label="预算上限" value={report.budgetLimitConfigured ? '已配置' : '未配置'} tone={report.budgetLimitConfigured ? 'success' : 'warning'} />
            </AdminStatGrid>
            <div className="grid gap-3 sm:grid-cols-3">
              {report.sources.map(source => (
                <div key={source.key} className="min-w-0 rounded-lg border border-border p-3">
                  <p className="text-sm font-medium">{source.label}</p>
                  <p className="mt-1 text-sm tabular-nums text-muted-foreground">{formatNumber(source.coins)} 金币 · {formatNumber(source.claims)} 笔领取</p>
                </div>
              ))}
            </div>
            <div>
              <p className="mb-3 text-sm font-medium">每日发放明细</p>
              <DataTable
                columns={dailyColumns}
                rows={report.daily}
                getRowId={row => row.date}
                empty="所选时间内暂无奖励领取。"
              />
            </div>
            <p className="text-xs text-muted-foreground">统计区间：{new Date(report.since).toLocaleString('zh-CN')} 至 {new Date(report.generatedAt).toLocaleString('zh-CN')}。零金币任务仍计入领取笔数；金币金额来自有来源标记的账本流水。</p>
          </>
        )}
      </div>
    </AdminPanel>
  );
}
