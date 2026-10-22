'use client';

import {useEffect, useState} from 'react';
import {AdminPanel} from '../admin-page';
import {Select} from '@/components/ui/select';
import {API} from '@/lib/api-paths';

type RatioMetric = {key: string; label: string; formula: string; numerator: number; denominator: number; value: number | null};
type CostRow = {currency: string; knownCost: number; knownCostCalls: number; unknownCostCalls: number; replies: number; costPerReply: number | null};
type ReplyMix = {free: number; paid: number; total: number; freeShare: number | null};
type Metrics = {
  tier: string;
  tierLabel: string;
  tierOptions: Array<{key: string; label: string}>;
  testTier: {key: string; label: string; note: string};
  ratios: RatioMetric[];
  replyMix: ReplyMix;
  costPerReply: CostRow[];
  costNote: string;
  definitions: Record<string, string>;
};
type Report = {generatedAt: string; since: string; days: number; metrics: Metrics};

import {formatNumber, formatPercent} from '@/lib/format/number';
/** 分母为 0 时是 null：写「样本不足」，绝不写 0%。 */

/**
 * 运营统计首轮五项指标（V3 §26）。每项都带计算口径；
 * 免费/付费可筛，测试/正式按账号表实际能力只给一档并注明原因。
 */
export function OpsMetricsPanel({token, days}: {token: string; days: number}) {
  const [tier, setTier] = useState('all');
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(''); setReport(null);
    void fetch(API.admin.analyticsOpsMetrics + '?days=' + days + '&tier=' + tier, {headers: {Authorization: 'Bearer ' + token}, cache: 'no-store', signal: controller.signal})
      .then(async response => { const data = await response.json(); if (!response.ok) throw Error(data.error); return data as Report; })
      .then(setReport)
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '运营统计读取失败。'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [days, tier, token]);

  const metrics = report?.metrics;
  return <AdminPanel title="首轮运营指标" description="生成成功率、分享后的访问、注册到首次聊天、七日回访、免费占比与收费回复数（同一分母的两面），以及每个有效回复成本。分母为 0 一律显示「样本不足」。">
    <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
      <label className="flex items-center gap-2">
        <span className="text-muted-foreground">用户档位</span>
        <Select aria-label="用户档位" value={tier} onChange={event => setTier(event.target.value)} disabled={loading}>
          {(metrics?.tierOptions ?? [{key: 'all', label: '全部用户'}]).map(item => <option key={item.key} value={item.key}>{item.label}</option>)}
        </Select>
      </label>
      <span className="text-xs text-muted-foreground">测试/正式：{metrics?.testTier.label ?? '全部结果（含测试）'}</span>
    </div>

    {loading && <p className="text-sm text-muted-foreground">正在读取运营指标…</p>}
    {error && <p className="text-sm text-red-600">{error}</p>}
    {metrics && <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {metrics.ratios.map(item => <div key={item.key} className="rounded-lg border border-border p-3">
          <p className="text-sm font-medium text-foreground">{item.label}</p>
          <p className="mt-1 text-2xl tabular-nums text-foreground">{formatPercent(item.value)}</p>
          <p className="mt-1 text-xs text-muted-foreground">{formatNumber(item.numerator)} / {formatNumber(item.denominator)} · {item.formula}</p>
        </div>)}
      </div>

      <div className="rounded-lg border border-border p-3">
        <p className="text-sm font-medium text-foreground">收费回复数与免费占比</p>
        <p className="mt-1 text-xs text-muted-foreground">免费回复 {formatNumber(metrics.replyMix.free)} · 收费回复 {formatNumber(metrics.replyMix.paid)} · 合计 {formatNumber(metrics.replyMix.total)}（按已结算费用单全量聚合）</p>
      </div>

      <div className="rounded-lg border border-border p-3">
        <p className="text-sm font-medium text-foreground">每个有效回复成本</p>
        <p className="mt-1 text-xs text-muted-foreground">{metrics.costNote}</p>
        {metrics.costPerReply.length === 0
          ? <p className="mt-2 text-sm text-muted-foreground">样本不足：该区间没有非 MOCK 的 AI 调用。</p>
          : <ul className="mt-2 space-y-2 text-sm">
            {metrics.costPerReply.map(row => <li key={row.currency} className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-foreground">{row.currency}</span>
              <span className="tabular-nums text-muted-foreground">
                {row.costPerReply === null ? '样本不足' : row.costPerReply.toFixed(6) + ' / 回复'}
                <span className="ml-2">已知成本 {row.knownCost.toFixed(6)}（{formatNumber(row.knownCostCalls)} 次调用）</span>
                <span className="ml-2">未知成本 {formatNumber(row.unknownCostCalls)} 次调用（未计入分子）</span>
                <span className="ml-2">有效回复 {formatNumber(row.replies)}</span>
              </span>
            </li>)}
          </ul>}
      </div>

      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer select-none">指标口径</summary>
        <div className="mt-1 space-y-1">
          {Object.entries(metrics.definitions).map(([key, text]) => <p key={key}>{text}</p>)}
          <p>{metrics.testTier.note}</p>
          <p>统计区间：{new Date(report.since).toLocaleString('zh-CN')} 至 {new Date(report.generatedAt).toLocaleString('zh-CN')}</p>
        </div>
      </details>
    </div>}
  </AdminPanel>;
}
