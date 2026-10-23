'use client';

import {useEffect, useState} from 'react';
import {AdminPanel} from '../admin-page';
import {API} from '@/lib/api-paths';

type FunnelStep = {event: string; label: string; people: number; rateFromStart: number | null; rateFromPrevious: number | null};
type Funnel = {key: string; title: string; description: string; steps: FunnelStep[]; overallRate: number | null};
type Report = {generatedAt: string; since: string; days: number; funnels: Funnel[]; definitions: Record<string, string>};

import {formatNumber, formatPercent} from '@/lib/format/number';
/** 分母为 0 时是 null：显示「样本不足」，绝不当成 0%。 */

/**
 * 玩法漏斗面板（V3 表 22）。与运营分析共用统计周期，只展示去重人数与转化率，
 * 不含用户标识，也不读取聊天内容。
 */
export function ProductFunnelPanel({sessionActive, days}: {sessionActive: boolean; days: number}) {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(''); setReport(null);
    void fetch(API.admin.analyticsProductFunnel + '?days=' + days, {credentials: 'include', cache: 'no-store', signal: controller.signal})
      .then(async response => { const data = await response.json(); if (!response.ok) throw Error(data.error); return data as Report; })
      .then(setReport)
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '玩法漏斗读取失败。'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [days, sessionActive]);

  return <AdminPanel title="玩法漏斗" description="按去重人数统计的三条玩法路径；分母为 0 时显示样本不足，不当作 0%。">
    {loading && <p className="text-sm text-muted-foreground">正在读取玩法漏斗…</p>}
    {error && <p className="text-sm text-red-600">{error}</p>}
    {report && <div className="space-y-4">
      {report.funnels.map(funnel => <div key={funnel.key} className="rounded-lg border border-border p-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm font-medium text-foreground">{funnel.title}</p>
          <p className="text-xs text-muted-foreground">端到端转化 {formatPercent(funnel.overallRate)}</p>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{funnel.description}</p>
        <div className="mt-3 space-y-2">
          {funnel.steps.map(step => <div key={step.event} className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
            <span className="text-foreground">{step.label}</span>
            <span className="tabular-nums text-muted-foreground">
              {formatNumber(step.people)} 人
              {step.rateFromPrevious !== null && <span className="ml-2">上一步 {formatPercent(step.rateFromPrevious)}</span>}
              <span className="ml-2">整体 {formatPercent(step.rateFromStart)}</span>
            </span>
          </div>)}
        </div>
      </div>)}
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer select-none">指标口径</summary>
        <div className="mt-1 space-y-1">
          {Object.entries(report.definitions).map(([key, text]) => <p key={key}>{text}</p>)}
          <p>统计区间：{new Date(report.since).toLocaleString('zh-CN')} 至 {new Date(report.generatedAt).toLocaleString('zh-CN')}</p>
        </div>
      </details>
    </div>}
  </AdminPanel>;
}
