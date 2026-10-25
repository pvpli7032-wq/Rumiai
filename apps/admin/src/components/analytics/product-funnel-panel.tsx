'use client';

import type {ChatOnboardingFunnel} from '@rumiai/contracts/analytics';
import {useEffect, useState} from 'react';
import {AdminPanel} from '../admin-page';
import {API} from '@rumiai/contracts/api-paths';

type FunnelStep = {event: string; label: string; people: number; rateFromStart: number | null; rateFromPrevious: number | null};
type Funnel = {key: string; title: string; description: string; steps: FunnelStep[]; overallRate: number | null};
type Report = {generatedAt: string; since: string; days: number; funnels: Funnel[]; definitions: Record<string, string>; chatOnboarding: ChatOnboardingFunnel};

import {formatNumber, formatPercent} from '@rumiai/contracts/format/number';
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

  return <AdminPanel title="玩法漏斗" description="按去重人数统计聊天与玩法路径；分母为 0 时显示样本不足，不当作 0%。">
    {loading && <p className="text-sm text-muted-foreground">正在读取玩法漏斗…</p>}
    {error && <p className="text-sm text-red-600">{error}</p>}
    {report && <div className="space-y-4">
      {report.chatOnboarding && <section className="rounded-2xl border border-border/80 p-4"><h3 className="text-sm font-semibold">首聊与回访</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">以首次记录的普通聊天打开用户为分母。成功回复依据服务端结算回执；重生成不计轮数。</p><dl className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">{[
        ['打开聊天', report.chatOnboarding.opened, null],
        ['完成首轮', report.chatOnboarding.firstReply, report.chatOnboarding.firstReplyRate],
        ['完成第三轮', report.chatOnboarding.thirdReply, report.chatOnboarding.thirdReplyRate],
      ].map(([label, count, value]) => <div key={String(label)}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 text-lg tabular-nums">{formatNumber(Number(count))}<span className="ml-1 text-xs text-muted-foreground">人</span></dd>{value !== null && <p className="text-xs text-muted-foreground">打开后转化 {formatPercent(Number(value))}</p>}</div>)}</dl><div className="mt-4 border-t border-border pt-3 text-sm"><p>首聊次日回访 {formatPercent(report.chatOnboarding.nextDayRate)}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">已成熟样本 {formatNumber(report.chatOnboarding.nextDayMatured)} 人，回访 {formatNumber(report.chatOnboarding.nextDayReturned)} 人；首轮回复后的下一个UTC日结束才统计。未成熟不当作流失。</p><p className="mt-1 text-xs text-muted-foreground">{report.chatOnboarding.trackingSince ? '开始记录于 ' + new Date(report.chatOnboarding.trackingSince).toLocaleString('zh-CN') : '尚无聊天打开记录；不回填虚构历史。'}</p></div></section>}
      {report.funnels.map(funnel => <div key={funnel.key} className="overflow-hidden rounded-2xl border border-border/80 bg-muted/10">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="px-4 pt-4"><p className="text-sm font-semibold text-foreground">{funnel.title}</p>
          <p className="mt-1 text-xs text-muted-foreground">{funnel.description}</p></div>
          <p className="mr-4 mt-4 rounded-full bg-brand-soft px-2.5 py-1 text-xs font-semibold text-brand">端到端 {formatPercent(funnel.overallRate)}</p>
        </div>
        <div className="space-y-3 px-4 pb-4 pt-4">
          {funnel.steps.map((step, index) => <div key={step.event} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 text-sm">
            <div className="min-w-0"><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium text-foreground">{step.label}</span><span className="shrink-0 tabular-nums text-xs text-muted-foreground">{formatNumber(step.people)} 人</span></div><div aria-hidden className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-border/60"><div className="h-full rounded-full bg-brand" style={{width: `${step.rateFromStart === null ? 0 : Math.max(0, Math.min(100, step.rateFromStart * 100))}%`}} /></div><p className="mt-1 text-xs tabular-nums text-muted-foreground">整体 {formatPercent(step.rateFromStart)}</p></div>
            <span className="w-20 text-right text-xs tabular-nums text-muted-foreground">{index === 0 ? '起点' : `上一步 ${formatPercent(step.rateFromPrevious)}`}</span>
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
