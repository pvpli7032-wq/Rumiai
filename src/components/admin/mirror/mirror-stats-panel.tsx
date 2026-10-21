'use client';

import {useEffect, useMemo, useState} from 'react';
import {AdminNotice, AdminPanel} from '@/components/admin/admin-page';
import {Badge} from '@/components/ui/badge';
import {Select} from '@/components/ui/select';
import {API} from '@/lib/api-paths';
import {mirrorStatsCards} from './types';

/**
 * 「他眼中的你」统计标签（V3 §23 表 19：后台三个标签，统计独立成一页）。
 *
 * 口径只有一个来源：运营分析已有的 ops-metrics（生成成功率、分享后的访问）与
 * 玩法漏斗（访问 → 开始答题 → 生成完成）。这里只做展示与换算，不自己写聚合、
 * 不新建端点——两处各算各的，数字迟早对不上。
 *
 * 转聊天（mirror_to_chat）已在客户端埋点，但运营统计口径里还没有对应指标：
 * 该指标需要由 ops-metrics 补一条 ratio，本页按 key 自动渲染，补上就会出现。
 */

type RatioMetric = {key: string; label: string; formula: string; numerator: number; denominator: number; value: number | null};
type Metrics = {
  tierLabel: string;
  tierOptions: Array<{key: string; label: string}>;
  testTier: {label: string; note: string};
  ratios: RatioMetric[];
  definitions: Record<string, string>;
};
type OpsReport = {generatedAt: string; since: string; days: number; metrics: Metrics};

type FunnelStep = {event: string; label: string; people: number; rateFromStart: number | null; rateFromPrevious: number | null};
type Funnel = {key: string; title: string; description: string; steps: FunnelStep[]; overallRate: number | null};
type FunnelReport = {generatedAt: string; since: string; days: number; funnels: Funnel[]; definitions: Record<string, string>};

const DAY_OPTIONS = [7, 14, 30];
const number = (value: number) => new Intl.NumberFormat('zh-CN').format(value);
/** 分母为 0 时是 null：写「样本不足」，绝不写 0%。 */
const percent = (value: number | null) => (value === null ? '样本不足' : (value * 100).toFixed(1) + '%');

/** 数字 + 进度条，不引图表库：比例只用来给眼睛一个长度参考。 */
function RatioBar({value}: {value: number | null}) {
  const width = value === null ? 0 : Math.max(0, Math.min(100, value * 100));
  return (
    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted" role="presentation">
      <div className="h-full rounded-full bg-brand" style={{width: width + '%'}} />
    </div>
  );
}

function RatioCard({metric}: {metric: RatioMetric}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{metric.label}</p>
      <p className="mt-3 text-2xl font-semibold tabular-nums leading-none text-foreground">{percent(metric.value)}</p>
      <RatioBar value={metric.value} />
      <p className="mt-2 text-xs leading-5 text-muted-foreground">
        {number(metric.numerator)} / {number(metric.denominator)} · {metric.formula}
      </p>
    </div>
  );
}

/** 该指标还没进运营统计口径：写清原因，不拿别的数字顶替，也不在这里另算。 */
function MissingRatioCard({label, reason}: {label: string; reason: string}) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-muted/20 p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-3 text-2xl font-semibold leading-none text-muted-foreground">样本不足</p>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">{reason}</p>
    </div>
  );
}

/** 拉一份报告；403 单独提示，因为「他眼中的你」权限与运营分析权限是分开的。 */
async function readReport<T>(url: string, token: string, signal: AbortSignal): Promise<{data: T | null; error: string; denied: boolean}> {
  try {
    const response = await fetch(url, {headers: {Authorization: 'Bearer ' + token}, cache: 'no-store', signal});
    const payload = await response.json().catch(() => null) as {error?: string} | null;
    if (response.status === 403) return {data: null, error: payload?.error || '当前账号没有运营分析权限。', denied: true};
    if (!response.ok) return {data: null, error: payload?.error || '统计读取失败，请稍后重试。', denied: false};
    return {data: payload as T, error: '', denied: false};
  } catch (cause) {
    if (signal.aborted) return {data: null, error: '', denied: false};
    return {data: null, error: cause instanceof Error ? cause.message : '统计读取失败，请稍后重试。', denied: false};
  }
}

export function MirrorStatsPanel({token}: {token: string}) {
  const [days, setDays] = useState(7);
  const [ops, setOps] = useState<OpsReport | null>(null);
  const [funnelReport, setFunnelReport] = useState<FunnelReport | null>(null);
  const [error, setError] = useState('');
  const [denied, setDenied] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setDenied(false);
    void Promise.all([
      readReport<OpsReport>(API.admin.analyticsOpsMetrics + '?days=' + days + '&tier=all', token, controller.signal),
      readReport<FunnelReport>(API.admin.analyticsProductFunnel + '?days=' + days, token, controller.signal),
    ]).then(([opsResult, funnelResult]) => {
      if (controller.signal.aborted) return;
      setOps(opsResult.data);
      setFunnelReport(funnelResult.data);
      setDenied(opsResult.denied || funnelResult.denied);
      setError(opsResult.error || funnelResult.error);
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [days, token]);

  const ratios = useMemo(() => ops?.metrics.ratios ?? [], [ops]);
  const mirrorFunnel = useMemo(() => funnelReport?.funnels.find(item => item.key === 'mirror') ?? null, [funnelReport]);
  // 三项必看指标的固定顺序；缺哪一项就照实标出来，而不是悄悄少一格。
  const cards = useMemo(() => mirrorStatsCards(ratios), [ratios]);

  if (denied) {
    return <AdminNotice tone="denied" title="没有运营分析权限" description="统计标签复用运营分析的口径（ops-metrics 与玩法漏斗），需要 analytics.read 权限；结果与配置标签不受影响。" />;
  }

  return (
    <div className="flex flex-col gap-5">
      {error && <AdminNotice tone="error" title={error} />}

      <AdminPanel
        title="统计"
        description="数字全部来自运营分析的既有口径：生成成功率与分享后的访问取自 ops-metrics，访问 → 开始答题 → 生成完成取自玩法漏斗。本页不另算一份。"
        badge={<Badge variant="outline">最近 {days} 天</Badge>}
        actions={
          <Select aria-label="统计天数" value={String(days)} onChange={event => setDays(Number(event.target.value))} disabled={loading}>
            {DAY_OPTIONS.map(option => <option key={option} value={option}>最近 {option} 天</option>)}
          </Select>
        }
      >
        {loading && <p className="text-sm text-muted-foreground">正在读取统计…</p>}

        {!loading && (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {cards.map(({slot, metric}) => metric
              ? <RatioCard key={slot.key} metric={metric} />
              : <MissingRatioCard key={slot.key} label={slot.label} reason={slot.missingReason} />)}
          </div>
        )}
      </AdminPanel>

      <AdminPanel
        title="玩法漏斗"
        description={mirrorFunnel?.description ?? '访问 → 开始答题 → 生成完成；生成完成由服务端在结果落库后写，不接受客户端自称完成。'}
        badge={mirrorFunnel ? <Badge variant="outline">端到端 {percent(mirrorFunnel.overallRate)}</Badge> : undefined}
      >
        {!mirrorFunnel ? (
          <p className="text-sm text-muted-foreground">{loading ? '正在读取漏斗…' : '漏斗数据还没有返回。'}</p>
        ) : (
          <ol className="divide-y divide-border">
            {mirrorFunnel.steps.map((step, index) => (
              <li key={step.event} className="py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm font-medium text-foreground">{index + 1}. {step.label}</span>
                  <span className="text-sm tabular-nums text-foreground">{number(step.people)} 人</span>
                </div>
                <RatioBar value={step.rateFromStart} />
                <p className="mt-1 text-xs text-muted-foreground">
                  相对首步 {percent(step.rateFromStart)}
                  {index > 0 && <> · 相对上一步 {percent(step.rateFromPrevious)}</>}
                </p>
              </li>
            ))}
          </ol>
        )}
      </AdminPanel>

      {(ops || funnelReport) && (
        <details className="rounded-lg border border-border p-3 text-xs text-muted-foreground">
          <summary className="cursor-pointer select-none">指标口径</summary>
          <div className="mt-2 space-y-1">
            {Object.entries(ops?.metrics.definitions ?? {}).map(([key, text]) => <p key={key}>{text}</p>)}
            {Object.entries(funnelReport?.definitions ?? {}).map(([key, text]) => <p key={key}>{text}</p>)}
            <p>用户档位：{ops?.metrics.tierLabel ?? '全部用户'}（{ops?.metrics.testTier.label ?? '全部结果（含测试）'}）</p>
            {ops && <p>统计区间：{new Date(ops.since).toLocaleString('zh-CN')} 至 {new Date(ops.generatedAt).toLocaleString('zh-CN')}</p>}
          </div>
        </details>
      )}
    </div>
  );
}
